import { ATSAnalysis, TailoredDocuments } from "../types.ts";

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
      throw new Error("Unable to connect to the server. Please verify your connection or check if the backend is booting up.");
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
      throw new Error("Unable to connect to the server. Please verify your connection or check if the backend is booting up.");
    }
    throw err;
  }
};
