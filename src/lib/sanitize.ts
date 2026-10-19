import DOMPurify from 'dompurify';

/**
 * Sanitize externally-sourced HTML (ATS descriptions) before rendering (Req 27).
 * Strips scripts, event handlers, and dangerous tags. Returns plain text if the
 * sanitized result is empty.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'blockquote', 'code', 'pre', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
  return clean;
}
