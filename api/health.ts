import { getHealthStatus } from "../lib/ai";
import type { ApiRequest, ApiResponse } from "../lib/http";

export const maxDuration = 60;

/** GET /api/health — used by the frontend to diagnose connectivity/API key issues. */
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
