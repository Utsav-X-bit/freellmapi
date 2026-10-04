import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseCredential, isExpired, refreshCredential, buildAuthUrl } from '../../lib/antigravity-auth.js';

afterEach(() => vi.restoreAllMocks());

describe('antigravity-auth', () => {
  it('parses a valid blob and detects expiry', () => {
    const cred = parseCredential(JSON.stringify({ token: 'ya29.test_a', refresh: 'r', projectId: 'p', expiry: Date.now() + 3600_000, email: 'u@test.com' }));
    expect(cred.email).toBe('u@test.com');
    expect(isExpired(cred)).toBe(false);
    expect(isExpired({ ...cred, expiry: Date.now() - 1000 })).toBe(true);
  });

  it('rejects a non-JSON or tokenless blob', () => {
    expect(() => parseCredential('no-key')).toThrow();
    expect(() => parseCredential(JSON.stringify({ refresh: 'r' }))).toThrow();
  });

  it('refreshes via the token endpoint', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ya29.test_b', expires_in: 3600 }), { status: 200 }));
    const out = await refreshCredential({ token: 'ya29.test_old', refresh: 'refresh.test_x', projectId: 'p', expiry: 0 });
    expect(out.token).toBe('ya29.test_b');
  });

  it('builds a consent URL with PKCE challenge', () => {
    const { url } = buildAuthUrl('state.test_1', 'verifier.test_2');
    expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('code_challenge=');
  });
});
