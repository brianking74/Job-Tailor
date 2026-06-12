import { z } from 'zod';

/**
 * Zod validation schema for raw, incoming jobs before pipeline normalization.
 */
export const jobRawSchema = z.object({
  externalId: z.string().min(1, "externalId is required"),
  source: z.string().min(1, "source is required"),
  title: z.string().min(1, "title is required"),
  company: z.string().min(1, "company is required"),
  location: z.string().optional().nullable(),
  salaryMin: z.number().optional().nullable(),
  salaryMax: z.number().optional().nullable(),
  currency: z.string().default('USD'),
  jobType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'temporary']).optional().nullable(),
  experienceLevel: z.enum(['entry', 'mid', 'senior', 'lead']).optional().nullable(),
  remote: z.enum(['remote', 'hybrid', 'on-site']).optional().nullable(),
  tags: z.array(z.string()).optional(),
  descriptionHtml: z.string().min(1, "descriptionHtml is required"),
  descriptionPlain: z.string().optional(),
  url: z.string().url("Valid URL or original source job link is required"),
  companyLogo: z.string().url().optional().nullable(),
  postedAt: z.union([z.string(), z.date()]),
});

export type JobRawInput = z.infer<typeof jobRawSchema>;

/**
 * Normalized Job Interface (matches the final PostgreSQL Database entity structure)
 */
export interface JobNormalized {
  id: string; // generated custom key
  externalId: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  jobType: 'full-time' | 'part-time' | 'contract' | 'internship' | 'temporary' | null;
  experienceLevel: 'entry' | 'mid' | 'senior' | 'lead' | null;
  remote: 'remote' | 'hybrid' | 'on-site' | null;
  tags: string[];
  descriptionHtml: string;
  descriptionMarkdown: string;
  descriptionPlain: string;
  url: string;
  companyLogo: string | null;
  postedAt: Date;
  lastSyncedAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

/**
 * Struct for logging and performance metrics
 */
export interface IngestionResult {
  source: string;
  fetched: number;
  parsed: number;
  saved: number;
  deduplicated: number;
  errors: string[];
}
