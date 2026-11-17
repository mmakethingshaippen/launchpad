// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fetchRetrying } from './fetchRetry';

describe('access challenges are not transient retries', () => {
  it.each([429, 503])('returns a challenged %i immediately without consuming its body', async (status) => {
    const response = new Response('<title>Just a moment...</title>', {
      status, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' },
    });
    const fetchImpl = vi.fn(async () => response);
    expect(await fetchRetrying(fetchImpl, 'https://example.com/jobs', {}, 'test')).toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(false);
  });

  it('still retries an ordinary 429 and accepts the next valid response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect((await fetchRetrying(fetchImpl, 'https://example.com/jobs', {}, 'test')).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
