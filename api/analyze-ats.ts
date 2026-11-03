import { GoogleGenAI, Type } from "@google/genai";

/**
 * POST /api/analyze-ats — ATS compatibility score for a CV vs a job description.
 *
 * SELF-CONTAINED BY DESIGN: no relative imports, because Vercel's function
 * runtime must be able to resolve every dependency on its own regardless of
 * whether it bundles, traces or runs the file natively.
 * The prompt/schema mirror lib/ai.ts (local dev server) — KEEP THEM IN SYNC.
 */

const AI_MODEL = "gemini-3.5-flash";
const MAX_INPUT_CHARS = 30000;

function trimInput(text: string): string {
  return text.length > MAX_INPUT_CHARS
    ? text.substring(0, MAX_INPUT_CHARS) + "\n... [Content truncated for processing speed]"
    : text;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
    throw new Error(
      "GEMINI_API_KEY is not configured or is a placeholder. Please set your Gemini API Key in the Settings > Secrets panel of AI Studio."
    );
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  return JSON.parse(cleaned) as T;
}

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): void;
  setHeader(name: string, value: string): void;
}

function parseJsonBody(raw: unknown): Record<string, any> {
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

    const trimmedCV = trimInput(String(cv));
    const trimmedJD = trimInput(String(jd));

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: AI_MODEL,
      contents: `Analyze the following CV against the provided Job Description. Provide an ATS compatibility score (0-100) and specific improvement suggestions.
      
      CV:
      ${trimmedCV}
      
      Job Description:
      ${trimmedJD}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["score", "missingKeywords", "strengths", "suggestions"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini ATS analysis.");
    }

    res.status(200).json(parseJsonResponse(text));
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api] Failed to analyze documents:", message);
    res.status(500).json({ error: message || "Failed to analyze documents." });
  }
}
