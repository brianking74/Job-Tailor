/**
 * HTML Sanitizer & Parser Utilities
 * Safeguards job posts from external sources and prepares description content for database search and AI operations.
 */

/**
 * Sanitizes incoming raw HTML descriptions.
 * Custom implementation designed to be fast and completely dependency-free for Serverless deployment.
 * Removes hazardous tags (scripts, iframes, objects) and inline javascript event listeners.
 */
export const sanitizeHtml = (rawHtml: string): string => {
  if (!rawHtml) return "";

  let cleaned = rawHtml;

  // 1. Remove dangerous script and style tags and their contents
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
  cleaned = cleaned.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "");
  cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "");

  // 2. Remove internal event listeners on standard HTML elements (e.g. onload, onerror, onclick)
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*(["']).*?\1/gi, "");
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*\w+/gi, "");

  // 3. Remove "javascript:" pseudo-protocols inside anchors or source hrefs
  cleaned = cleaned.replace(/href\s*=\s*(["'])javascript:.*?\1/gi, 'href="#"');

  return cleaned.trim();
};

/**
 * Converts sanitized HTML descriptions into clean Markdown tags.
 * Conserves API payload size and maximizes comprehension accuracy when inputted to the JobTailor AI engine.
 */
export const htmlToMarkdown = (html: string): string => {
  if (!html) return "";

  let markdown = html;

  // Replace block formatting tags
  markdown = markdown.replace(/<h1>(.*?)<\/h1>/gi, "\n# $1\n");
  markdown = markdown.replace(/<h2>(.*?)<\/h2>/gi, "\n## $1\n");
  markdown = markdown.replace(/<h3>(.*?)<\/h3>/gi, "\n### $1\n");
  markdown = markdown.replace(/<h4>(.*?)<\/h4>/gi, "\n#### $1\n");
  
  markdown = markdown.replace(/<p>(.*?)<\/p>/gi, "\n$1\n");
  markdown = markdown.replace(/<br\s*\/?>/gi, "\n");

  // Bold / Italic tags
  markdown = markdown.replace(/<strong>(.*?)<\/strong>/gi, "**$1**");
  markdown = markdown.replace(/<b>(.*?)<\/b>/gi, "**$1**");
  markdown = markdown.replace(/<em>(.*?)<\/em>/gi, "*$1*");
  markdown = markdown.replace(/<i>(.*?)<\/i>/gi, "*$1*");

  // Bullet items
  markdown = markdown.replace(/<li>(.*?)<\/li>/gi, "\n- $1");
  markdown = markdown.replace(/<ul[^>]*>/gi, "");
  markdown = markdown.replace(/<\/ul>/gi, "\n");
  markdown = markdown.replace(/<ol[^>]*>/gi, "");
  markdown = markdown.replace(/<\/ol>/gi, "\n");

  // Links
  markdown = markdown.replace(/<a\s+[^>]*href=["'](.*?)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)");

  // Strip remaining HTML tags
  markdown = markdown.replace(/<[^>]*>/g, "");

  // Clean double spaces and empty lines
  markdown = markdown.replace(/\n\s*\n\s*\n/g, "\n\n");

  return markdown.trim();
};

/**
 * Strips all HTML to retrieve structural plain text.
 * Used primarily for full-text search indexing, keyword matching, and vector embeddings.
 */
export const htmlToPlainText = (html: string): string => {
  if (!html) return "";

  let text = html;

  // Replace formatting elements with linebreaks or spacing
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");

  // Strip all left-over HTML brackets cleanly
  text = text.replace(/<[^>]*>/g, " ");

  // Unescape common HTML properties
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean trailing spaces and excessive formatting
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n\s*\n+/g, "\n\n");

  return text.trim();
};
