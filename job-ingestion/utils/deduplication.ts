import { eq, and, or, ilike } from 'drizzle-orm';
import { jobs } from '../schema.ts';

/**
 * Calculates string similarity using Sørensen–Dice Coefficient.
 * Returns a score between 0 and 1, where 1 is identical.
 * Highly robust for fuzzy matching job titles (e.g. "React dev" vs "React developer").
 */
export const calculateSimilarity = (str1: string, str2: string): number => {
  const sa = str1.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const sb = str2.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();

  if (sa === sb) return 1.0;
  if (sa.length < 2 || sb.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };

  const bigramsA = getBigrams(sa);
  const bigramsB = getBigrams(sb);

  let intersection = 0;
  for (const item of bigramsA) {
    if (bigramsB.has(item)) {
      intersection++;
    }
  }

  return (2.0 * intersection) / (bigramsA.size + bigramsB.size);
};

/**
 * Checks the Supabase PostgreSQL database via Drizzle for existing identical or fuzzy matches.
 * Returns true if a duplicate is found, protecting table storage from pollution.
 */
export const checkIsDuplicate = async (
  db: any, // Accepts the Drizzle DB instance
  candidate: {
    externalId: string;
    source: string;
    url: string;
    title: string;
    company: string;
  }
): Promise<{ isDuplicate: boolean; reason?: string }> => {
  const cleanUrl = candidate.url.split('?')[0]; // Strip tracking queries

  // 1. Check direct URL match or source/externalId match
  const exactMatches = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      or(
        eq(jobs.url, cleanUrl),
        and(eq(jobs.source, candidate.source), eq(jobs.externalId, candidate.externalId))
      )
    )
    .limit(1);

  if (exactMatches.length > 0) {
    return { isDuplicate: true, reason: `Exact URL or external ID match found (ID: ${exactMatches[0].id})` };
  }

  // 2. Fuzzy analysis matching the same company and highly similar job title
  const normalizedCandidateTitle = candidate.title.toLowerCase();
  
  // Find other active jobs for this specific company
  const companyJobs = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      url: jobs.url,
      postedAt: jobs.postedAt
    })
    .from(jobs)
    .where(
      and(
        ilike(jobs.company, candidate.company.trim()),
        eq(jobs.isActive, true)
      )
    );

  for (const existingJob of companyJobs) {
    const similarity = calculateSimilarity(normalizedCandidateTitle, existingJob.title);
    
    // Threshold: 80% similarity of title for the same company is classified as a duplicate trigger
    if (similarity >= 0.80) {
      return { 
        isDuplicate: true, 
        reason: `Fuzzy title match (${Math.round(similarity * 100)}%) with exist job ID ${existingJob.id} ("${existingJob.title}") at company "${candidate.company}"` 
      };
    }
  }

  return { isDuplicate: false };
};
