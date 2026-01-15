
export enum AppStep {
  LANDING = 'landing',
  UPLOAD_CV = 'upload_cv',
  JOB_DETAILS = 'job_details',
  ANALYSIS = 'analysis',
  TAILORING = 'tailoring',
  OUTREACH = 'outreach'
}

export interface CVData {
  content: string;
  fileName: string;
}

export interface JobDescription {
  text: string;
  role?: string;
  company?: string;
}

export interface ATSAnalysis {
  score: number;
  missingKeywords: string[];
  strengths: string[];
  suggestions: string[];
}

export interface TailoredDocuments {
  cv: string;
  coverLetter: string;
  emailBody: string;
}
