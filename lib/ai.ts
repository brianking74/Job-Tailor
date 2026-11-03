import { GoogleGenAI, Type } from "@google/genai";
import type { ATSAnalysis, TailoredDocuments } from "../types.ts";

/**
 * Shared AI logic used by BOTH the local development server (server.ts)
 * and the Vercel serverless functions (api/*.ts).
 *
 * Keeping the prompts, schemas and truncation rules in one place guarantees
 * that local dev behaves exactly like production.
 */

export const AI_MODEL = "gemini-3.5-flash";
export const MAX_INPUT_CHARS = 30000;

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "GEMINI_API_KEY is not configured or is a placeholder. Please set your Gemini API Key in the Settings > Secrets panel of AI Studio."
    );
    this.name = "MissingApiKeyError";
  }
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
    throw new MissingApiKeyError();
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

/** Truncate oversized pasted text to prevent token bloat and gateway timeouts. */
export function trimInput(text: string): string {
  return text.length > MAX_INPUT_CHARS
    ? text.substring(0, MAX_INPUT_CHARS) + "\n... [Content truncated for processing speed]"
    : text;
}

/** Strip markdown code fences some models wrap JSON responses in, then parse. */
export function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }
  return JSON.parse(cleaned) as T;
}

/** Shape returned by /api/health (also used by the frontend diagnostics). */
export function getHealthStatus() {
  const apiKey = process.env.GEMINI_API_KEY;
  return {
    status: "ok",
    apiKeyConfigured: !!apiKey && apiKey !== "PLACEHOLDER_API_KEY" && apiKey.length > 0,
    apiKeyLength: apiKey ? apiKey.length : 0,
  };
}

const ATS_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    missingKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
  },
  required: ["score", "missingKeywords", "strengths", "suggestions"]
};

/** ATS compatibility analysis of a CV against a job description. */
export async function runAtsAnalysis(cv: string, jd: string): Promise<ATSAnalysis> {
  const trimmedCV = trimInput(cv);
  const trimmedJD = trimInput(jd);

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
      responseSchema: ATS_ANALYSIS_SCHEMA
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error("Empty response received from Gemini ATS analysis.");
  }
  return parseJsonResponse<ATSAnalysis>(text);
}

const TAILORED_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cv: { type: Type.STRING, description: "Markdown formatted tailored CV" },
    coverLetter: { type: Type.STRING, description: "Professional cover letter including contact header placeholders" },
    emailBody: { type: Type.STRING, description: "A concise, effective outreach email" }
  },
  required: ["cv", "coverLetter", "emailBody"]
};

/** Generate tailored CV, cover letter and outreach email from master CV + JD. */
export async function runTailoredGeneration(cv: string, jd: string): Promise<TailoredDocuments> {
  const trimmedCV = trimInput(cv);
  const trimmedJD = trimInput(jd);

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
      responseSchema: TAILORED_SCHEMA
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error("Empty response received from Gemini tailoring model.");
  }
  return parseJsonResponse<TailoredDocuments>(text);
}
