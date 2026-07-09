import { describe, expect, it } from 'vitest';
import { addSheetField, createSheetForm, hideSheetField, insertRows, listRows, listSheetFields, listSheetForms, listSheetViews, renameSheetForm, tightenSheetFieldType, updateRow, updateSheetViewWidths } from './api';

describe('api client', () => {
  it('uses PostgREST endpoints for forms, fields, RPC, and generated rows', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    await listSheetForms(fetcher);
    await listSheetFields('form-1', fetcher);
    await listSheetViews('form-1', fetcher);
    await createSheetForm('Companies', ['Company'], fetcher);
    await addSheetField('form-1', 'Domain', fetcher);
    await renameSheetForm('form-1', 'Renamed Companies', fetcher);
    await hideSheetField('form-1', 'field-2', fetcher);
    await tightenSheetFieldType('form-1', 'field-2', 'integer', fetcher);
    await updateSheetViewWidths('form-1', { company: 220 }, fetcher);
    await listRows('sheet_abc', fetcher);
    await insertRows('sheet_abc', [{ company: 'Acme' }], fetcher);
    await updateRow('sheet_abc', 'row-1', { company: 'Acme Labs' }, fetcher);

    expect(calls[0].input).toContain('/sheet_forms?select=*&order=created_at.desc');
    expect(calls[1].input).toContain('/sheet_fields?sheet_form_id=eq.form-1');
    expect(calls[2].input).toContain('/sheet_views?sheet_form_id=eq.form-1');
    expect(calls[3].input).toContain('/rpc/create_sheet_form');
    expect(calls[3].init?.method).toBe('POST');
    expect(calls[3].init?.body).toBe(JSON.stringify({ name: 'Companies', headers: ['Company'] }));
    expect(calls[4].input).toContain('/rpc/add_sheet_field');
    expect(calls[4].init?.method).toBe('POST');
    expect(calls[4].init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', name: 'Domain' }));
    expect(calls[5].input).toContain('/rpc/rename_sheet_form');
    expect(calls[5].init?.method).toBe('POST');
    expect(calls[5].init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', name: 'Renamed Companies' }));
    expect(calls[6].input).toContain('/rpc/hide_sheet_field');
    expect(calls[6].init?.method).toBe('POST');
    expect(calls[6].init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', field_id: 'field-2' }));
    expect(calls[7].input).toContain('/rpc/tighten_sheet_field_type');
    expect(calls[7].init?.method).toBe('POST');
    expect(calls[7].init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', field_id: 'field-2', target_type: 'integer' }));
    expect(calls[8].input).toContain('/rpc/update_sheet_view_widths');
    expect(calls[8].init?.method).toBe('POST');
    expect(calls[8].init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', widths: { company: 220 } }));
    expect(calls[9].input).toContain('/sheet_abc?select=*');
    expect(calls[10].input).toContain('/sheet_abc');
    expect(calls[10].init?.method).toBe('POST');
    expect(calls[10].init?.body).toBe(JSON.stringify([{ company: 'Acme' }]));
    expect(calls[11].input).toContain('/sheet_abc?id=eq.row-1');
    expect(calls[11].init?.method).toBe('PATCH');
    expect(calls[11].init?.body).toBe(JSON.stringify({ company: 'Acme Labs' }));
  });

  it('surfaces PostgREST response text on failures', async () => {
    const fetcher = (async () => new Response('permission denied for sheet form', { status: 403 })) as typeof fetch;

    await expect(listSheetForms(fetcher)).rejects.toThrow('permission denied for sheet form');
  });
});
