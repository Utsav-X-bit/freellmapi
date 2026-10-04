import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';
import { decrypt } from '../../lib/crypto.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

let dashToken = '';

async function request(app: Express, method: string, path: string, body?: unknown) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(isGatedApiPath(path) ? { Authorization: `Bearer ${dashToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  server.close();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: json as { url?: string; state?: string; verifier?: string; id?: number } };
}

describe('antigravity device-flow login', () => {
  let app: Express;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    dashToken = mintDashboardToken();
  });

  afterEach(() => vi.restoreAllMocks());

  it('GET /api/antigravity/auth-url returns a Google consent URL', async () => {
    const { status, body } = await request(app, 'GET', '/api/antigravity/auth-url');
    expect(status).toBe(200);
    expect(body.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(body.url).toContain('code_challenge=');
    expect(typeof body.state).toBe('string');
    expect(typeof body.verifier).toBe('string');
  });

  it('POST /api/antigravity/exchange stores a blob row and enables models', async () => {
    const origFetch = global.fetch;
    vi.spyOn(global, 'fetch').mockImplementation(async (u: unknown, init?: unknown) => {
      const url = String(u);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'ya29.test_new', refresh_token: 'refresh.test_new', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('userinfo')) {
        return new Response(JSON.stringify({ email: 'login@test.com' }), { status: 200 });
      }
      if (url.includes('listCloudAICompanionProjects')) {
        return new Response(JSON.stringify({ cloudaicompanionProject: { id: 'proj.test_login' } }), { status: 200 });
      }
      return origFetch(u as string, init as RequestInit);
    });
    const { status } = await request(app, 'POST', '/api/antigravity/exchange', { code: 'code.test_1', state: 'state.test_1', verifier: 'verifier.test_1' });
    expect(status).toBe(201);
    const row = getDb().prepare("SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE platform = 'antigravity'").get() as { encrypted_key: string; iv: string; auth_tag: string };
    const blob = JSON.parse(decrypt(row.encrypted_key, row.iv, row.auth_tag)) as { token?: string; projectId?: string; email?: string };
    expect(blob.token).toBe('ya29.test_new');
    expect(blob.projectId).toBe('proj.test_login');
    expect(blob.email).toBe('login@test.com');
    const enabled = getDb().prepare("SELECT COUNT(*) AS n FROM models WHERE platform = 'antigravity' AND enabled = 1").get() as { n: number };
    expect(enabled.n).toBeGreaterThan(0);
  });

  it('POST /api/antigravity/exchange with a garbage code stores nothing', async () => {
    const origFetch = global.fetch;
    vi.spyOn(global, 'fetch').mockImplementation(async (u: unknown, init?: unknown) => {
      const url = String(u);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response('bad_verification_code', { status: 400 });
      }
      return origFetch(u as string, init as RequestInit);
    });
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM api_keys WHERE platform = 'antigravity'").get() as { n: number }).n;
    const { status } = await request(app, 'POST', '/api/antigravity/exchange', { code: 'code.test_bad', state: 's', verifier: 'v' });
    expect(status).toBe(502);
    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM api_keys WHERE platform = 'antigravity'").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});
