/**
 * POST /api/analyze-ats — ATS compatibility score for a CV vs a job description.
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
const ATS_MAX_TOKENS = 2000;
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

function normalizeAtsAnalysis(parsed: any) {
  const rawScore = typeof parsed?.score === "number" ? parsed.score : Number(parsed?.score);
  const score = Number.isFinite(rawScore) ? Math.min(100, Math.max(0, Math.round(rawScore))) : 0;
  return {
    score,
    missingKeywords: toStringArray(parsed?.missingKeywords),
    strengths: toStringArray(parsed?.strengths),
    suggestions: toStringArray(parsed?.suggestions),
  };
}

async function chatJson(cfg: { baseUrl: string; model: string; apiKey: string }, messages: Array<{ role: string; content: string }>, maxTokens: number) {
  const body = {
    model: cfg.model,
    messages,
    max_tokens: maxTokens,
    reasoning_effort: "none",
    response_format: {
      type: "json_schema",
      json_schema: { name: "ats_analysis", strict: true, schema: ATS_ANALYSIS_SCHEMA },
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

    const messages = [
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
    const raw = await chatJson(cfg, messages, ATS_MAX_TOKENS);
    try {
      parsed = JSON.parse(extractJsonObject(raw));
    } catch {
      // One repair attempt if the provider ignored the JSON guarantee.
      const repair = await chatJson(
        cfg,
        [
          ...messages,
          { role: "assistant", content: String(raw).slice(0, 4000) },
          {
            role: "user",
            content:
              'The message above was supposed to be ONLY a JSON object with keys "score" (number), "missingKeywords", "strengths" and "suggestions" (arrays of strings). Reply with the corrected JSON object and nothing else.',
          },
        ],
        ATS_MAX_TOKENS
      );
      parsed = JSON.parse(extractJsonObject(repair));
    }

    res.status(200).json(normalizeAtsAnalysis(parsed));
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api] Failed to analyze documents:", message);
    res.status(500).json({ error: message || "Failed to analyze documents." });
  }
}
