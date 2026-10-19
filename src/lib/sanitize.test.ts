import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('strips script tags and event handlers', () => {
    const dirty = '<p>Hello</p><script>alert(1)</script><img src=x onerror="alert(2)">';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('<p>Hello</p>');
    expect(clean).not.toContain('<script>');
    expect(clean).not.toContain('onerror');
  });

  it('keeps safe formatting tags', () => {
    expect(sanitizeHtml('<strong>bold</strong> and <em>italic</em>')).toBe(
      '<strong>bold</strong> and <em>italic</em>',
    );
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });
});
