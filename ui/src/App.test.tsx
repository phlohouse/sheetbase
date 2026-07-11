import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = '';
    window.localStorage?.clear?.();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('persists an explicit dark mode preference', () => {
    const themeStorage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => themeStorage.clear(),
        getItem: (key: string) => themeStorage.get(key) ?? null,
        setItem: (key: string, value: string) => themeStorage.set(key, value),
      },
    });
    render(<App onSignOut={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('sheetbase-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Export' })).toHaveProperty('disabled', true);
  });

  it('renders the Handsontable grid for spreadsheet keyboard navigation', () => {
    const { container } = render(<App />);

    expect(container.querySelector('.handsontable')).toBeTruthy();
    expect(container.querySelector<HTMLElement>('.table-frame')?.style.colorScheme).toBe('light');
    expect(screen.getAllByDisplayValue('Company').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('columnheader', { name: 'Company' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('gridcell', { name: 'Company' })).toHaveLength(0);
    expect(screen.getByDisplayValue('Vercel')).toBeTruthy();
  });

  it('renames column headers in place on double click', async () => {
    render(<App />);

    fireEvent.doubleClick(screen.getAllByRole('columnheader', { name: 'Company' })[0]);
    const input = await screen.findByRole('textbox', { name: 'Edit Company column header' });
    fireEvent.change(input, { target: { value: 'Account' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getAllByRole('columnheader', { name: 'Account' }).length).toBeGreaterThan(0));

    fireEvent.doubleClick(screen.getAllByRole('columnheader', { name: 'Account' })[0]);
    const cancelInput = await screen.findByRole('textbox', { name: 'Edit Account column header' });
    fireEvent.change(cancelInput, { target: { value: 'Discard me' } });
    fireEvent.keyDown(cancelInput, { key: 'Escape' });

    await waitFor(() => expect(screen.queryAllByRole('columnheader', { name: 'Discard me' })).toHaveLength(0));
    expect(screen.getAllByRole('columnheader', { name: 'Account' }).length).toBeGreaterThan(0);
  });

  it('opens integrated column settings from the header', async () => {
    const { container } = render(<App />);
    const trigger = container.querySelector<HTMLButtonElement>('.ht_clone_top .column-menu-trigger');
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger!);

    const settings = await screen.findByRole('dialog', { name: 'Company column settings' });
    expect(within(settings).getByLabelText('Column name')).toHaveProperty('value', 'Company');
    expect(within(settings).getByLabelText('Column type')).toHaveProperty('value', 'text');
    expect(within(settings).getAllByText('company').length).toBeGreaterThan(0);
  });

  it('autosaves edits after the debounce interval', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      const url = String(input);
      if (url.includes('/rpc/create_sheet_form')) {
        return new Response(JSON.stringify({ id: 'form-auto', slug: 'auto-draft', name: 'Auto Draft', generated_table_name: 'auto-draft' }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Name', column_name: 'name', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);
    await screen.findByDisplayValue('Untitled Sheet Form');
    fireEvent.change(screen.getByLabelText('Header 1'), { target: { value: 'Name' } });
    fireEvent.change(screen.getByLabelText('Sheet Form name'), { target: { value: 'Auto Draft' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/create_sheet_form'))).toBe(true);
    }, { timeout: 2500 });
  });

  it('keeps the sidebar to working actions', async () => {
    render(<App />);

    expect(screen.queryByText('Notifications')).toBeNull();
    expect(screen.queryByText('Managed Postgres')).toBeNull();
    expect(screen.queryByText('Home')).toBeNull();

    const sidebar = screen.getByLabelText('Workspace navigation');
    fireEvent.click(within(sidebar).getByRole('button', { name: 'New form' }));
    expect(screen.getByDisplayValue('Untitled Sheet Form')).toBeTruthy();
    expect(within(sidebar).queryByRole('button', { name: 'Show API URL' })).toBeNull();
    expect(within(sidebar).queryByRole('button', { name: 'Import Stencil config' })).toBeNull();
  });

  it('opens Stencil import from the toolbar', () => {
    const { container } = render(<App />);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const clickSpy = vi.spyOn(fileInput!, 'click').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Import Stencil config' }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('keeps local-draft API and export actions safe and explanatory', () => {
    render(<App />);

    const apiButton = screen.getByRole('button', { name: 'API' });
    expect(apiButton).toHaveProperty('disabled', false);
    fireEvent.click(apiButton);
    expect(screen.getByLabelText('API documentation')).toBeTruthy();
    expect(screen.getByText('Save this Sheet Form to create its API endpoint.')).toBeTruthy();

    const exportButton = screen.getByRole('button', { name: 'Export' });
    expect(exportButton).toHaveProperty('disabled', true);
    expect(exportButton.getAttribute('title')).toBe('Save this Sheet Form before exporting a backup');
  });

  it('reports an unavailable database and prevents server-backed actions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connection refused');
    }));

    render(<App onSignOut={() => undefined} />);

    expect(await screen.findByText('Database unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'API' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Export' })).toHaveProperty('disabled', true);
  });

  it('does not let the initial load overwrite a new draft', async () => {
    let resolveForms: (response: Response) => void = () => undefined;
    const formsPromise = new Promise<Response>((resolve) => {
      resolveForms = resolve;
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/sheet_forms')) return formsPromise;
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'New form' })[0]);
    fireEvent.change(screen.getByLabelText('Sheet Form name'), { target: { value: 'Fresh Draft' } });
    resolveForms(new Response(JSON.stringify([{
      id: 'form-1',
      slug: 'old',
      name: 'Old Form',
      generated_table_name: 'sheet_old',
    }]), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Fresh Draft')).toBeTruthy();
    });
    expect(screen.queryByDisplayValue('Old Form')).toBeNull();
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

  it('shows a blank draft when the API has no Sheet Forms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));

    render(<App />);

    expect(await screen.findByDisplayValue('Untitled Sheet Form')).toBeTruthy();
    expect(screen.getByLabelText('Header 1')).toBeTruthy();
    expect(screen.queryByDisplayValue('Vercel')).toBeNull();
  });

  it('creates a new Sheet Form with an editable name', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    let insertAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      const url = String(input);
      if (url.includes('/rpc/create_sheet_form')) {
        return new Response(JSON.stringify({
          id: 'form-1',
          slug: 'requests',
          name: 'Support Requests',
          generated_table_name: 'sheet_requests',
        }), { status: 200 });
      }
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Requester', column_name: 'requester', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Issue', column_name: 'issue', position: 1, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_requests') && init?.method === 'POST') {
        insertAttempts += 1;
        if (insertAttempts === 1) {
          return new Response('{}', { status: 404 });
        }
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'New form' })[0]);
    fireEvent.change(screen.getByLabelText('Sheet Form name'), { target: { value: 'Support Requests' } });
    fireEvent.change(screen.getByLabelText('Header 1'), { target: { value: 'Requester' } });
    fireEvent.change(screen.getByLabelText('Header 2'), { target: { value: 'Issue' } });
    fireEvent.change(screen.getAllByLabelText('Requester value')[0], { target: { value: 'Gareth' } });
    fireEvent.change(screen.getAllByLabelText('Issue value')[0], { target: { value: 'Cannot log in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(insertAttempts).toBe(2);
    });
    const createCall = calls.find((call) => call.input.includes('/rpc/create_sheet_form'));
    const insertCall = calls.find((call) => call.input.includes('/sheet_requests') && call.init?.method === 'POST');
    expect(createCall?.init?.body).toBe(JSON.stringify({
      name: 'Support Requests',
      headers: ['Requester', 'Issue'],
    }));
    expect(insertCall?.init?.body).toContain('"requester":"Gareth"');
    expect(insertCall?.init?.body).toContain('"issue":"Cannot log in"');
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

    expect(await screen.findByDisplayValue('Untitled Sheet Form')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'New form' })[0]);
    fireEvent.change(screen.getByLabelText('Header 1'), { target: { value: 'Company' } });
    fireEvent.change(screen.getAllByLabelText('Company value')[0], { target: { value: 'Acme Labs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('database is unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(insertAttempts).toBe(2);
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
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
    expect(screen.queryByText('Loaded from database')).toBeNull();
  });

  it('shows generated API documentation for the loaded Sheet Form', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
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

    const apiButton = await screen.findByRole('button', { name: 'API' });
    await waitFor(() => expect(apiButton).toHaveProperty('disabled', false));
    fireEvent.click(apiButton);
    expect(await screen.findByLabelText('API slug')).toHaveProperty('value', 'companies');
    expect(screen.getByText('http://localhost:3000/api/')).toBeTruthy();
    expect(apiButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('/api/sheet_companies?select=*&limit=20')).toBeTruthy();
    expect(screen.getByText('/api/sheet_companies')).toBeTruthy();
    expect(screen.getByText('/api/sheet_fields?sheet_form_id=eq.form-1&order=position.asc')).toBeTruthy();
    const docs = screen.getByLabelText('API documentation');
    expect(within(docs).getByText('API access')).toBeTruthy();
    expect(within(docs).getByText('2 fields')).toBeTruthy();
    expect(within(docs).getByText('Company')).toBeTruthy();
    expect(within(docs).getByText('company')).toBeTruthy();
    expect(within(docs).getByText('integer')).toBeTruthy();
    fireEvent.click(within(docs).getByRole('button', { name: 'Copy API endpoint' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:3000/api/sheet_companies'));
    expect(within(docs).getByText('Copied')).toBeTruthy();
    fireEvent.click(within(docs).getByRole('button', { name: 'Copy read rows request' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost:3000/api/sheet_companies?select=*&limit=20'));
    fireEvent.click(apiButton);
    expect(screen.queryByLabelText('API documentation')).toBeNull();
    expect(apiButton.getAttribute('aria-expanded')).toBe('false');
  });

  it('loads and saves column widths through the default Sheet View', async () => {
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
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_views')) {
        return new Response(JSON.stringify([{
          id: 'view-1',
          sheet_form_id: 'form-1',
          name: 'Default',
          column_widths: { company: 300 },
        }]), { status: 200 });
      }
      if (url.includes('/rpc/update_sheet_view_widths')) {
        return new Response(JSON.stringify({
          id: 'view-1',
          sheet_form_id: 'form-1',
          name: 'Default',
          column_widths: { company: 324 },
        }), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs' }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    const { container } = render(<App />);

    expect(await screen.findByDisplayValue('Acme Labs')).toBeTruthy();
    expect(container.querySelector<HTMLElement>('.table-frame')?.dataset.columnWidths).toContain('300');

    fireEvent.click(screen.getByRole('button', { name: 'Widen Company' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/update_sheet_view_widths'))).toBe(true);
    });
    const widthCall = calls.find((call) => call.input.includes('/rpc/update_sheet_view_widths'));
    expect(widthCall?.init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', widths: { company: 324 } }));
    expect(container.querySelector<HTMLElement>('.table-frame')?.dataset.columnWidths).toContain('324');
  });

  it('loads and saves column order through the default Sheet View', async () => {
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
      if (url.includes('/sheet_fields')) {
        return new Response(JSON.stringify([
          { id: 'field-1', name: 'Company', column_name: 'company', position: 0, type: 'text', hidden: false },
          { id: 'field-2', name: 'Rows', column_name: 'rows', position: 1, type: 'integer', hidden: false },
        ]), { status: 200 });
      }
      if (url.includes('/sheet_views')) {
        return new Response(JSON.stringify([{
          id: 'view-1',
          sheet_form_id: 'form-1',
          name: 'Default',
          column_widths: {},
          sort_filter_state: { column_order: ['rows', 'company'] },
        }]), { status: 200 });
      }
      if (url.includes('/rpc/update_sheet_view_column_order')) {
        return new Response(JSON.stringify({
          id: 'view-1',
          sheet_form_id: 'form-1',
          name: 'Default',
          column_widths: {},
          sort_filter_state: { column_order: ['company', 'rows'] },
        }), { status: 200 });
      }
      if (url.includes('/sheet_companies')) {
        return new Response(JSON.stringify([{ id: 'row-1', company: 'Acme Labs', rows: 42 }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    render(<App />);

    expect(await screen.findByDisplayValue('42')).toBeTruthy();
    expect(screen.getByLabelText('Header 1')).toHaveProperty('value', 'Rows');

    fireEvent.click(screen.getByRole('button', { name: 'Move Rows right' }));

    await waitFor(() => {
      expect(calls.some((call) => call.input.includes('/rpc/update_sheet_view_column_order'))).toBe(true);
    });
    const orderCall = calls.find((call) => call.input.includes('/rpc/update_sheet_view_column_order'));
    expect(orderCall?.init?.body).toBe(JSON.stringify({ sheet_form_id: 'form-1', column_order: ['company', 'rows'] }));
    expect(screen.getByLabelText('Header 2')).toHaveProperty('value', 'Rows');
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
    expect(screen.queryByDisplayValue('acme.test')).toBeNull();
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
    expect(screen.getByLabelText('Type for Rows')).toHaveProperty('value', 'integer');
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

    expect(await screen.findByDisplayValue('contacts')).toBeTruthy();
    expect(screen.getAllByDisplayValue('Full Name').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('Email').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('Company').length).toBeGreaterThan(0);
  });
});
