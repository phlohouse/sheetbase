import { describe, expect, it } from 'vitest';
import { createAPIKey, listAPIKeys, revokeAPIKey, updateAPIKeyAccess } from './api-keys';

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
      await createAPIKey('Production sync', ['form-1', 'form-2'], true);
      await updateAPIKeyAccess('key-1', ['form-2', 'form-3'], false);
      await revokeAPIKey('key-1');
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls[0].input).toBe('/admin/api-keys');
    expect(calls[1].init?.body).toBe(JSON.stringify({ name: 'Production sync', sheet_form_ids: ['form-1', 'form-2'], can_write: true, all_sheet_forms: false }));
    expect(calls[2].init?.body).toBe(JSON.stringify({ sheet_form_ids: ['form-2', 'form-3'], can_write: false, all_sheet_forms: false }));
    expect(calls[2]).toMatchObject({ input: '/admin/api-keys/key-1', init: { method: 'PATCH' } });
    expect(calls[3]).toMatchObject({ input: '/admin/api-keys/key-1', init: { method: 'DELETE' } });
  });
});
