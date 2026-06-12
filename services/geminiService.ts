import { ATSAnalysis, TailoredDocuments } from "../types.ts";

export const analyzeATS = async (cv: string, jd: string): Promise<ATSAnalysis> => {
  const response = await fetch("/api/analyze-ats", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cv, jd }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to analyze documents. Please check that your Gemini API Key is configured in Settings.");
  }

  return response.json();
};

export const generateTailoredContent = async (cv: string, jd: string): Promise<TailoredDocuments> => {
  const response = await fetch("/api/generate-tailored", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cv, jd }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to generate tailored CV and documents. Please check that your Gemini API Key is configured in Settings.");
  }

  return response.json();
};
