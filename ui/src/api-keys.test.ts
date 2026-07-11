import { describe, expect, it } from 'vitest';
import { createAPIKey, listAPIKeys, revokeAPIKey } from './api-keys';

describe('API key client', () => {
  it('manages keys through session-protected admin endpoints', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify([]), { status: init?.method === 'POST' ? 201 : 200 });
    }) as typeof fetch;
    try {
      await listAPIKeys();
      await createAPIKey('Production sync', 'form-1', true);
      await revokeAPIKey('key-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls[0].input).toBe('/admin/api-keys');
    expect(calls[1].init?.body).toBe(JSON.stringify({ name: 'Production sync', sheet_form_id: 'form-1', can_read: true, can_write: true }));
    expect(calls[2]).toMatchObject({ input: '/admin/api-keys/key-1', init: { method: 'DELETE' } });
  });
});
