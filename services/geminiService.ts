
import { GoogleGenAI, Type } from "@google/genai";
import { ATSAnalysis, TailoredDocuments } from "../types";

export const analyzeATS = async (cv: string, jd: string): Promise<ATSAnalysis> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
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
  if (!text) throw new Error("Empty response from AI analysis model.");
  return JSON.parse(text);
};

export const generateTailoredContent = async (cv: string, jd: string): Promise<TailoredDocuments> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
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
      thinkingConfig: { thinkingBudget: 1000 },
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
  if (!text) throw new Error("Empty response from AI tailoring model.");
  return JSON.parse(text);
};
