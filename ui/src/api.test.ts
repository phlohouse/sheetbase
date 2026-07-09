import { describe, expect, it } from 'vitest';
import { createSheetForm, insertRows, listRows, listSheetFields, listSheetForms } from './api';

describe('api client', () => {
  it('uses PostgREST endpoints for forms, fields, RPC, and generated rows', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    await listSheetForms(fetcher);
    await listSheetFields('form-1', fetcher);
    await createSheetForm('Companies', ['Company'], fetcher);
    await listRows('sheet_abc', fetcher);
    await insertRows('sheet_abc', [{ company: 'Acme' }], fetcher);

    expect(calls[0].input).toContain('/sheet_forms?select=*&order=created_at.desc');
    expect(calls[1].input).toContain('/sheet_fields?sheet_form_id=eq.form-1');
    expect(calls[2].input).toContain('/rpc/create_sheet_form');
    expect(calls[2].init?.method).toBe('POST');
    expect(calls[2].init?.body).toBe(JSON.stringify({ name: 'Companies', headers: ['Company'] }));
    expect(calls[3].input).toContain('/sheet_abc?select=*');
    expect(calls[4].input).toContain('/sheet_abc');
    expect(calls[4].init?.method).toBe('POST');
    expect(calls[4].init?.body).toBe(JSON.stringify([{ company: 'Acme' }]));
  });
});
