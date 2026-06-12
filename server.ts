import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

// Load development environment variables from .env.local if present
function loadDevEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const match = line.trim().match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
}

loadDevEnv();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Global middleware to log all incoming requests
app.use((req, res, next) => {
  logToFile(`GLOBAL_REQ: ${req.method} ${req.url}`);
  next();
});

// Force browsers and proxies to bypass caching of dynamic SPA files and index pages
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Utility to write diagnostics to a workspace log file
const logToFile = (message: string) => {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(path.join(process.cwd(), 'server_log.txt'), `[${timestamp}] ${message}\n`);
  } catch (err) {
    console.error("Failed to write to server_log.txt:", err);
  }
};

// Initialize the Google Gemini client on the server
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  logToFile(`getGeminiClient: apiKey check. Exists: ${!!apiKey}, Starts with PLACEHOLDER: ${apiKey?.startsWith("PLACEHOLDER")}, Length: ${apiKey?.length}`);
  if (!apiKey || apiKey === "PLACEHOLDER_API_KEY") {
    throw new Error("GEMINI_API_KEY is not configured or is a placeholder. Please set your Gemini API Key in the Settings > Secrets panel of AI Studio.");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

// API Endpoint: Simple Health & Configuration Check
app.get("/api/health", (req, res) => {
  logToFile("STAGELOG: Received GET /api/health");
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    res.json({
      status: "ok",
      apiKeyConfigured: !!apiKey && apiKey !== "PLACEHOLDER_API_KEY" && apiKey.length > 0,
      apiKeyLength: apiKey ? apiKey.length : 0,
    });
  } catch (error: any) {
    res.status(500).json({ status: "error", error: error.message });
  }
});

// API Endpoint: Analyze CV against Job Description (ATS Analysis)
app.post("/api/analyze-ats", async (req, res) => {
  logToFile("STAGELOG: Received POST /api/analyze-ats");
  try {
    const { cv, jd } = req.body;
    logToFile(`STAGELOG: /api/analyze-ats cv parsed: ${!!cv} (len ${cv?.length || 0}), jd parsed: ${!!jd} (len ${jd?.length || 0})`);
    if (!cv || !jd) {
      logToFile("STAGELOG: Missing CV or JD in request body");
      return res.status(400).json({ error: "Missing CV or Job Description content." });
    }

    // Safety: Truncate oversized pasted text to 30k chars to prevent token bloat and gateway timeout
    const trimmedCV = cv.length > 30000 ? cv.substring(0, 30000) + "\n... [Content truncated for processing speed]" : cv;
    const trimmedJD = jd.length > 30000 ? jd.substring(0, 30000) + "\n... [Content truncated for processing speed]" : jd;

    const ai = getGeminiClient();
    logToFile("STAGELOG: Gemini client initialized successfully. Requesting content generation...");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
    logToFile(`STAGELOG: Gemini response received: ${!!text} (len ${text?.length || 0})`);
    if (!text) {
      throw new Error("Empty response received from Gemini ATS analysis.");
    }

    // Clean markdown wrappers if any are returned by some models
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    }

    res.json(JSON.parse(cleanedText));
  } catch (error: any) {
    logToFile(`STAGELOG ERROR: at /api/analyze-ats: ${error.message || error}`);
    if (error.stack) {
      logToFile(`STAGELOG STACK: ${error.stack}`);
    }
    console.error("Error at /api/analyze-ats:", error);
    res.status(500).json({ error: error.message || "Failed to analyze documents." });
  }
});

// API Endpoint: Tailor My CV, Cover Letter, and Email
app.post("/api/generate-tailored", async (req, res) => {
  logToFile("STAGELOG: Received POST /api/generate-tailored");
  try {
    const { cv, jd } = req.body;
    logToFile(`STAGELOG: /api/generate-tailored cv parsed: ${!!cv} (len ${cv?.length || 0}), jd parsed: ${!!jd} (len ${jd?.length || 0})`);
    if (!cv || !jd) {
      logToFile("STAGELOG: Missing CV or JD in request body");
      return res.status(400).json({ error: "Missing CV or Job Description content." });
    }

    // Safety: Truncate oversized pasted text to 30k chars to prevent token bloat and gateway timeout
    const trimmedCV = cv.length > 30000 ? cv.substring(0, 30000) + "\n... [Content truncated for processing speed]" : cv;
    const trimmedJD = jd.length > 30000 ? jd.substring(0, 30000) + "\n... [Content truncated for processing speed]" : jd;

    const ai = getGeminiClient();
    logToFile("STAGELOG: Gemini client initialized successfully. Requesting content generation for tailoring...");
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
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
    logToFile(`STAGELOG: Gemini response received: ${!!text} (len ${text?.length || 0})`);
    if (!text) {
      throw new Error("Empty response received from Gemini tailoring model.");
    }

    // Clean markdown wrappers if any are returned by some models
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```")) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    }

    res.json(JSON.parse(cleanedText));
  } catch (error: any) {
    logToFile(`STAGELOG ERROR: at /api/generate-tailored: ${error.message || error}`);
    if (error.stack) {
      logToFile(`STAGELOG STACK: ${error.stack}`);
    }
    console.error("Error at /api/generate-tailored:", error);
    res.status(500).json({ error: error.message || "Failed to generate tailored content." });
  }
});

// Configure Vite middleware in development, and serve static output files in production
async function setupSsgAndStart() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server started successfully. Running on http://localhost:${PORT}`);
  });
}

setupSsgAndStart();
