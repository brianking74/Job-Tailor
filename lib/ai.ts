import type { ATSAnalysis, TailoredDocuments } from "../types.ts";

/**
 * Shared AI logic used by BOTH the local development server (server.ts)
 * and the Vercel serverless functions (api/*.ts).
 *
 * Provider-agnostic by design: talks to any OpenAI-compatible
 * chat-completions endpoint. Current provider: OpenScale
 * (https://app.openscale.so) running deepseek/deepseek-v4.1-flash.
 *
 * Configuration (env-overridable, defaults baked in):
 *   AI_API_KEY   — provider API key. REQUIRED. No default; never hardcode it.
 *   AI_BASE_URL  — default: https://api.openscale.so/v1
 *   AI_MODEL     — default: deepseek/deepseek-v4.1-flash
 *
 * JSON guarantee: requests use response_format {type:"json_schema", strict:true}
 * (confirmed supported by OpenScale) so the model output is schema-enforced
 * server-side — the same guarantee the old Gemini responseSchema gave us.
 * Defensive JSON extraction + shape validation remain as a second line of
 * defence, and /api/analyze-ats makes one repair attempt on malformed output.
 *
 * The prompts/schemas mirror api/*.ts (Vercel functions) — KEEP THEM IN SYNC.
 */

export const DEFAULT_BASE_URL = "https://api.openscale.so/v1";
export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
export const MAX_INPUT_CHARS = 30000;
export const ATS_MAX_TOKENS = 2000;
/**
 * The Tailored Suite used to be ONE 8000-token call, which DeepSeek on OpenScale
 * could not finish inside Vercel's 60s function cap (55s safety margin).
 * It is now THREE independent calls run in parallel, each with a much smaller
 * output budget, so wall time = slowest single document, not the sum.
 */
export const CV_MAX_TOKENS = 4500;
export const COVER_LETTER_MAX_TOKENS = 1600;
export const EMAIL_MAX_TOKENS = 1000;
/** Vercel functions are capped at 60s; abort the upstream call before that. */
const REQUEST_TIMEOUT_MS = 55000;

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "AI_API_KEY is not configured. Add your OpenScale API key as the AI_API_KEY environment variable in Vercel (Settings > Environment Variables), then redeploy."
    );
    this.name = "MissingApiKeyError";
  }
}

interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

function readApiKey(): string {
  return process.env.AI_API_KEY ?? process.env.OPENSCALE_API_KEY ?? "";
}

export function isApiKeyConfigured(): boolean {
  const key = readApiKey();
  return !!key && key !== "PLACEHOLDER_API_KEY";
}

export function getAiConfig(): AiConfig {
  if (!isApiKeyConfigured()) throw new MissingApiKeyError();
  return {
    baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    apiKey: readApiKey(),
  };
}

/** Truncate oversized pasted text to prevent token bloat and gateway timeouts. */
export function trimInput(text: string): string {
  return text.length > MAX_INPUT_CHARS
    ? text.substring(0, MAX_INPUT_CHARS) + "\n... [Content truncated for processing speed]"
    : text;
}

/** Strip markdown fences and surrounding prose, keeping only the outermost JSON object. */
export function extractJsonObject(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last <= first) {
    throw new Error("AI response did not contain a JSON object.");
  }
  return t.slice(first, last + 1);
}

/** Parse the model output into a typed object, tolerating fences/prose. */
export function parseJsonResponse<T>(raw: string): T {
  return JSON.parse(extractJsonObject(raw)) as T;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  maxTokens: number;
  reasoningEffort?: "none" | "low" | "high" | "max";
  timeoutMs?: number;
}

interface JsonChatOptions extends ChatOptions {
  schemaName: string;
  schema: Record<string, unknown>;
}

/** One chat-completions call against the configured OpenAI-compatible provider. */
async function chatCompletion(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens,
    reasoning_effort: opts.reasoningEffort ?? "none",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      const e = new Error(
        `The AI request timed out after ${Math.round((opts.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000)}s. Please try again.`
      );
      (e as any).isTimeout = true;
      throw e;
    }
    throw new Error(`Could not reach the AI provider (${err?.message || err}). Please try again.`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed?.error?.message || JSON.stringify(parsed?.error) || detail;
    } catch {
      /* keep raw slice */
    }
    const e = new Error(`AI provider returned HTTP ${res.status}: ${detail}`);
    (e as any).httpStatus = res.status;
    throw e;
  }

  const data: any = await res.json();
  const message = data?.choices?.[0]?.message;
  const content =
    typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("")
        : "";
  if (!content.trim()) {
    throw new Error("Empty response received from the AI model.");
  }
  return content;
}

/** Single retry for transient provider failures (429 / 5xx / fast network errors). */
async function chatWithRetry(cfg: AiConfig, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  try {
    return await chatCompletion(cfg, messages, opts);
  } catch (err: any) {
    const status = err?.httpStatus;
    const transient = status === 429 || (typeof status === "number" && status >= 500) || !status;
    if (!transient || err?.isTimeout || err instanceof MissingApiKeyError) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return chatCompletion(cfg, messages, opts);
  }
}

/** Chat call with server-side JSON-schema enforcement + defensive parsing. */
async function chatJson<T>(cfg: AiConfig, messages: ChatMessage[], opts: JsonChatOptions): Promise<T> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens,
    reasoning_effort: opts.reasoningEffort ?? "none",
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      const e = new Error(
        `The AI request timed out after ${Math.round((opts.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000)}s. Please try again.`
      );
      (e as any).isTimeout = true;
      throw e;
    }
    throw new Error(`Could not reach the AI provider (${err?.message || err}). Please try again.`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed?.error?.message || JSON.stringify(parsed?.error) || detail;
    } catch {
      /* keep raw slice */
    }
    const e = new Error(`AI provider returned HTTP ${res.status}: ${detail}`);
    (e as any).httpStatus = res.status;
    throw e;
  }

  const data: any = await res.json();
  const message = data?.choices?.[0]?.message;
  const content =
    typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("")
        : "";
  if (!content.trim()) {
    throw new Error("Empty response received from the AI model.");
  }

  try {
    return JSON.parse(extractJsonObject(content)) as T;
  } catch (err: any) {
    const e = new Error(`AI returned malformed JSON (${err?.message || err}).`);
    (e as any).isParseError = true;
    (e as any).rawText = content;
    throw e;
  }
}

/** Shape returned by /api/health (also used by the frontend diagnostics). */
export function getHealthStatus() {
  const key = readApiKey();
  return {
    status: "ok",
    apiKeyConfigured: !!key && key !== "PLACEHOLDER_API_KEY",
    apiKeyLength: key ? key.length : 0,
    provider: "openscale",
    model: process.env.AI_MODEL || DEFAULT_MODEL,
  };
}

const ATS_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    missingKeywords: { type: "array", items: { type: "string" } },
    strengths: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } }
  },
  required: ["score", "missingKeywords", "strengths", "suggestions"],
  additionalProperties: false
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function normalizeAtsAnalysis(parsed: any): ATSAnalysis {
  const rawScore = typeof parsed?.score === "number" ? parsed.score : Number(parsed?.score);
  const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : 0;
  return {
    score,
    missingKeywords: toStringArray(parsed?.missingKeywords),
    strengths: toStringArray(parsed?.strengths),
    suggestions: toStringArray(parsed?.suggestions),
  };
}

/** ATS compatibility analysis of a CV against a job description. */
export async function runAtsAnalysis(cv: string, jd: string): Promise<ATSAnalysis> {
  const cfg = getAiConfig();
  const trimmedCV = trimInput(cv);
  const trimmedJD = trimInput(jd);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are an expert ATS (Applicant Tracking System) analyzer and technical recruiter. Respond ONLY with a valid JSON object.",
    },
    {
      role: "user",
      content: `Analyze the following CV against the provided Job Description. Provide an ATS compatibility score (0-100) and specific improvement suggestions.
        
        CV:
        ${trimmedCV}
        
        Job Description:
        ${trimmedJD}`,
    },
  ];

  let parsed: any;
  try {
    parsed = await chatJson<any>(cfg, messages, {
      maxTokens: ATS_MAX_TOKENS,
      schemaName: "ats_analysis",
      schema: ATS_ANALYSIS_SCHEMA,
      reasoningEffort: "none",
    });
  } catch (err: any) {
    // One repair attempt if the provider ignored the JSON guarantee.
    if (!err?.isParseError) throw err;
    const repair = await chatCompletion(cfg, [
      ...messages,
      { role: "assistant", content: String(err.rawText ?? "").slice(0, 4000) },
      {
        role: "user",
        content:
          'The message above was supposed to be ONLY a JSON object with keys "score" (number), "missingKeywords", "strengths" and "suggestions" (arrays of strings). Reply with the corrected JSON object and nothing else.',
      },
    ], { maxTokens: ATS_MAX_TOKENS, reasoningEffort: "none" });
    parsed = parseJsonResponse<any>(repair);
  }

  return normalizeAtsAnalysis(parsed);
}

/** One schema per document — each parallel call enforces a single-string output. */
const CV_SCHEMA = {
  type: "object",
  properties: {
    cv: { type: "string", description: "Markdown formatted tailored CV" },
  },
  required: ["cv"],
  additionalProperties: false,
};

const COVER_LETTER_SCHEMA = {
  type: "object",
  properties: {
    coverLetter: { type: "string", description: "Professional cover letter including contact header placeholders" },
  },
  required: ["coverLetter"],
  additionalProperties: false,
};

const EMAIL_SCHEMA = {
  type: "object",
  properties: {
    emailBody: { type: "string", description: "A concise, effective outreach email" },
  },
  required: ["emailBody"],
  additionalProperties: false,
};

/** Generate ONE document (cv | coverLetter | emailBody) via a focused JSON-schema call. */
async function generateTailoredDoc(
  cfg: AiConfig,
  key: "cv" | "coverLetter" | "emailBody",
  instructions: string,
  opts: { maxTokens: number; schemaName: string; schema: Record<string, unknown> }
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a world-class professional career consultant and expert copywriter. Respond ONLY with a valid JSON object.",
    },
    { role: "user", content: instructions },
  ];

  const parsed = await chatJson<any>(cfg, messages, {
    maxTokens: opts.maxTokens,
    schemaName: opts.schemaName,
    schema: opts.schema,
    reasoningEffort: "none",
  });

  const value = typeof parsed?.[key] === "string" ? parsed[key].trim() : "";
  if (!value) {
    throw new Error(`The AI response was missing the "${key}" document. Please try again.`);
  }
  return value;
}

/**
 * Generate tailored CV, cover letter and outreach email from master CV + JD.
 * Three independent AI calls run in PARALLEL (Promise.all) — each has a small,
 * focused output so the slowest one still finishes well inside the 55s budget.
 */
export async function runTailoredGeneration(cv: string, jd: string): Promise<TailoredDocuments> {
  const cfg = getAiConfig();
  const trimmedCV = trimInput(cv);
  const trimmedJD = trimInput(jd);

  const sharedContext = `\n\nMaster CV:\n${trimmedCV}\n\nJob Description:\n${trimmedJD}`;

  const [cvOut, coverLetter, emailBody] = await Promise.all([
    generateTailoredDoc(
      cfg,
      "cv",
      `Tailor the master CV below for the target Job Description.

      CV GUIDELINES:
      - Update the master CV to highlight achievements and skills relevant to the Job Description.
      - Reorder and emphasise relevant experience, but stay truthful to the master CV: never invent employers, dates, titles or credentials.
      - Professional, standard, ATS-friendly format in clean Markdown.
      - Keep it concise (equivalent of one page, roughly 500-650 words).
      - IMPORTANT: Output the COMPLETE CV. Do not cut off mid-sentence.

      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly one key: "cv" (string containing the full Markdown CV).${sharedContext}`,
      { maxTokens: CV_MAX_TOKENS, schemaName: "tailored_cv", schema: CV_SCHEMA }
    ),
    generateTailoredDoc(
      cfg,
      "coverLetter",
      `Write a high-impact cover letter for the Job Description below, based on the master CV.

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

      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly one key: "coverLetter" (string).${sharedContext}`,
      { maxTokens: COVER_LETTER_MAX_TOKENS, schemaName: "tailored_cover_letter", schema: COVER_LETTER_SCHEMA }
    ),
    generateTailoredDoc(
      cfg,
      "emailBody",
      `Write a concise, effective outreach email to accompany the job application described below.

      EMAIL GUIDELINES:
      - 120 - 180 words for the application.
      - The first line must be the subject line in the form: Subject: ...
      - Reference the attached CV and cover letter.
      - IMPORTANT: Ensure the email is COMPLETE. Do not cut off mid-sentence.

      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly one key: "emailBody" (string).${sharedContext}`,
      { maxTokens: EMAIL_MAX_TOKENS, schemaName: "tailored_email", schema: EMAIL_SCHEMA }
    ),
  ]);

  return { cv: cvOut, coverLetter, emailBody };
}
