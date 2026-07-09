import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('supports the local Sheet Form editing lifecycle', () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText('Header 3'), { target: { value: 'Source list' } });
    expect(screen.getByDisplayValue('Source list')).toBeTruthy();

    fireEvent.change(screen.getAllByLabelText('Company value')[0], { target: { value: 'Acme Labs' } });
    fireEvent.change(screen.getAllByLabelText('Domain value')[0], { target: { value: 'acme.test' } });
    expect(screen.getByDisplayValue('Acme Labs')).toBeTruthy();
    expect(screen.getByDisplayValue('acme.test')).toBeTruthy();

    const companyInputs = screen.getAllByLabelText('Company value');
    fireEvent.change(companyInputs.at(-1)!, { target: { value: 'NewCo' } });
    expect(screen.getAllByLabelText('Company value').length).toBeGreaterThan(companyInputs.length);

    fireEvent.click(screen.getByLabelText('Add column'));
    expect(screen.getByLabelText('Header 7')).toBeTruthy();
  });

  it('saves headers and rows through PostgREST', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      if (String(input).includes('/rpc/create_sheet_form')) {
        return new Response(JSON.stringify({
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_abc',
        }), { status: 200 });
      }
      if (String(input).includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { name: 'Domain', column_name: 'domain', position: 1, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Saved \d+ rows/)).toBeTruthy();
    expect(calls[0].input).toContain('/rpc/create_sheet_form');
    expect(calls[0].init?.body).toBe(JSON.stringify({
      name: 'Companies',
      headers: ['Company', 'Domain', 'Source records', 'Schema fit', 'Rows', 'API status'],
    }));
    expect(calls[1].input).toContain('/sheet_fields?sheet_form_id=eq.form-1');
    expect(calls[2].input).toContain('/sheet_abc');
    expect(calls[2].init?.method).toBe('POST');
    expect(calls[2].init?.body).toContain('"company":"Vercel"');
    expect(calls[2].init?.body).toContain('"domain":"vercel.com"');
  });

  it('imports header columns from a Stencil config', async () => {
    const { container } = render(<App />);
    const file = new File([`
name: contacts
versions:
  "v1.0":
    fields:
      full_name: { cell: A2 }
      contact_table:
        range: A10:C
        type: table
        columns:
          A: Email
          B: Company
`], 'contacts.stencil.yaml', { type: 'text/yaml' });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByText('Imported 3 headers')).toBeTruthy();
    expect(screen.getByDisplayValue('Full Name')).toBeTruthy();
    expect(screen.getByDisplayValue('Email')).toBeTruthy();
    expect(screen.getByDisplayValue('Company')).toBeTruthy();
  });
});
