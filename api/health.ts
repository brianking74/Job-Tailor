/**
 * GET /api/health — connectivity + API key diagnostics for the frontend.
 *
 * SELF-CONTAINED BY DESIGN: no relative imports, because Vercel's function
 * runtime must be able to resolve every dependency on its own regardless of
 * whether it bundles, traces or runs the file natively.
 * Mirrors getHealthStatus() in lib/ai.ts — KEEP THE TWO IN SYNC.
 */

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): void;
  setHeader(name: string, value: string): void;
}

function getHealthStatus() {
  const apiKey = process.env.GEMINI_API_KEY;
  return {
    status: "ok",
    apiKeyConfigured: !!apiKey && apiKey !== "PLACEHOLDER_API_KEY" && apiKey.length > 0,
    apiKeyLength: apiKey ? apiKey.length : 0,
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed. Use GET." });
    return;
  }
  try {
    res.status(200).json(getHealthStatus());
  } catch (error: any) {
    res.status(500).json({ status: "error", error: error?.message || "Health check failed." });
  }
}
