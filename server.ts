import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { getHealthStatus, runAtsAnalysis, runTailoredGeneration } from "./lib/ai";

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

// API Endpoint: Simple Health & Configuration Check
app.get("/api/health", (req, res) => {
  logToFile("STAGELOG: Received GET /api/health");
  try {
    res.json(getHealthStatus());
  } catch (error: any) {
    res.status(500).json({ status: "error", error: error.message });
  }
});

// API Endpoint: Analyze CV against Job Description (ATS Analysis)
// AI logic lives in lib/ai.ts, shared with the Vercel serverless functions in api/
app.post("/api/analyze-ats", async (req, res) => {
  logToFile("STAGELOG: Received POST /api/analyze-ats");
  try {
    const { cv, jd } = req.body;
    logToFile(`STAGELOG: /api/analyze-ats cv parsed: ${!!cv} (len ${cv?.length || 0}), jd parsed: ${!!jd} (len ${jd?.length || 0})`);
    if (!cv || !jd) {
      logToFile("STAGELOG: Missing CV or JD in request body");
      return res.status(400).json({ error: "Missing CV or Job Description content." });
    }

    logToFile("STAGELOG: Requesting Gemini content generation (ATS analysis)...");
    const result = await runAtsAnalysis(cv, jd);
    logToFile("STAGELOG: Gemini ATS analysis completed successfully.");
    res.json(result);
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

    logToFile("STAGELOG: Requesting Gemini content generation (tailoring)...");
    const result = await runTailoredGeneration(cv, jd);
    logToFile("STAGELOG: Gemini tailoring completed successfully.");
    res.json(result);
  } catch (error: any) {
    logToFile(`STAGELOG ERROR: at /api/generate-tailored: ${error.message || error}`);
    if (error.stack) {
      logToFile(`STAGELOG STACK: ${error.stack}`);
    }
    console.error("Error at /api/generate-tailored:", error);
    res.status(500).json({ error: error.message || "Failed to generate tailored content." });
  }
});

// Start listening immediately to guarantee the HTTP port is bound to incoming traffic and is not blocked by slow Vite startup or exceptions.
app.listen(PORT, "0.0.0.0", () => {
  logToFile(`STAGELOG: Server listening on port ${PORT}`);
  console.log(`Server started successfully. Running on http://localhost:${PORT}`);
});

// Configure Vite middleware in development asynchronously, and serve static output files in production
async function setupSsgAsynchronously() {
  try {
    if (process.env.NODE_ENV !== "production") {
      logToFile("STAGELOG: Starting Vite middleware initialization...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      logToFile("STAGELOG: Vite middleware loaded successfully.");
    } else {
      logToFile("STAGELOG: Serving production static assets...");
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      // Express 5 removed the '*' wildcard route syntax; a final middleware
      // gives the same SPA fallback behavior on both Express 4 and 5.
      app.use((req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      logToFile("STAGELOG: Static production routing registered.");
    }
  } catch (err: any) {
    logToFile(`STAGELOG ERROR in setupSsgAsynchronously: ${err.message || err}`);
    console.error("Failed to setup frontend assets asynchronously:", err);
  }
}

setupSsgAsynchronously();
