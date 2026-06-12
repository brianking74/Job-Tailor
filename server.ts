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

// Initialize the Google Gemini client on the server
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
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

// API Endpoint: Analyze CV against Job Description (ATS Analysis)
app.post("/api/analyze-ats", async (req, res) => {
  try {
    const { cv, jd } = req.body;
    if (!cv || !jd) {
      return res.status(400).json({ error: "Missing CV or Job Description content." });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Analyze the following CV against the provided Job Description. Provide an ATS compatibility score (0-100) and specific improvement suggestions.
      
      CV:
      ${cv}
      
      Job Description:
      ${jd}`,
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
      throw new Error("Empty response from Gemini ATS analysis model.");
    }

    res.json(JSON.parse(text));
  } catch (error: any) {
    console.error("Error at /api/analyze-ats:", error);
    res.status(500).json({ error: error.message || "Failed to analyze documents." });
  }
});

// API Endpoint: Tailor My CV, Cover Letter, and Email
app.post("/api/generate-tailored", async (req, res) => {
  try {
    const { cv, jd } = req.body;
    if (!cv || !jd) {
      return res.status(400).json({ error: "Missing CV or Job Description content." });
    }

    const ai = getGeminiClient();
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
      ${cv}
      
      Job Description:
      ${jd}`,
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
      throw new Error("Empty response from Gemini tailoring model.");
    }

    res.json(JSON.parse(text));
  } catch (error: any) {
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
