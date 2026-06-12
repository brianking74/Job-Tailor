import { NextResponse } from 'next/server';
import { db } from '../../../db';
import { jobs } from '../../../schema.ts';
import { lte, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5-minute cold limit

export async function GET(request: Request) {
  const startedAt = new Date();
  
  // 1. Secret security tokens check
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

  // Determine active crawler URLs (Next.js server location basis)
  const host = request.headers.get('host') || 'localhost:3000';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const baseURL = `${protocol}://${host}`;

  const sources = ['adzuna', 'arbeitnow', 'reed'];
  const results: Record<string, any> = {};
  let totalSaved = 0;
  let totalDeduplicated = 0;

  console.log(`[Orchestrator] Starting total job ingestion workflow...`);

  // 2. Graceful sequential execution to prevent rate limit spikes
  for (const source of sources) {
    try {
      const runUrl = `${baseURL}/api/cron/ingest-${source}`;
      console.log(`[Orchestrator] Triggering crawler subtask: ${runUrl}`);
      
      const response = await fetch(runUrl, {
        headers: {
          'Authorization': `Bearer ${cronSecret || ''}`,
          'x-vercel-cron': 'true'
        }
      });

      if (response.ok) {
        const body = await response.json();
        results[source] = {
          status: 'success',
          metrics: body.metrics || {}
        };
        totalSaved += body.metrics?.saved || 0;
        totalDeduplicated += body.metrics?.deduplicated || 0;
      } else {
        results[source] = {
          status: 'failed',
          statusCode: response.status,
          error: await response.text()
        };
      }
    } catch (err) {
      console.error(`[Orchestrator] Error running subtask for source "${source}":`, err);
      results[source] = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  // 3. Sweeper: Job Expiration Logic
  // Flag active listings as false (inactive) if they have surpassed their expiration watermark (e.g. 45 days old)
  let deactivatedCount = 0;
  try {
    const now = new Date();
    console.log(`[Orchestrator] Searching for listings past expiration date (LTE: ${now.toISOString()})...`);
    
    const expiredJobs = await db
      .update(jobs)
      .set({ isActive: false })
      .where(
        lte(jobs.expiresAt, now)
      );

    // Drizzle returning count is often represented by affected rows standard
    deactivatedCount = expiredJobs.rowCount || 0;
    console.log(`[Orchestrator] Successfully flagged ${deactivatedCount} expired jobs as inactive.`);
    
  } catch (expirationError) {
    console.error('[Orchestrator] Expiration routine mapping failed:', expirationError);
    results['expiration_cleanup'] = {
      status: 'failed',
      error: expirationError instanceof Error ? expirationError.message : String(expirationError)
    };
  }

  const durationMs = Date.now() - startedAt.getTime();

  return NextResponse.json({
    success: true,
    orchestratorMetrics: {
      sourcesExecutedCount: sources.length,
      totalSaved,
      totalDeduplicated,
      expiredDeactivated: deactivatedCount,
      durationSeconds: Number((durationMs / 1000).toFixed(2))
    },
    subtaskResults: results
  });
}
