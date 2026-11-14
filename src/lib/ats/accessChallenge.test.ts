// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blockedReason, detectAccessChallenge, isBlockedReason } from './accessChallenge';

const h = (values: Record<string, string>) => new Headers(values);
const CF_PAGE = '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>';

describe('detectAccessChallenge', () => {
  it('recognises the Cloudflare cf-mitigated header (as observed from www.themuse.com)', () => {
    const c = detectAccessChallenge(403, h({ 'cf-mitigated': 'challenge', server: 'cloudflare' }));
    expect(c).toEqual({ vendor: 'cloudflare', evidence: 'cf-mitigated=challenge (HTTP 403)' });
    expect(blockedReason(c!)).toBe('blocked:cloudflare-challenge');
  });

  it('recognises AWS WAF challenge and captcha actions', () => {
    expect(detectAccessChallenge(405, h({ 'x-amzn-waf-action': 'captcha' }))?.vendor).toBe('aws-waf');
    expect(detectAccessChallenge(202, h({ 'x-amzn-waf-action': 'challenge' }))?.vendor).toBe('aws-waf');
  });

  it('recognises a Cloudflare challenge page only on a refusal status from a Cloudflare server', () => {
    expect(detectAccessChallenge(403, h({ server: 'cloudflare' }), CF_PAGE)?.vendor).toBe('cloudflare');
    expect(detectAccessChallenge(503, h({ server: 'cloudflare' }), CF_PAGE)?.vendor).toBe('cloudflare');
    expect(detectAccessChallenge(200, h({ server: 'cloudflare' }), CF_PAGE)).toBeNull();
    expect(detectAccessChallenge(403, h({ server: 'nginx' }), CF_PAGE)).toBeNull();
  });

  it('does not treat a plain 403 as a challenge', () => {
    expect(detectAccessChallenge(403, h({}), 'Forbidden')).toBeNull();
    expect(detectAccessChallenge(403, h({ server: 'cloudflare' }), 'Forbidden')).toBeNull();
    expect(detectAccessChallenge(403, null)).toBeNull();
    expect(detectAccessChallenge(403, h({ 'cf-mitigated': 'none' }))).toBeNull();
  });

  it('identifies stored blocked reasons by prefix only', () => {
    expect(isBlockedReason('blocked:cloudflare-challenge')).toBe(true);
    expect(isBlockedReason('http-403')).toBe(false);
    expect(isBlockedReason(null)).toBe(false);
  });
});