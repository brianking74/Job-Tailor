/**
 * Advanced HTTP Fetch Helper
 * Implements retry mechanism with exponential backoff and rate-limit safety guards
 */

interface FetchOptions extends RequestInit {
  retries?: number;
  backoffMs?: number;
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { retries = 3, backoffMs = 1000, ...fetchParams } = options;
  
  let attempts = 0;
  
  while (attempts < retries) {
    try {
      attempts++;
      const response = await fetch(url, {
        ...fetchParams,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'JobTailor-Crawler/1.0',
          ...fetchParams.headers,
        },
      });

      // 1. Check rate limits (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const delay = retryAfterHeader 
          ? parseInt(retryAfterHeader, 10) * 1000 
          : backoffMs * Math.pow(2, attempts);
        
        console.warn(`[API Rate Limit 429] Backing off for ${delay}ms (Attempt ${attempts}/${retries})`);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      // 2. Retry on server errors (5xx)
      if (response.status >= 500) {
        const delay = backoffMs * Math.pow(2, attempts);
        console.warn(`[API Server Error ${response.status}] Retrying in ${delay}ms...`);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }

      // Return response if successful or un-retryable (400, 401, 403, 404, etc.)
      return response;

    } catch (error) {
      if (attempts >= retries) {
        throw error;
      }
      
      const delay = backoffMs * Math.pow(2, attempts);
      console.error(`[Fetch Network Error] ${error instanceof Error ? error.message : error}. Retrying in ${delay}ms...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }

  throw new Error(`Failed to fetch from ${url} after ${retries} failed attempts.`);
}
