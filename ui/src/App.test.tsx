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
          { name: 'Requester', column_name: 'requester', position: 0, type: 'text', hidden: false },
          { name: 'Issue', column_name: 'issue', position: 1, type: 'text', hidden: false },
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
          name: 'Companies',
          generated_table_name: 'sheet_abc',
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
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
          { name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { name: 'Domain', column_name: 'domain', position: 1, type: 'text', hidden: false },
          { name: 'Internal', column_name: 'internal', position: 2, type: 'text', hidden: true },
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
          { name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('sheet_form_id=eq.form-2')) {
        return new Response(JSON.stringify([
          { name: 'Requester', column_name: 'requester', position: 0, type: 'text', hidden: false },
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
          { name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
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
          column_name: 'notes',
          position: 1,
          type: 'text',
          hidden: false,
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
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
