import { ATSAnalysis, TailoredDocuments } from "../types.ts";

/** Optional user input controlling the tailored generation. */
export interface TailoringOptions {
  /** Up to 3 free-text skills/achievements to weave into every asset. */
  highlights?: string[];
  /** Target cover letter length. Default: "standard". */
  coverLetterLength?: "standard" | "short" | "brief";
}

function cleanHighlights(highlights?: string[]): string[] {
  return (highlights ?? [])
    .filter((h) => typeof h === "string")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Runs a quick diagnostic call to /api/health to pinpoint the exact issue.
 */
async function diagnoseError(originalError: Error): Promise<Error> {
  try {
    const healthResponse = await fetch("/api/health");
    if (!healthResponse.ok) {
      return new Error(`Server started, but returned status ${healthResponse.status} during diagnostics. Original error: ${originalError.message}`);
    }
    const healthData = await healthResponse.json();
    if (!healthData.apiKeyConfigured) {
      return new Error("AI_API_KEY is not configured. Add your OpenScale API key as the AI_API_KEY environment variable in Vercel (Settings > Environment Variables), then redeploy.");
    }
    // If API key is configured and health is OK, the error is likely a transient provider network blockage or a high payload issue
    return new Error(`Network/Gateway error occurs. The AI service is loaded, but the request timed out or was cut by the proxy boundary. Please try submitting again with slightly less text or check your network.`);
  } catch (diagErr) {
    // If we can't play /api/health, the backend server process itself is down/offline
    return new Error("Unable to connect to the server. The backend might still be starting up, rebooting, or is unreachable. Please refresh and try again in a few seconds.");
  }
}

export const analyzeATS = async (cv: string, jd: string): Promise<ATSAnalysis> => {
  try {
    const response = await fetch("/api/analyze-ats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cv, jd }),
    });

    if (!response.ok) {
      let errorMessage = `Server error (Status ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        errorMessage = `Network or Gateway Error (${response.status}). Please try again in a few seconds.`;
      }
      throw new Error(errorMessage);
    }

    return response.json();
  } catch (err: any) {
    if (err.message && (err.message.includes("AI_API_KEY") || err.message.includes("API Key") || err.message.includes("API_KEY"))) {
      throw err;
    }
    const errStr = (err.message || "").toLowerCase();
    const isNetworkError = err.name === 'TypeError' || 
                          errStr.includes("fetch") || 
                          errStr.includes("load failed") || 
                          errStr.includes("network") || 
                          errStr.includes("connect") ||
                          errStr.includes("cors") ||
                          errStr.includes("abort");

    if (isNetworkError) {
      const diagnosticError = await diagnoseError(err);
      throw diagnosticError;
    }
    throw err;
  }
};

export const generateTailoredContent = async (
  cv: string,
  jd: string,
  options: TailoringOptions = {}
): Promise<TailoredDocuments> => {
  try {
    const response = await fetch("/api/generate-tailored", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cv,
        jd,
        highlights: cleanHighlights(options.highlights),
        coverLetterLength: options.coverLetterLength ?? "standard",
      }),
    });

    if (!response.ok) {
      let errorMessage = `Server error (Status ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        errorMessage = `Network or Gateway Error (${response.status}). Please try again in a few seconds.`;
      }
      throw new Error(errorMessage);
    }

    return response.json();
  } catch (err: any) {
    if (err.message && (err.message.includes("AI_API_KEY") || err.message.includes("API Key") || err.message.includes("API_KEY"))) {
      throw err;
    }
    const errStr = (err.message || "").toLowerCase();
    const isNetworkError = err.name === 'TypeError' || 
                          errStr.includes("fetch") || 
                          errStr.includes("load failed") || 
                          errStr.includes("network") || 
                          errStr.includes("connect") ||
                          errStr.includes("cors") ||
                          errStr.includes("abort");

    if (isNetworkError) {
      const diagnosticError = await diagnoseError(err);
      throw diagnosticError;
    }
    throw err;
  }
};

/**
 * Condenses an existing cover letter ("Generate Shorter Version" button).
 * Returns { coverLetter } with the shortened text.
 */
export const shortenCoverLetter = async (
  coverLetter: string,
  jd?: string
): Promise<{ coverLetter: string }> => {
  try {
    const response = await fetch("/api/shorten-cover-letter", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ coverLetter, jd }),
    });

    if (!response.ok) {
      let errorMessage = `Server error (Status ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch (e) {
        errorMessage = `Network or Gateway Error (${response.status}). Please try again in a few seconds.`;
      }
      throw new Error(errorMessage);
    }

    return response.json();
  } catch (err: any) {
    if (err.message && (err.message.includes("AI_API_KEY") || err.message.includes("API Key") || err.message.includes("API_KEY"))) {
      throw err;
    }
    const errStr = (err.message || "").toLowerCase();
    const isNetworkError = err.name === 'TypeError' || 
                          errStr.includes("fetch") || 
                          errStr.includes("load failed") || 
                          errStr.includes("network") || 
                          errStr.includes("connect") ||
                          errStr.includes("cors") ||
                          errStr.includes("abort");

    if (isNetworkError) {
      const diagnosticError = await diagnoseError(err);
      throw diagnosticError;
    }
    throw err;
  }
};
