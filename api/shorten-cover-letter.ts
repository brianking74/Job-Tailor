/**
 * POST /api/shorten-cover-letter — condense an existing cover letter to
 * roughly 55% of its current length (clamped to 80-250 words).
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
 * Body: { coverLetter: string (required), jd?: string (context only) }
 * Response 200: { coverLetter: string }
 */

const DEFAULT_BASE_URL = "https://api.openscale.so/v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
const MAX_INPUT_CHARS = 30000;
const LETTER_MAX_CHARS = 20000;
const SHORTEN_MAX_TOKENS = 1200;
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

const SHORTEN_SCHEMA = {
  type: "object",
  properties: {
    shortenedCoverLetter: { type: "string", description: "The condensed cover letter" },
  },
  required: ["shortenedCoverLetter"],
  additionalProperties: false,
};

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

interface ChatMsg {
  role: string;
  content: string;
}

async function chatJsonOnce(
  cfg: { baseUrl: string; model: string; apiKey: string },
  messages: ChatMsg[]
): Promise<string> {
  const body = {
    model: cfg.model,
    messages,
    max_tokens: SHORTEN_MAX_TOKENS,
    reasoning_effort: "none",
    response_format: {
      type: "json_schema",
      json_schema: { name: "shortened_cover_letter", strict: true, schema: SHORTEN_SCHEMA },
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
  messages: ChatMsg[]
): Promise<string> {
  try {
    return await chatJsonOnce(cfg, messages);
  } catch (err: any) {
    const status = err?.httpStatus;
    const transient = status === 429 || (typeof status === "number" && status >= 500) || !status;
    if (!transient || err?.isTimeout) throw err;
    await new Promise((r) => setTimeout(r, 1200));
    return chatJsonOnce(cfg, messages);
  }
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

    const { coverLetter, jd } = parseJsonBody(req.body);
    const letter = typeof coverLetter === "string" ? coverLetter.trim() : "";
    if (!letter) {
      res.status(400).json({ error: "Missing cover letter content to shorten." });
      return;
    }

    const cfg = {
      baseUrl: (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      apiKey,
    };

    const trimmedLetter = letter.length > LETTER_MAX_CHARS ? letter.slice(0, LETTER_MAX_CHARS) : letter;
    const trimmedJD = typeof jd === "string" && jd.trim() ? trimInput(jd.trim()) : "";
    const targetWords = Math.min(250, Math.max(80, Math.round(countWords(trimmedLetter) * 0.55)));

    const messages: ChatMsg[] = [
      {
        role: "system",
        content:
          "You are a world-class professional career consultant and expert copywriter. Respond ONLY with a valid JSON object.",
      },
      {
        role: "user",
        content: `Condense the cover letter below to approximately ${targetWords} words.

      RULES:
      - Keep the strongest achievements, the professional structure (greeting, body, call to action, sign-off) and the original tone.
      - Do NOT add new claims, facts, skills or numbers that are not in the original letter.
      - Remove filler and redundancy, not substance.
      - IMPORTANT: Ensure the letter is COMPLETE. Do not cut off mid-sentence.
      ${trimmedJD ? `\n      The letter was written for this Job Description (for context only):\n      ${trimmedJD}` : ""}
      OUTPUT FORMAT:
      - Respond with ONLY a JSON object with exactly one key: "shortenedCoverLetter" (string).

      Cover letter to condense:
      ${trimmedLetter}`,
      },
    ];

    const raw = await chatJson(cfg, messages);
    const parsed = JSON.parse(extractJsonObject(raw));

    const value = typeof parsed?.shortenedCoverLetter === "string" ? parsed.shortenedCoverLetter.trim() : "";
    if (!value) {
      throw new Error('The AI response was missing the "shortenedCoverLetter" document. Please try again.');
    }

    res.status(200).json({ coverLetter: value });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api] Failed to shorten cover letter:", message);
    res.status(500).json({ error: message || "Failed to shorten the cover letter." });
  }
}
