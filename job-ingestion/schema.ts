import { pgTable, text, timestamp, integer, boolean, varchar, index, unique } from 'drizzle-orm/pg-core';

/**
 * Jobs Table Schema
 * Stores normalized job listings ingested from various job board APIs
 */
export const jobs = pgTable('jobs', {
  id: varchar('id', { length: 255 }).primaryKey(), // Unique UUID or custom parsed string (e.g., "${source}:${external_id}")
  externalId: varchar('external_id', { length: 255 }).notNull(), // Source-specific ID
  source: varchar('source', { length: 50 }).notNull(), // API source name (e.g., 'adzuna', 'arbeitnow', 'reed')
  title: varchar('title', { length: 255 }).notNull(),
  company: varchar('company', { length: 255 }).notNull(),
  location: varchar('location', { length: 255 }),
  salaryMin: integer('salary_min'), // Normalized yearly minimum salary in local currency
  salaryMax: integer('salary_max'), // Normalized yearly maximum salary in local currency
  currency: varchar('currency', { length: 10 }).default('USD'),
  jobType: varchar('job_type', { length: 50 }), // 'full-time', 'part-time', 'contract', 'internship', 'temporary'
  experienceLevel: varchar('experience_level', { length: 50 }), // 'entry', 'mid', 'senior', 'lead'
  remote: varchar('remote', { length: 50 }), // 'remote', 'hybrid', 'on-site'
  tags: text('tags').array(), // Postgres text array for fast, simple categorization
  descriptionHtml: text('description_html').notNull(), // Sanitized HTML version
  descriptionMarkdown: text('description_markdown'), // Perfect for LLM operations (JobTailor application)
  descriptionPlain: text('description_plain').notNull(), // Clean text version for vector embeddings or simple search
  url: text('url').notNull(), // Original apply / job URL
  companyLogo: text('company_logo'), // URL to company logo
  postedAt: timestamp('posted_at').notNull(), // Date the job was originally posted
  lastSyncedAt: timestamp('last_synced_at').notNull().defaultNow(), // Pipeline synchronization timestamp
  expiresAt: timestamp('expires_at').notNull(), // Job automatic expiration date (e.g. posted_at + 45 days)
  isActive: boolean('is_active').notNull().default(true), // Expiration/manual deletion flag
}, (table) => {
  return {
    sourceExtIdIdx: unique('source_ext_id_uniq').on(table.source, table.externalId),
    urlUniqIdx: unique('url_uniq').on(table.url),
    titleCompanyIdx: index('title_company_idx').on(table.title, table.company),
    postedAtIdx: index('posted_at_idx').on(table.postedAt),
    expiresAtIdx: index('expires_at_idx').on(table.expiresAt),
    tagsIdx: index('tags_idx').on(table.tags),
    isActiveIdx: index('is_active_idx').on(table.isActive),
  };
});

/**
 * Ingestion Logs Table Schema
 * Audits pipeline performance, tracking jobs fetched, processed, deduplicated, and any errors.
 */
export const ingestionLogs = pgTable('ingestion_logs', {
  id: varchar('id', { length: 255 }).primaryKey(),
  source: varchar('source', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(), // 'success', 'failed', 'partial'
  jobsFetched: integer('jobs_fetched').notNull().default(0),
  jobsParsed: integer('jobs_parsed').notNull().default(0),
  jobsSaved: integer('jobs_saved').notNull().default(0),
  jobsDeduplicated: integer('jobs_deduplicated').notNull().default(0),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => {
  return {
    sourceLogIdx: index('source_log_idx').on(table.source),
    statusIdx: index('status_idx').on(table.status),
    startedAtIdx: index('started_at_idx').on(table.startedAt),
  };
});
