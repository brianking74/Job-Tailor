/**
 * Minimal request/response typings and helpers shared by the Vercel
 * serverless functions in api/. Deliberately dependency-free so the
 * functions bundle stays small.
 */

export interface ApiRequest {
  method?: string;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): void;
  setHeader(name: string, value: string): void;
}

/**
 * Vercel's Node runtime pre-parses JSON bodies, but be defensive: if the
 * body arrives as a raw string, parse it; anything unusable becomes {}.
 */
export function parseJsonBody(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as Record<string, any>;
  }
  return {};
}

/** Uniform 500 response for unexpected handler errors. */
export function respondWithError(res: ApiResponse, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] ${fallback}:`, message);
  res.status(500).json({ error: message || fallback });
}
