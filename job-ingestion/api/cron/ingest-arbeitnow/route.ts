import { NextResponse } from 'next/server';
import { db } from '../../../db';
import { jobs, ingestionLogs } from '../../../schema.ts';
import { fetchWithRetry } from '../../../utils/fetchHelper.ts';
import { sanitizeHtml, htmlToMarkdown, htmlToPlainText } from '../../../utils/sanitizer.ts';
import { parseSalary } from '../../../utils/salaryParser.ts';
import { checkIsDuplicate } from '../../../utils/deduplication.ts';
import {
  normalizeJobType,
  normalizeExperienceLevel,
  normalizeRemoteStatus,
  generateAutoTags
} from '../../../utils/normalization.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request) {
  const logId = crypto.randomUUID();
  const startedAt = new Date();

  // 1. Cron token enforcement
  const authHeader = request.headers.get('Authorization');
  const cronHeader = request.headers.get('x-vercel-cron');
  const cronSecret = process.env.CRON_SECRET;

  const isLocalEnv = process.env.NODE_ENV === 'development';
  const isCronAuthorized = cronHeader === 'true' || authHeader === `Bearer ${cronSecret}`;

  if (!isCronAuthorized && !isLocalEnv) {
    return new NextResponse(JSON.stringify({ error: 'Unauthorized request token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let fetchedCount = 0;
  let parsedCount = 0;
  let savedCount = 0;
  let deduplicatedCount = 0;
  const errors: string[] = [];

  try {
    // 2. Query Arbeitnow open feed (free endpoints)
    const arbeitnowUrl = 'https://www.arbeitnow.com/api/job-board-api';
    console.log(`[Arbeitnow Ingestion] Triggering fetch on endpoint: ${arbeitnowUrl}`);
    const response = await fetchWithRetry(arbeitnowUrl, { retries: 3 });

    if (!response.ok) {
      throw new Error(`Arbeitnow API returned error query response: ${response.status}`);
    }

    const payload = await response.json();
    const results = payload.data || [];
    fetchedCount = results.length;

    console.log(`[Arbeitnow Ingestion] Retrieved ${fetchedCount} jobs. Scanning listings...`);

    // 3. Normalization Pipeline loop
    for (const raw of results) {
      try {
        parsedCount++;

        // Slug is the primary stable identifier in Arbeitnow lists
        const rawId = raw.slug;
        if (!rawId) continue;

        const rawTitle = raw.title || '';
        const rawCompany = raw.company_name || 'Generic Company';
        const rawUrl = raw.url;

        // Perform smart deduplication audit
        const dupCheck = await checkIsDuplicate(db, {
          externalId: rawId,
          source: 'arbeitnow',
          url: rawUrl,
          title: rawTitle,
          company: rawCompany
        });

        if (dupCheck.isDuplicate) {
          deduplicatedCount++;
          console.log(`[Arbeitnow Ingestion] Skipping duplicated entry: ${dupCheck.reason}`);
          continue;
        }

        // Clean Html, plain structures, and markdown summaries
        const rawDescriptionHtml = raw.description || '';
        const cleanHtml = sanitizeHtml(rawDescriptionHtml);
        const mdText = htmlToMarkdown(cleanHtml);
        const plainText = htmlToPlainText(cleanHtml);

        // Normalize meta details
        const firstType = Array.isArray(raw.job_types) ? raw.job_types[0] : null;
        const normalizedJobType = normalizeJobType(firstType, rawTitle);
        const normalizedExp = normalizeExperienceLevel(null, rawTitle, plainText);
        const normalizedRemote = normalizeRemoteStatus(raw.remote, rawTitle, raw.location);
        
        // Merge AI extracted auto-tags with Arbeitnow tags to get highly granular tags
        const rawTags = Array.isArray(raw.tags) ? raw.tags : [];
        const extractedTags = generateAutoTags(rawTitle, plainText);
        const unionTags = Array.from(new Set([...rawTags, ...extractedTags]));

        // Parse salary from description
        const salary = await parseSalary(cleanHtml, plainText, rawTitle);

        // Calculate timestamps
        // Arbeitnow yields standard epoch integer or string representations
        const postedDate = raw.created_at ? new Date(raw.created_at * 1000) : new Date();
        const expirationDate = new Date(postedDate.getTime() + 45 * 24 * 60 * 60 * 1000);

        // Write to Postgres
        const completeJobId = `arbeitnow:${rawId}`;
        await db.insert(jobs).values({
          id: completeJobId,
          externalId: rawId,
          source: 'arbeitnow',
          title: rawTitle,
          company: rawCompany,
          location: raw.location || 'Remote/Europe',
          salaryMin: salary.min,
          salaryMax: salary.max,
          currency: salary.currency,
          jobType: normalizedJobType,
          experienceLevel: normalizedExp,
          remote: normalizedRemote,
          tags: unionTags,
          descriptionHtml: cleanHtml,
          descriptionMarkdown: mdText,
          descriptionPlain: plainText,
          url: rawUrl,
          companyLogo: raw.company_logo || null,
          postedAt: postedDate,
          expiresAt: expirationDate,
          isActive: true
        });

        savedCount++;

      } catch (jobError) {
        const msg = jobError instanceof Error ? jobError.message : String(jobError);
        errors.push(`Parse error: ${msg}`);
        console.error(`[Arbeitnow Ingestion Error]`, jobError);
      }
    }

    // 4. Log sync overview
    await db.insert(ingestionLogs).values({
      id: logId,
      source: 'arbeitnow',
      status: errors.length === 0 ? 'success' : (savedCount > 0 ? 'partial' : 'failed'),
      jobsFetched: fetchedCount,
      jobsParsed: parsedCount,
      jobsSaved: savedCount,
      jobsDeduplicated: deduplicatedCount,
      errorMessage: errors.slice(0, 10).join('\n') || null,
      startedAt,
      completedAt: new Date()
    });

    return NextResponse.json({
      success: true,
      logId,
      source: 'arbeitnow',
      metrics: {
        fetched: fetchedCount,
        parsed: parsedCount,
        saved: savedCount,
        deduplicated: deduplicatedCount,
        fails: errors.length
      }
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Arbeitnow Root Crash]', error);

    try {
      await db.insert(ingestionLogs).values({
        id: logId,
        source: 'arbeitnow',
        status: 'failed',
        jobsFetched: fetchedCount,
        jobsParsed: parsedCount,
        jobsSaved: savedCount,
        jobsDeduplicated: deduplicatedCount,
        errorMessage: `Critical engine error: ${errorMsg}`,
        startedAt,
        completedAt: new Date()
      });
    } catch (dbError) {
      console.error('Failed logging crash to database:', dbError);
    }

    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
