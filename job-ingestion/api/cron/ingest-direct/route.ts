import { NextResponse } from 'next/server';
import { db } from '../../../db';
import { jobs } from '../../../schema.ts';
import { jobRawSchema } from '../../../types/job.ts';
import { sanitizeHtml, htmlToMarkdown, htmlToPlainText } from '../../../utils/sanitizer.ts';
import { checkIsDuplicate } from '../../../utils/deduplication.ts';
import {
  normalizeJobType,
  normalizeExperienceLevel,
  normalizeRemoteStatus,
  generateAutoTags
} from '../../../utils/normalization.ts';

export const dynamic = 'force-dynamic';

/**
 * REST Endpoint for Direct Employer Postings
 * Exposes a structured POST method for company recruitment teams and webhooks to push job listings
 */
export async function POST(request: Request) {
  try {
    // 1. API Authorization check
    const authHeader = request.headers.get('Authorization');
    const apiSecret = process.env.DIRECT_INGEST_SECRET;

    if (!apiSecret || authHeader !== `Bearer ${apiSecret}`) {
      return NextResponse.json({ error: 'Unauthorized secret key.' }, { status: 401 });
    }

    // 2. Parse and Validate Raw Payload using Zod
    const body = await request.json();
    const result = jobRawSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({
        error: 'Invalid properties structural layout',
        details: result.error.format()
      }, { status: 400 });
    }

    const {
      externalId,
      title,
      company,
      location,
      salaryMin,
      salaryMax,
      currency,
      jobType,
      experienceLevel,
      remote,
      tags = [],
      descriptionHtml,
      url,
      companyLogo,
      postedAt
    } = result.data;

    // 3. Prevent duplicate listings
    const dupCheck = await checkIsDuplicate(db, {
      externalId,
      source: 'direct',
      url,
      title,
      company
    });

    if (dupCheck.isDuplicate) {
      return NextResponse.json({
        success: false,
        error: `Submission rejected: ${dupCheck.reason}`
      }, { status: 409 });
    }

    // 4. Clean description body
    const cleanHtml = sanitizeHtml(descriptionHtml);
    const mdText = htmlToMarkdown(cleanHtml);
    const plainText = htmlToPlainText(cleanHtml);

    // 5. Run parameters standardizations
    const normalizedJobType = normalizeJobType(jobType, title);
    const normalizedExp = normalizeExperienceLevel(experienceLevel, title, plainText);
    const normalizedRemote = normalizeRemoteStatus(remote, title, location);
    
    // Auto-generate tags and merge with employer-provided tags
    const generatedTags = generateAutoTags(title, plainText);
    const combinedTags = Array.from(new Set([...tags, ...generatedTags]));

    // 6. Timestamps
    const postedDate = new Date(postedAt);
    const expirationDate = new Date(postedDate.getTime() + 45 * 24 * 60 * 60 * 1000); // 45 days retention

    // 7. Write to PostgreSQL Database
    const finalJobId = `direct:${externalId}`;
    await db.insert(jobs).values({
      id: finalJobId,
      externalId,
      source: 'direct',
      title,
      company,
      location: location || 'Remote',
      salaryMin: salaryMin || null,
      salaryMax: salaryMax || null,
      currency: currency || 'USD',
      jobType: normalizedJobType,
      experienceLevel: normalizedExp,
      remote: normalizedRemote,
      tags: combinedTags,
      descriptionHtml: cleanHtml,
      descriptionMarkdown: mdText,
      descriptionPlain: plainText,
      url,
      companyLogo: companyLogo || null,
      postedAt: postedDate,
      expiresAt: expirationDate,
      isActive: true
    });

    return NextResponse.json({
      success: true,
      message: 'Job posting ingested and normalized successfully',
      jobId: finalJobId
    });

  } catch (error) {
    console.error('[Direct Ingest Endpoint Error]', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Critical engine failure: ' + errorMsg }, { status: 500 });
  }
}
