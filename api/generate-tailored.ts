/**
 * POST /api/generate-tailored — tailored CV, cover letter and outreach email.
 *
 * SELF-CONTAINED BY DESIGN: no relative imports, because Vercel's function
 * runtime must be able to resolve every dependency on its own regardless of
 * whether it bundles, traces or runs the file natively.
 * The prompt/schema mirror lib/ai.ts (local dev server) — KEEP THEM IN SYNC.
 *
 * Provider: any OpenAI-compatible chat-completions endpoint, currently
 * OpenScale (https://api.openscale.so/v1) running deepseek/deepseek-v4.1-flash.
 * Env vars: AI_API_KEY (required), AI_BASE_URL / AI_MODEL (optional overrides).
 *
 * TIMEOUT FIX: generating all three documents in ONE call (~8000 output tokens
 * + reasoning) blew past Vercel's 60s function cap. The work is now THREE
 * independent JSON-schema calls run in parallel (Promise.all), each with a
 * small output budget — wall time equals the slowest single document instead
 * of the sum of all three.
 */

const DEFAULT_BASE_URL = "https://api.openscale.so/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
const MAX_INPUT_CHARS = 30000;
const CV_MAX_TOKENS = 4500;
const COVER_LETTER_MAX_TOKENS = 1600;
const EMAIL_MAX_TOKENS = 1000;
const REQUEST_TIMEOUT_MS = 55000; // Vercel functions are capped at 60s

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

function trimInput(text: string): string {
  return text.length > MAX_INPUT_CHARS
    ? text.substring(0, MAX_INPUT_CHARS) + "\n... [Content truncated for processing speed]"
    : text;
}

function extractJsonObject(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last <= first) {
    throw new Error("AI response did not contain a JSON object.");
  }
  return t.slice(first, last + 1);
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

interface ChatMsg {
  role: string;
  content: string;
}

interface DocRequest {
  key: "cv" | "coverLetter" | "emailBody";
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  instructions: string;
}

async function chatJsonOnce(
  cfg: { baseUrl: string; model: string; apiKey: string },
  messages: ChatMsg[],
  schemaName: string,
  schema: Record<string, unknown>,
  maxTokens: number
): Promise<string> {
  const body = {
    model: cfg.model,
    messages,
    max_tokens: maxTokens,
    reasoning_effort: "none",
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      const e = new Error(`The AI request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Please try again.`);
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
async function chatJson(
  cfg: { baseUrl: string; model: string; apiKey: string },
  messages: ChatMsg[],
  schemaName: string,
  schema: Record<string, unknown>,
  maxTokens: number
): Promise<string> {
  try {
    return await chatJsonOnce(cfg, messages, schemaName, schema, maxTokens);
  } catch (err: any) {
    const status = err?.httpStatus;
    const transient = status === 429 || (typeof status === "number" && status >= 500) || !status;
    if (!transient || err?.isTimeout) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return chatJsonOnce(cfg, messages, schemaName, schema, maxTokens);
  }
}

/** Generate ONE document (cv | coverLetter | emailBody) via a focused JSON-schema call. */
async function generateTailoredDoc(
  cfg: { baseUrl: string; model: string; apiKey: string },
  doc: DocRequest
): Promise<string> {
  const messages: ChatMsg[] = [
    {
      role: "system",
      content:
        "You are a world-class professional career consultant and expert copywriter. Respond ONLY with a valid JSON object.",
    },
    { role: "user", content: doc.instructions },
  ];

  const raw = await chatJson(cfg, messages, doc.schemaName, doc.schema, doc.maxTokens);
  const parsed = JSON.parse(extractJsonObject(raw));

  const value = typeof parsed?.[doc.key] === "string" ? parsed[doc.key].trim() : "";
  if (!value) {
    throw new Error(`The AI response was missing the "${doc.key}" document. Please try again.`);
  }
  return value;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const apiKey = process.env.AI_API_KEY ?? process.env.OPENSCALE_API_KEY ?? "";
    if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
      res.status(500).json({
        error:
          "AI_API_KEY is not configured. Add your OpenScale API key as the AI_API_KEY environment variable in Vercel (Settings > Environment Variables), then redeploy.",
      });
      return;
    }

    const { cv, jd } = parseJsonBody(req.body);
    if (!cv || !jd) {
      res.status(400).json({ error: "Missing CV or Job Description content." });
      return;
    }

    const cfg = {
      baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      apiKey,
    };

    const trimmedCV = trimInput(String(cv));
    const trimmedJD = trimInput(String(jd));
    const sharedContext = `\n\nMaster CV:\n${trimmedCV}\n\nJob Description:\n${trimmedJD}`;

    const [cvOut, coverLetter, emailBody] = await Promise.all([
      generateTailoredDoc(cfg, {
        key: "cv",
        schemaName: "tailored_cv",
        schema: CV_SCHEMA,
        maxTokens: CV_MAX_TOKENS,
        instructions: `Tailor the master CV below for the target Job Description.

      CV GUIDELINES:
      - Update the master CV to highlight achievements and skills relevant to the Job Description.
      - Reorder and emphasise relevant experience, but stay truthful to the master CV: never invent employers, dates, titles or credentials.
      - Professional, standard, ATS-friendly format in clean Markdown.
      - Keep it concise (equivalent of one page, roughly 500-650 words).
      - IMPORTANT: Output the COMPLETE CV. Do not cut off mid-sentence.

      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly one key: "cv" (string containing the full Markdown CV).${sharedContext}`,
      }),
      generateTailoredDoc(cfg, {
        key: "coverLetter",
        schemaName: "tailored_cover_letter",
        schema: COVER_LETTER_SCHEMA,
        maxTokens: COVER_LETTER_MAX_TOKENS,
        instructions: `Write a high-impact cover letter for the Job Description below, based on the master CV.

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
      }),
      generateTailoredDoc(cfg, {
        key: "emailBody",
        schemaName: "tailored_email",
        schema: EMAIL_SCHEMA,
        maxTokens: EMAIL_MAX_TOKENS,
        instructions: `Write a concise, effective outreach email to accompany the job application described below.

      EMAIL GUIDELINES:
      - 120 - 180 words for the application.
      - The first line must be the subject line in the form: Subject: ...
      - Reference the attached CV and cover letter.
      - IMPORTANT: Ensure the email is COMPLETE. Do not cut off mid-sentence.

      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly one key: "emailBody" (string).${sharedContext}`,
      }),
    ]);

    res.status(200).json({ cv: cvOut, coverLetter, emailBody });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api] Failed to generate tailored content:", message);
    res.status(500).json({ error: message || "Failed to generate tailored content." });
  }
}
