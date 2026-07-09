import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
          name: 'Untitled Sheet Form',
          generated_table_name: 'sheet_abc',
        }), { status: 200 });
      }
      if (String(input).includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Domain', column_name: 'domain', position: 1, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/sheet_abc') && call.init?.method === 'POST')).toBe(true);
    });
    const createCall = calls.find((call) => call.input.includes('/rpc/create_sheet_form'));
    const fieldsCall = calls.find((call) => call.input.includes('/sheet_fields?sheet_form_id=eq.form-1'));
    const insertCall = calls.find((call) => call.input.includes('/sheet_abc') && call.init?.method === 'POST');
    expect(createCall?.input).toContain('/rpc/create_sheet_form');
    expect(createCall?.init?.body).toBe(JSON.stringify({
      name: 'Companies',
      headers: ['Company', 'Domain', 'Source records', 'Schema fit', 'Rows', 'API status'],
    }));
    expect(fieldsCall?.input).toContain('/sheet_fields?sheet_form_id=eq.form-1');
    expect(insertCall?.init?.body).toContain('"company":"Vercel"');
    expect(insertCall?.init?.body).toContain('"domain":"vercel.com"');
  });

  it('creates a new Sheet Form with an editable name', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      if (String(input).includes('/rpc/create_sheet_form')) {
        return new Response(JSON.stringify({
          id: 'form-1',
          slug: 'requests',
          name: 'Support Requests',
          generated_table_name: 'sheet_requests',
        }), { status: 200 });
      }
      if (String(input).includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Requester', column_name: 'requester', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Issue', column_name: 'issue', position: 1, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New form' }));
    fireEvent.change(screen.getByLabelText('Sheet Form name'), { target: { value: 'Support Requests' } });
    fireEvent.change(screen.getByLabelText('Header 1'), { target: { value: 'Requester' } });
    fireEvent.change(screen.getByLabelText('Header 2'), { target: { value: 'Issue' } });
    fireEvent.change(screen.getAllByLabelText('Requester value')[0], { target: { value: 'Gareth' } });
    fireEvent.change(screen.getAllByLabelText('Issue value')[0], { target: { value: 'Cannot log in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/create_sheet_form'))).toBe(true);
    });
    const createCall = calls.find((call) => call.input.includes('/rpc/create_sheet_form'));
    expect(createCall?.init?.body).toBe(JSON.stringify({
      name: 'Support Requests',
      headers: ['Requester', 'Issue'],
    }));
  });

  it('shows save errors and lets the user retry', async () => {
    let insertAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rpc/create_sheet_form')) {
        return new Response(JSON.stringify({
          id: 'form-1',
          slug: 'companies',
          name: 'Untitled Sheet Form',
          generated_table_name: 'sheet_abc',
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_abc') && init?.method === 'POST') {
        insertAttempts += 1;
        if (insertAttempts === 1) {
          return new Response('database is unavailable', { status: 503 });
        }
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'New form' }));
    fireEvent.change(screen.getByLabelText('Header 1'), { target: { value: 'Company' } });
    fireEvent.change(screen.getAllByLabelText('Company value')[0], { target: { value: 'Acme Labs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('database is unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(insertAttempts).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Saved \d+ row/);
    });
  });

  it('loads the latest Sheet Form from PostgREST', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([{
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_abc',
        }]), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Domain', column_name: 'domain', position: 1, type: 'text', hidden: false },
          { id: 'field-3', name: 'Internal', column_name: 'internal', position: 2, type: 'text', hidden: true },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_abc')) {
        return new Response(JSON.stringify([
          { id: 'row-1', company: 'Acme Labs', domain: 'acme.test', internal: 'secret' },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();
    expect(screen.getByDisplayValue('acme.test')).toBeTruthy();
    expect(screen.queryByDisplayValue('secret')).toBeNull();
    expect(screen.getByText('Loaded from database')).toBeTruthy();
  });

  it('shows generated API documentation for the loaded Sheet Form', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([{
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_companies',
        }]), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Rows', column_name: 'rows', position: 1, type: 'integer', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs', rows: 42 }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByText('/api/sheet_companies')).toBeTruthy();
    expect(screen.getByText('Company:text, Rows:integer')).toBeTruthy();
  });

  it('switches between Sheet Forms from the sidebar', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([
          { id: 'form-1', slug: 'companies', name: 'Companies', generated_table_name: 'sheet_companies' },
          { id: 'form-2', slug: 'requests', name: 'Requests', generated_table_name: 'sheet_requests' },
        ]), { status: 200 });
      }
      if (url.includes('sheet_form_id=eq.form-1')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('sheet_form_id=eq.form-2')) {
        return new Response(JSON.stringify([
          { id: 'field-2', name: 'Requester', column_name: 'requester', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs' }]), { status: 200 });
      }
      if (url.includes('/sheet_requests')) {
        return new Response(JSON.stringify([{ id: 'row-2', requester: 'Gareth' }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();
    fireEvent.click(screen.getByText('Requests'));

    expect(await screen.findByDisplayValue('Gareth')).toBeTruthy();
    expect(screen.getByDisplayValue('Requests')).toBeTruthy();
  });

  it('hides an existing field without deleting the generated table data', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ input: url, init });
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([{
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_companies',
        }]), { status: 200 });
      }
      if (url.includes('/rpc/hide_sheet_field')) {
        return new Response(JSON.stringify({
          id: 'field-2',
          name: 'Domain',
          column_name: 'domain',
          position: 1,
          type: 'text',
          hidden: true,
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Domain', column_name: 'domain', position: 1, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs', domain: 'acme.test' }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('acme.test')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Domain' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/hide_sheet_field'))).toBe(true);
    });
    const hideCall = calls.find((call) => call.input.includes('/rpc/hide_sheet_field'));
    expect(hideCall?.init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', field_id: 'field-2' }));
    await waitFor(() => {
      expect(screen.queryByDisplayValue('acme.test')).toBeNull();
    });
    expect(screen.getByText('Field hidden')).toBeTruthy();
  });

  it('tightens an existing field type through PostgREST RPC', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ input: url, init });
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([{
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_companies',
        }]), { status: 200 });
      }
      if (url.includes('/rpc/tighten_sheet_field_type')) {
        return new Response(JSON.stringify({
          id: 'field-2',
          name: 'Rows',
          column_name: 'rows',
          position: 1,
          type: 'integer',
          hidden: false,
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Rows', column_name: 'rows', position: 1, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs', rows: '42' }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('42')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Type for Rows'), { target: { value: 'integer' } });

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/tighten_sheet_field_type'))).toBe(true);
    });
    const tightenCall = calls.find((call) => call.input.includes('/rpc/tighten_sheet_field_type'));
    expect(tightenCall?.init?.body).toBe(JSON.stringify({
      sheet_form_id: 'form-1',
      field_id: 'field-2',
      target_type: 'integer',
    }));
    expect(await screen.findByText('Changed Rows to integer')).toBeTruthy();
  });

  it('shows the database error when a field type cannot be tightened safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([{
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_companies',
        }]), { status: 200 });
      }
      if (url.includes('/rpc/tighten_sheet_field_type')) {
        return new Response('column contains values that cannot be converted to integer', { status: 400 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs' }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Type for Company'), { target: { value: 'integer' } });

    expect(await screen.findByText('column contains values that cannot be converted to integer')).toBeTruthy();
  });

  it('renames an existing Sheet Form on save', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ input: url, init });
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([
          { id: 'form-1', slug: 'companies', name: 'Companies', generated_table_name: 'sheet_companies' },
        ]), { status: 200 });
      }
      if (url.includes('/rpc/rename_sheet_form')) {
        return new Response(JSON.stringify({
          id: 'form-1',
          slug: 'companies',
          name: 'Renamed Companies',
          generated_table_name: 'sheet_companies',
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs' }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Sheet Form name'), { target: { value: 'Renamed Companies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/rename_sheet_form'))).toBe(true);
    });
    const renameCall = calls.find((call) => call.input.includes('/rpc/rename_sheet_form'));
    expect(renameCall?.init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', name: 'Renamed Companies' }));
    expect(screen.getByText('Renamed Companies')).toBeTruthy();
  });

  it('shows load errors when a Sheet Form cannot load rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([
          { id: 'form-1', slug: 'companies', name: 'Companies', generated_table_name: 'sheet_companies' },
          { id: 'form-2', slug: 'requests', name: 'Requests', generated_table_name: 'sheet_requests' },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs' }]), { status: 200 });
      }
      if (url.includes('/sheet_requests')) {
        return new Response('PostgREST is down', { status: 503 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();
    fireEvent.click(screen.getByText('Requests'));

    expect(await screen.findByText('PostgREST is down')).toBeTruthy();
  });

  it('adds new fields to an existing Sheet Form before saving rows', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ input: url, init });
      if (url.includes('/sheet_forms')) {
        return new Response(JSON.stringify([{
          id: 'form-1',
          slug: 'companies',
          name: 'Companies',
          generated_table_name: 'sheet_abc',
        }]), { status: 200 });
      }
      if (url.includes('/rpc/add_sheet_field')) {
        return new Response(JSON.stringify({
          name: 'Notes',
          id: 'field-2',
          column_name: 'notes',
          position: 1,
          type: 'text',
          hidden: false,
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_abc')) {
        return new Response(JSON.stringify([
          { id: 'row-1', company: 'Acme Labs' },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);
    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Add column'));
    fireEvent.change(screen.getByLabelText('Header 2'), { target: { value: 'Notes' } });
    fireEvent.change(screen.getAllByLabelText('Notes value')[0], { target: { value: 'Call back' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/add_sheet_field'))).toBe(true);
    });
    const addFieldCall = calls.find((call) => call.input.includes('/rpc/add_sheet_field'));
    const updateCall = calls.find((call) => call.input.includes('/sheet_abc?id=eq.row-1') && call.init?.method === 'PATCH');
    expect(addFieldCall?.init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', name: 'Notes' }));
    expect(updateCall?.init?.body).toContain('"notes":"Call back"');
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
