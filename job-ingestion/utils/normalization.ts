/**
 * Data Normalization and Automatic Tagging Engine
 * Standardizes API records from different sources into common taxonomies.
 */

import { JobRawInput } from "../types/job.ts";

/**
 * Normalizes job type representation
 */
export const normalizeJobType = (
  rawType: string | null | undefined,
  title: string
): "full-time" | "part-time" | "contract" | "internship" | "temporary" | null => {
  if (!rawType) {
    // If not declared, attempt to deduce from title keywords
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("intern") || lowerTitle.includes("co-op")) return "internship";
    if (lowerTitle.includes("contract") || lowerTitle.includes("freelance") || lowerTitle.includes("consultant")) return "contract";
    if (lowerTitle.includes("part-time") || lowerTitle.includes("part time")) return "part-time";
    return "full-time"; // Assume full-time default
  }

  const type = rawType.toLowerCase().replace(/[^a-z]/g, "");

  if (type.includes("full") || type.includes("permanent") || type.includes("ft")) return "full-time";
  if (type.includes("part") || type.includes("pt")) return "part-time";
  if (type.includes("contract") || type.includes("freelance") || type.includes("consult")) return "contract";
  if (type.includes("intern") || type.includes("coop") || type.includes("apprentice")) return "internship";
  if (type.includes("temp") || type.includes("seasonal")) return "temporary";

  return "full-time";
};

/**
 * Normalizes professional experience levels
 */
export const normalizeExperienceLevel = (
  rawLevel: string | null | undefined,
  title: string,
  description: string
): "entry" | "mid" | "senior" | "lead" | null => {
  const combinedText = `${title} ${description}`.toLowerCase();

  // 1. Check explicit level parameters if passed from API
  if (rawLevel) {
    const level = rawLevel.toLowerCase();
    if (level.includes("entry") || level.includes("junior") || level.includes("grad") || level.includes("associate")) return "entry";
    if (level.includes("senior") || level.includes("sr") || level.includes("expert")) return "senior";
    if (level.includes("lead") || level.includes("principal") || level.includes("staff") || level.includes("manager")) return "lead";
    if (level.includes("mid") || level.includes("intermediate")) return "mid";
  }

  // 2. Fallback to title keyword heuristic
  if (combinedText.includes("junior") || combinedText.includes("entry") || combinedText.includes("graduate") || combinedText.includes("trainee") || combinedText.includes("associate")) {
    return "entry";
  }
  if (combinedText.includes("lead") || combinedText.includes("manager") || combinedText.includes("principal") || combinedText.includes("director") || combinedText.includes("staff")) {
    return "lead";
  }
  if (combinedText.includes("senior") || combinedText.includes("sr.") || combinedText.includes("architect") || combinedText.includes("expert")) {
    return "senior";
  }

  // 3. Fallback to experience years regex (e.g. "3+ years of experience")
  const yearsMatch = combinedText.match(/(\d+)\+?\s*years?\s*(?:of)?\s*(?:relevant)?\s*experience/i);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1], 10);
    if (years <= 2) return "entry";
    if (years >= 3 && years <= 5) return "mid";
    if (years >= 6 && years <= 8) return "senior";
    if (years > 8) return "lead";
  }

  return "mid"; // Default middle standard
};

/**
 * Standardizes remote status
 */
export const normalizeRemoteStatus = (
  rawRemote: string | boolean | null | undefined,
  title: string,
  location: string | null | undefined
): "remote" | "hybrid" | "on-site" | null => {
  if (rawRemote === true || rawRemote === "true") return "remote";
  
  const textToScan = `${title} ${location || ""} ${typeof rawRemote === "string" ? rawRemote : ""}`.toLowerCase();

  if (textToScan.includes("remote") || textToScan.includes("anywhere") || textToScan.includes("telecommute") || textToScan.includes("wfh")) {
    return "remote";
  }
  if (textToScan.includes("hybrid") || textToScan.includes("flexible work") || textToScan.includes("partial remote")) {
    return "hybrid";
  }
  if (textToScan.includes("onsite") || textToScan.includes("on-site") || textToScan.includes("office base") || textToScan.includes("in-person")) {
    return "on-site";
  }

  return "on-site"; // Default to physical address if not specified
};

/**
 * Automatic classification tags extractor from job summaries.
 * Prevents list of raw words and isolates important developer keywords.
 */
export const generateAutoTags = (title: string, description: string): string[] => {
  const combinedText = `${title} ${description}`.toLowerCase();
  const matchedTags = new Set<string>();

  const taxonomyMap: Record<string, string[]> = {
    // Languages
    "TypeScript": ["typescript", "ts"],
    "JavaScript": ["javascript", "js", "ecmascript"],
    "Python": ["python", "py"],
    "Java": ["java "], // avoid javascript matches
    "Go": ["golang", " go "],
    "C++": ["c++", "cpp"],
    "C#": ["c#", "csharp"],
    "Ruby": ["ruby", "rails"],
    "PHP": ["php"],
    "Rust": ["rust"],
    "Kotlin": ["kotlin"],
    "Swift": ["swift"],

    // Frameworks
    "React": ["react", "reactjs"],
    "Next.js": ["next.js", "nextjs"],
    "Vue": ["vue", "vuejs"],
    "Angular": ["angular", "angularjs"],
    "Node.js": ["node.js", "nodejs", "npm"],
    "Express": ["express.js", "expressjs"],
    "Django": ["django"],
    "Spring Boot": ["spring boot", "springboot"],
    "Svelte": ["svelte"],

    // Databases & Cache
    "PostgreSQL": ["postgresql", "postgres", "psql"],
    "MySQL": ["mysql"],
    "MongoDB": ["mongodb", "mongo"],
    "Redis": ["redis"],
    "Supabase": ["supabase"],
    "Prisma": ["prisma"],
    "Drizzle": ["drizzle"],

    // DevOps & Cloud
    "AWS": ["aws", "amazon web services", "s3", "ec2"],
    "GCP": ["gcp", "google cloud", "firebase"],
    "Azure": ["azure"],
    "Docker": ["docker", "containerization"],
    "Kubernetes": ["kubernetes", "k8s"],
    "Vercel": ["vercel"],
    "CI/CD": ["ci/cd", "github actions", "gitlab ci", "jenkins"],

    // Architectures & Methods
    "GraphQL": ["graphql"],
    "REST API": ["rest api", "restful api"],
    "Agile": ["agile", "scrum", "kanban"],
    "TDD": ["tdd", "unit test", "jest", "cypress"],

    // Disciplines
    "Frontend": ["frontend", "front-end", "ui developer"],
    "Backend": ["backend", "back-end", "server-side"],
    "Fullstack": ["fullstack", "full-stack"],
    "Mobile": ["ios", "android", "react native", "flutter"],
    "Machine Learning": ["machine learning", " ml ", "deep learning", "ai developer", "llm", "ai agent"]
  };

  for (const [tag, keywords] of Object.entries(taxonomyMap)) {
    for (const keyword of keywords) {
      if (combinedText.includes(keyword)) {
        matchedTags.add(tag);
        break; // skip remaining keywords for this tag
      }
    }
  }

  // Ensure title keywords are elevated if matches aren't found
  const titleKeywords = ["Senior", "Staff", "Lead", "Manager", "Intern"];
  for (const kw of titleKeywords) {
    if (title.includes(kw)) {
      matchedTags.add(kw);
    }
  }

  return Array.from(matchedTags);
};
