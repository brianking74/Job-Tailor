import { GoogleGenAI, Type } from "@google/genai";

interface SalaryParseResult {
  min: number | null;
  max: number | null;
  currency: string;
}

/**
 * Regex-based Local Salary Parser (fast, zero cost, handles 80%+ of standardized layouts)
 */
export const parseSalaryWithRegex = (text: string): SalaryParseResult | null => {
  if (!text) return null;

  // Cleanup commas and normalize whitespace
  const cleanText = text.replace(/,/g, "").replace(/\s+/g, " ");

  // Currencies matchers
  const currencySymbolMap: Record<string, string> = {
    "\\$": "USD",
    "£": "GBP",
    "€": "EUR",
    "USD": "USD",
    "GBP": "GBP",
    "EUR": "EUR",
    "CAD": "CAD",
    "AUD": "AUD"
  };

  // Find currencies present
  let detectedCurrency = "USD";
  for (const [symbol, code] of Object.entries(currencySymbolMap)) {
    const rx = new RegExp(symbol, "i");
    if (rx.test(cleanText)) {
      detectedCurrency = code;
      break;
    }
  }

  // Common salary range regex patterns (e.g. $80000 - $120000, $80k - $120k)
  // Pattern 1: $80,000 to $120,000 (after commaless cleanup: 80000 to 120000)
  const rangeRegexes = [
    // Matches: 80000 to 120000, 80000 - 120000, 80,000 - 120,000
    /(?:salary|range|compensation)?\s*[\$£€]?\s*(\d{5,6})\s*(?:-|to|and)\s*[\$£€]?\s*(\d{5,6})/i,
    // Matches: 80k to 120k, 80k - 120k, 80K - 120K
    /(?:salary|range|compensation)?\s*[\$£€]?\s*(\d{2,3})\s*k\s*(?:-|to)\s*[\$£€]?\s*(\d{2,3})\s*k/i,
    // Matches single salary: $95,000, 95000 a year
    /(?:salary|paying|compensation)?\s*[\$£€]\s*(\d{5,6})/i,
    /(?:salary|paying|compensation)?\s*(\d{5,6})\s*(?:year|\/yr|annually|per year)/i
  ];

  for (const rx of rangeRegexes) {
    const match = cleanText.match(rx);
    if (match) {
      // Range matched
      if (match[2]) {
        let min = parseInt(match[1], 10);
        let max = parseInt(match[2], 10);

        // Adjust for 'k' notation
        if (rx.source.includes("k")) {
          min *= 1000;
          max *= 1000;
        }

        // Sanity thresholds
        if (min > 10000 && max < 1000000) {
          return { min, max, currency: detectedCurrency };
        }
      } else {
        // Single salary matched
        let base = parseInt(match[1], 10);
        if (base > 10000 && base < 1000000) {
          // Approximate with standard +-10% range or keep flat
          return { min: base, max: base, currency: detectedCurrency };
        }
      }
    }
  }

  return null;
};

/**
 * LLM-based Fallback Salary Parser
 * Activated only when localized regex fails, but text displays salary triggers,
 * using an ultra-low-cost Gemini 3.5 Flash template.
 */
export const parseSalaryWithAi = async (
  description: string,
  title: string
): Promise<SalaryParseResult> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { min: null, max: null, currency: "USD" };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
      Analyze the following Job Title and Description. Extract the expected yearly salary range (minimum and maximum base salary) and the currency code.
      Note:
      - If salaries are hourly, convert to annual base bounds (e.g. $50/hour is around $100,000 / year).
      - If no exact salary range is mentioned, return null for min and max.
      - Return standard ISO 3-letter currency codes (e.g. USD, EUR, GBP, CAD). Default to USD if uncertain.

      Job Title: ${title}
      Job Text Segment:
      ${description.substring(0, 3000)} // Conserve tokens to first 3000 characters
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // Cost-efficient, structured flash model
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            min: { type: Type.INTEGER, description: "Yearly minimum base salary, or null if unspecified" },
            max: { type: Type.INTEGER, description: "Yearly maximum base salary, or null if unspecified" },
            currency: { type: Type.STRING, description: "ISO 3-letter currency code, e.g. USD, GBP" }
          },
          required: ["currency"]
        }
      }
    });

    const textResult = response.text;
    if (!textResult) {
      return { min: null, max: null, currency: "USD" };
    }

    const data = JSON.parse(textResult);
    return {
      min: data.min || null,
      max: data.max || null,
      currency: data.currency || "USD"
    };
  } catch (error) {
    console.error("Failed to parse salary with Gemini API fallback:", error);
    return { min: null, max: null, currency: "USD" };
  }
};

/**
 * Unified Orchestrated Salary Parser
 */
export const parseSalary = async (
  descriptionHtml: string,
  descriptionPlain: string,
  title: string
): Promise<SalaryParseResult> => {
  // 1. Try regex parsing on plain text (fastest, free)
  const regexResult = parseSalaryWithRegex(descriptionPlain);
  if (regexResult) {
    return regexResult;
  }

  // Check if salary keywords even exist in the text before paying AI costs
  const hasSalaryTriggers = /[\$£€]|salary|compensation|paying|hourly|remuneration/i.test(descriptionPlain);
  if (hasSalaryTriggers) {
    // 2. Resolve to Gemini flash extraction
    return await parseSalaryWithAi(descriptionPlain, title);
  }

  // 3. Fallback default
  return { min: null, max: null, currency: "USD" };
};
