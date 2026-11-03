import { runAtsAnalysis } from "../lib/ai";
import { parseJsonBody, respondWithError, type ApiRequest, type ApiResponse } from "../lib/http";

export const maxDuration = 60;

/** POST /api/analyze-ats — ATS compatibility score for a CV vs a job description. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const { cv, jd } = parseJsonBody(req.body);
    if (!cv || !jd) {
      res.status(400).json({ error: "Missing CV or Job Description content." });
      return;
    }

    const result = await runAtsAnalysis(String(cv), String(jd));
    res.status(200).json(result);
  } catch (error: any) {
    respondWithError(res, error, "Failed to analyze documents.");
  }
}
