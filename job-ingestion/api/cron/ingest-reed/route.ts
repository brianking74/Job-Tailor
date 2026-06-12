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

/**
 * Parses Reed's date format (e.g., "11/06/2026") into a proper JavaScript Date object
 */
const parseReedDate = (dateStr: string | null | undefined): Date => {
  if (!dateStr) return new Date();
  
  try {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // months are 0-indexed in JS
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  } catch (e) {
    console.warn(`Failed parsing Reed date string "${dateStr}":`, e);
  }
  return new Date();
};

export async function GET(request: Request) {
  const logId = crypto.randomUUID();
  const startedAt = new Date();

  // 1. Cron authorization Guard
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

  // 2. Fetch API Keys and Build Basic Auth Headers
  const reedApiKey = process.env.REED_API_KEY;
  if (!reedApiKey) {
    console.error('Reed API credentials are missing (REED_API_KEY).');
    return NextResponse.json({ error: 'Reed integration is not configured in env parameters.' }, { status: 500 });
  }

  // Reed requires standard HTTP Basic Auth as "Base64(REED_API_KEY:)" where the password parameter remains blank
  const token = Buffer.from(`${reedApiKey}:`, 'utf-8').toString('base64');

  let fetchedCount = 0;
  let parsedCount = 0;
  let savedCount = 0;
  let deduplicatedCount = 0;
  const errors: string[] = [];

  try {
    // 3. Query Reed.co.uk API search endpoint
    // Pulling 50 tech-oriented jobs to get highly relevant, high-yield records
    const reedUrl = 'https://www.reed.co.uk/api/1.0/search?keywords=developer&resultsToTake=50';
    console.log(`[Reed Ingestion] Fetching Reed listings: ${reedUrl}`);
    const response = await fetchWithRetry(reedUrl, {
      retries: 3,
      headers: {
        'Authorization': `Basic ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Reed API responded with error status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const results = payload.results || [];
    fetchedCount = results.length;

    console.log(`[Reed Ingestion] Crawled ${fetchedCount} listings successfully. Preparing ingestion pool...`);

    // 4. Processing Loop
    for (const raw of results) {
      try {
        parsedCount++;

        const rawId = raw.jobId?.toString();
        if (!rawId) continue;

        const rawTitle = raw.jobTitle || '';
        const rawCompany = raw.employerName || 'Generic Employer';
        const rawUrl = raw.jobUrl;

        // Perform fast Duplication lookup
        const dupCheck = await checkIsDuplicate(db, {
          externalId: rawId,
          source: 'reed',
          url: rawUrl,
          title: rawTitle,
          company: rawCompany
        });

        if (dupCheck.isDuplicate) {
          deduplicatedCount++;
          console.log(`[Reed Ingestion] Found duplicate entry: ${dupCheck.reason}`);
          continue;
        }

        // Clean & sanitize job text description
        const rawDescription = raw.jobDescription || '';
        const cleanHtml = sanitizeHtml(rawDescription);
        const mdText = htmlToMarkdown(cleanHtml);
        const plainText = htmlToPlainText(cleanHtml);

        // Standardize properties
        const normalizedJobType = normalizeJobType(null, rawTitle); // Reed has customized type tags; fallback deduction is safer
        const normalizedExp = normalizeExperienceLevel(null, rawTitle, plainText);
        const normalizedRemote = normalizeRemoteStatus(null, rawTitle, raw.locationName);
        const autoTags = generateAutoTags(rawTitle, plainText);

        // Resolve Salary. Reed provides minimumSalary and maximumSalary. Default currency is GBP (£)
        let minSalary = raw.minimumSalary ? Math.round(Number(raw.minimumSalary)) : null;
        let maxSalary = raw.maximumSalary ? Math.round(Number(raw.maximumSalary)) : null;
        let currency = raw.currency || 'GBP';

        // Check if values are zero, which sometimes indicates missing variables in Reed API responses
        if ((!minSalary || minSalary === 0) && (!maxSalary || maxSalary === 0)) {
          const parsed = await parseSalary(cleanHtml, plainText, rawTitle);
          minSalary = parsed.min;
          maxSalary = parsed.max;
          if (parsed.currency) currency = parsed.currency;
        }

        // Date conversions
        const postedDate = parseReedDate(raw.date);
        const expirationDate = new Date(postedDate.getTime() + 45 * 24 * 60 * 60 * 1000);

        // Insert listing
        const completeJobId = `reed:${rawId}`;
        await db.insert(jobs).values({
          id: completeJobId,
          externalId: rawId,
          source: 'reed',
          title: rawTitle,
          company: rawCompany,
          location: raw.locationName || 'United Kingdom',
          salaryMin: minSalary,
          salaryMax: maxSalary,
          currency,
          jobType: normalizedJobType,
          experienceLevel: normalizedExp,
          remote: normalizedRemote,
          tags: autoTags,
          descriptionHtml: cleanHtml,
          descriptionMarkdown: mdText,
          descriptionPlain: plainText,
          url: rawUrl,
          companyLogo: null,
          postedAt: postedDate,
          expiresAt: expirationDate,
          isActive: true
        });

        savedCount++;

      } catch (jobError) {
        const msg = jobError instanceof Error ? jobError.message : String(jobError);
        errors.push(`Parse failure: ${msg}`);
        console.error(`[Reed Ingestion Job Error]`, jobError);
      }
    }

    // 5. Ingestion reporting log insertion
    await db.insert(ingestionLogs).values({
      id: logId,
      source: 'reed',
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
      source: 'reed',
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
    console.error('[Reed Ingestion Crawler Failure]', error);

    try {
      await db.insert(ingestionLogs).values({
        id: logId,
        source: 'reed',
        status: 'failed',
        jobsFetched: fetchedCount,
        jobsParsed: parsedCount,
        jobsSaved: savedCount,
        jobsDeduplicated: deduplicatedCount,
        errorMessage: `Critical crawler core error: ${errorMsg}`,
        startedAt,
        completedAt: new Date()
      });
    } catch (saveLogError) {
      console.error('Failed storing critical crash log inside DB:', saveLogError);
    }

    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
