import { GoogleGenAI, Type } from "@google/genai";

/**
 * POST /api/generate-tailored — tailored CV, cover letter and outreach email.
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
      contents: `You are a world-class professional career consultant and expert copywriter. 
      Your task is to generate a tailored CV and a high-impact cover letter.

      CV GUIDELINES:
      - Update the master CV to highlight achievements relevant to the Job Description.
      - Ensure it remains professional and standard in format.

      COVER LETTER GUIDELINES (MANDATORY STRUCTURE):
      - Tone: Professional, confident, and engaging. Avoid generic AI fluff.
      - Format: Standard business letter format.
      - Structure:
          1. Professional Header & Introduction: State the role and why you are excited.
          2. Body Paragraph 1: Connect your background specifically to the most important skill in the JD.
          3. Body Paragraph 2: Highlight a specific achievement (with numbers if possible) that proves you can solve their problems.
          4. Conclusion & Call to Action: Professional sign-off.
      - Length: 250 - 400 words total.
      - IMPORTANT: Ensure the letter is COMPLETE. Do not cut off mid-sentence.

      Master CV:
      ${trimmedCV}
      
      Job Description:
      ${trimmedJD}`,
      config: {
        maxOutputTokens: 4000,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cv: { type: Type.STRING, description: "Markdown formatted tailored CV" },
            coverLetter: { type: Type.STRING, description: "Professional cover letter including contact header placeholders" },
            emailBody: { type: Type.STRING, description: "A concise, effective outreach email" }
          },
          required: ["cv", "coverLetter", "emailBody"]
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Empty response received from Gemini tailoring model.");
    }

    res.status(200).json(parseJsonResponse(text));
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api] Failed to generate tailored content:", message);
    res.status(500).json({ error: message || "Failed to generate tailored content." });
  }
}
