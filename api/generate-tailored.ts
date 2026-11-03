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
 */

const DEFAULT_BASE_URL = "https://api.openscale.so/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
const MAX_INPUT_CHARS = 30000;
const TAILORED_MAX_TOKENS = 8000;
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

const TAILORED_SCHEMA = {
  type: "object",
  properties: {
    cv: { type: "string", description: "Markdown formatted tailored CV" },
    coverLetter: { type: "string", description: "Professional cover letter including contact header placeholders" },
    emailBody: { type: "string", description: "A concise, effective outreach email" }
  },
  required: ["cv", "coverLetter", "emailBody"],
  additionalProperties: false
};

async function chatJson(cfg: { baseUrl: string; model: string; apiKey: string }, messages: Array<{ role: string; content: string }>, maxTokens: number, reasoningEffort: string) {
  const body = {
    model: cfg.model,
    messages,
    max_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    response_format: {
      type: "json_schema",
      json_schema: { name: "tailored_documents", strict: true, schema: TAILORED_SCHEMA },
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
      throw new Error(`The AI request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Please try again.`);
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
    throw new Error(`AI provider returned HTTP ${res.status}: ${detail}`);
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

    const raw = await chatJson(
      cfg,
      [
        {
          role: "system",
          content:
            "You are a world-class professional career consultant and expert copywriter. Respond ONLY with a valid JSON object.",
        },
        {
          role: "user",
          content: `Your task is to generate a tailored CV, a high-impact cover letter, and a concise outreach email.

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

      EMAIL GUIDELINES:
      - A concise, effective outreach email (120 - 180 words) for the application.
      - The first line must be the subject line in the form: Subject: ...
      - Reference the attached CV and cover letter.

      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly these keys: "cv", "coverLetter", "emailBody" (all strings).

      Master CV:
      ${trimmedCV}
      
      Job Description:
      ${trimmedJD}`,
        },
      ],
      TAILORED_MAX_TOKENS,
      "low"
    );

    const parsed = JSON.parse(extractJsonObject(raw));

    const cvOut = typeof parsed?.cv === "string" ? parsed.cv.trim() : "";
    const coverLetter = typeof parsed?.coverLetter === "string" ? parsed.coverLetter.trim() : "";
    const emailBody = typeof parsed?.emailBody === "string" ? parsed.emailBody.trim() : "";
    if (!cvOut || !coverLetter || !emailBody) {
      throw new Error(
        "The AI response was missing one or more required documents (cv, coverLetter, emailBody). Please try again."
      );
    }

    res.status(200).json({ cv: cvOut, coverLetter, emailBody });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api] Failed to generate tailored content:", message);
    res.status(500).json({ error: message || "Failed to generate tailored content." });
  }
}
