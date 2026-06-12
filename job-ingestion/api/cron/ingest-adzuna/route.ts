import { NextResponse } from 'next/server';
import { db } from '../../../db'; // Database connection representing Supabase / Drizzle instance
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

// Unique router configuration
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Limit execution to 5 minutes max in Vercel Serverless

export async function GET(request: Request) {
  const logId = crypto.randomUUID();
  const startedAt = new Date();
  
  // 1. Cron Secret Protection Guard
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

  // 2. Fetch credentials from Environment
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const country = process.env.ADZUNA_COUNTRY || 'gb'; // Def to UK but customizable

  if (!appId || !appKey) {
    console.error('Adzuna API Configuration variables are missing (ADZUNA_APP_ID / ADZUNA_APP_KEY).');
    return NextResponse.json({ error: 'Adzuna integration is not configured in env parameters.' }, { status: 500 });
  }

  // 3. Setup Metrics tracker
  let fetchedCount = 0;
  let parsedCount = 0;
  let savedCount = 0;
  let deduplicatedCount = 0;
  const errors: string[] = [];

  try {
    // 4. API Request Setup (Incremental Sync page 1)
    const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=50&content-type=application/json`;
    
    console.log(`[Adzuna Ingestion] Querying URL: ${adzunaUrl}`);
    const response = await fetchWithRetry(adzunaUrl, { retries: 3 });

    if (!response.ok) {
      throw new Error(`Adzuna API responded with error status ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const results = payload.results || [];
    fetchedCount = results.length;

    console.log(`[Adzuna Ingestion] Successfully fetched ${fetchedCount} jobs. Normalizing now...`);

    // 5. Ingestion Pipeline Orchestrator per Job
    for (const raw of results) {
      try {
        parsedCount++;
        
        const rawId = raw.id?.toString();
        if (!rawId) continue;

        const rawTitle = raw.title || '';
        const rawCompany = raw.company?.display_name || 'Generic Employer';
        const rawUrl = raw.redirect_url;

        // Perform fast Duplication audit BEFORE doing expensive calculations or inserts
        const dupCheck = await checkIsDuplicate(db, {
          externalId: rawId,
          source: 'adzuna',
          url: rawUrl,
          title: rawTitle,
          company: rawCompany
        });

        if (dupCheck.isDuplicate) {
          deduplicatedCount++;
          console.log(`[Adzuna Ingestion] Skip duplicate job: ${dupCheck.reason}`);
          continue;
        }

        // Clean & sanitize job summary body
        const rawDescription = raw.description || '';
        const cleanHtml = sanitizeHtml(rawDescription);
        const mdText = htmlToMarkdown(cleanHtml);
        const plainText = htmlToPlainText(cleanHtml);

        // Normalize parameters
        const normalizedJobType = normalizeJobType(raw.contract_type, rawTitle);
        const normalizedExp = normalizeExperienceLevel(null, rawTitle, plainText);
        const normalizedRemote = normalizeRemoteStatus(raw.contract_time, rawTitle, raw.location?.display_name);
        const autoTags = generateAutoTags(rawTitle, plainText);

        // Parse salary with smart local fallback
        let salaryMin = raw.salary_min ? Math.round(Number(raw.salary_min)) : null;
        let salaryMax = raw.salary_max ? Math.round(Number(raw.salary_max)) : null;
        let currency = 'USD'; // default

        // Deduced from location/country rules or parsed from description if values are missing
        if (country === 'gb') currency = 'GBP';
        else if (['fr', 'de', 'es', 'it', 'nl'].includes(country)) currency = 'EUR';

        if (!salaryMin || !salaryMax) {
          const parsed = await parseSalary(cleanHtml, plainText, rawTitle);
          if (parsed.min) salaryMin = parsed.min;
          if (parsed.max) salaryMax = parsed.max;
          if (parsed.currency) currency = parsed.currency;
        }

        // Expiration configuration - set to delete or flag active as false after 45 days
        const postedDate = raw.created ? new Date(raw.created) : new Date();
        const expirationDate = new Date(postedDate.getTime() + 45 * 24 * 60 * 60 * 1000);

        // Write row into Database
        const completeJobId = `adzuna:${rawId}`;
        await db.insert(jobs).values({
          id: completeJobId,
          externalId: rawId,
          source: 'adzuna',
          title: rawTitle.replace(/<\/?[^>]+(>|$)/g, ""), // strip leftover html tags from API fields
          company: rawCompany,
          location: raw.location?.display_name || 'Various Locations',
          salaryMin,
          salaryMax,
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
        errors.push(`Failed in job parse: ${msg}`);
        console.error(`[Adzuna Job Map Error]`, jobError);
      }
    }

    // 6. DB audit record logging
    await db.insert(ingestionLogs).values({
      id: logId,
      source: 'adzuna',
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
      source: 'adzuna',
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
    console.error('[Adzuna Critical Engine Failure]', error);
    
    // Attempt rescue logging
    try {
      await db.insert(ingestionLogs).values({
        id: logId,
        source: 'adzuna',
        status: 'failed',
        jobsFetched: fetchedCount,
        jobsParsed: parsedCount,
        jobsSaved: savedCount,
        jobsDeduplicated: deduplicatedCount,
        errorMessage: `Critical exception: ${errorMsg}`,
        startedAt,
        completedAt: new Date()
      });
    } catch (logError) {
      console.error('Failed to log sync crash to DB:', logError);
    }

    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
