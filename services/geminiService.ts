import { ATSAnalysis, TailoredDocuments } from "../types.ts";

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
      return new Error("GEMINI_API_KEY is not configured or is a placeholder. Please set your Gemini API Key in the Settings > Secrets panel of AI Studio.");
    }
    // If API key is configured and health is OK, the error is likely a transient Gemini network blockage or a high payload issue
    return new Error(`Network/Gateway error occurs. Gemini API is loaded, but the request timed out or was cut by the proxy boundary. Please try submitting again with slightly less text or check your network.`);
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
    if (err.message && (err.message.includes("GEMINI_API_KEY") || err.message.includes("API Key") || err.message.includes("API_KEY"))) {
      throw err;
    }
    if (err.message && err.message.includes("Failed to fetch")) {
      const diagnosticError = await diagnoseError(err);
      throw diagnosticError;
    }
    throw err;
  }
};

export const generateTailoredContent = async (cv: string, jd: string): Promise<TailoredDocuments> => {
  try {
    const response = await fetch("/api/generate-tailored", {
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
    if (err.message && (err.message.includes("GEMINI_API_KEY") || err.message.includes("API Key") || err.message.includes("API_KEY"))) {
      throw err;
    }
    if (err.message && err.message.includes("Failed to fetch")) {
      const diagnosticError = await diagnoseError(err);
      throw diagnosticError;
    }
    throw err;
  }
};
