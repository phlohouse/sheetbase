import { sheetbaseClientID } from './live';

export interface SheetForm {
  id: string;
  slug: string;
  name: string;
  generated_table_name: string;
  archived_at: string | null;
}

export interface SheetField {
  id: string;
  name: string;
  column_name: string;
  position: number;
  type: string;
  hidden: boolean;
}

export interface SheetView {
  id: string;
  sheet_form_id: string;
  name: string;
  column_widths: Record<string, number>;
  sort_filter_state: { column_order?: string[] };
}

const postgrestUrl = import.meta.env.VITE_POSTGREST_URL ?? '/internal';

export async function listSheetForms(fetcher: typeof fetch = fetch): Promise<SheetForm[]> {
  return request<SheetForm[]>(`${postgrestUrl}/sheet_forms?select=*&order=created_at.desc`, fetcher);
}

export async function listSheetFields(sheetFormId: string, fetcher: typeof fetch = fetch): Promise<SheetField[]> {
  const filter = encodeURIComponent(`eq.${sheetFormId}`);
  return request<SheetField[]>(
    `${postgrestUrl}/sheet_fields?sheet_form_id=${filter}&select=id,name,column_name,position,type,hidden&order=position.asc`,
    fetcher,
  );
}

export async function listSheetViews(sheetFormId: string, fetcher: typeof fetch = fetch): Promise<SheetView[]> {
  const filter = encodeURIComponent(`eq.${sheetFormId}`);
  return request<SheetView[]>(
    `${postgrestUrl}/sheet_views?sheet_form_id=${filter}&select=id,sheet_form_id,name,column_widths,sort_filter_state&order=created_at.asc`,
    fetcher,
  );
}

export async function createSheetForm(
  name: string,
  headers: string[],
  fetcher: typeof fetch = fetch,
): Promise<SheetForm> {
  return request<SheetForm>(`${postgrestUrl}/rpc/create_sheet_form`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ name, headers }),
  });
}

export async function addSheetField(
  sheetFormId: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<SheetField> {
  return request<SheetField>(`${postgrestUrl}/rpc/add_sheet_field`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, name }),
  });
}

export async function renameSheetForm(
  sheetFormId: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<SheetForm> {
  return request<SheetForm>(`${postgrestUrl}/rpc/rename_sheet_form`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, name }),
  });
}

export async function renameSheetField(
  sheetFormId: string,
  fieldId: string,
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<SheetField> {
  return request<SheetField>(`${postgrestUrl}/rpc/rename_sheet_field`, fetcher, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ sheet_form_id: sheetFormId, field_id: fieldId, name }),
  });
}

export async function setSheetFormSlug(
  sheetFormId: string,
  slug: string,
  fetcher: typeof fetch = fetch,
): Promise<SheetForm> {
  return request<SheetForm>(`${postgrestUrl}/rpc/set_sheet_form_slug`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, slug }),
  });
}

export async function archiveSheetForm(sheetFormId: string, archived: boolean, fetcher: typeof fetch = fetch): Promise<SheetForm> {
  return request<SheetForm>(`${postgrestUrl}/rpc/archive_sheet_form`, fetcher, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ sheet_form_id: sheetFormId, archived }),
  });
}

export async function deleteSheetForm(sheetFormId: string, fetcher: typeof fetch = fetch): Promise<void> {
  await request<unknown>(`${postgrestUrl}/rpc/delete_sheet_form`, fetcher, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_form_id: sheetFormId }),
  });
}

export async function hideSheetField(
  sheetFormId: string,
  fieldId: string,
  fetcher: typeof fetch = fetch,
): Promise<SheetField> {
  return request<SheetField>(`${postgrestUrl}/rpc/hide_sheet_field`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, field_id: fieldId }),
  });
}

export async function tightenSheetFieldType(
  sheetFormId: string,
  fieldId: string,
  targetType: string,
  fetcher: typeof fetch = fetch,
): Promise<SheetField> {
  return request<SheetField>(`${postgrestUrl}/rpc/tighten_sheet_field_type`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, field_id: fieldId, target_type: targetType }),
  });
}

export async function updateSheetViewWidths(
  sheetFormId: string,
  widths: Record<string, number>,
  fetcher: typeof fetch = fetch,
): Promise<SheetView> {
  return request<SheetView>(`${postgrestUrl}/rpc/update_sheet_view_widths`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, widths }),
  });
}

export async function updateSheetViewColumnOrder(
  sheetFormId: string,
  columnOrder: string[],
  fetcher: typeof fetch = fetch,
): Promise<SheetView> {
  return request<SheetView>(`${postgrestUrl}/rpc/update_sheet_view_column_order`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ sheet_form_id: sheetFormId, column_order: columnOrder }),
  });
}

export async function listRows<T extends Record<string, unknown>>(
  tableName: string,
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  return request<T[]>(`${postgrestUrl}/${encodeURIComponent(tableName)}?select=*&limit=200`, fetcher);
}

export async function getRow<T extends Record<string, unknown>>(tableName: string, id: string, fetcher: typeof fetch = fetch): Promise<T | undefined> {
  const rows = await request<T[]>(`${postgrestUrl}/${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, fetcher);
  return rows[0];
}

export async function insertRows<T extends Record<string, unknown>>(
  tableName: string,
  rows: T[],
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  const url = `${postgrestUrl}/${encodeURIComponent(tableName)}`;
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await request<T[]>(url, fetcher, init);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('404') || attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('PostgREST request failed: 404');
}

export async function updateRow<T extends Record<string, unknown>>(
  tableName: string,
  id: string,
  row: T,
  expectedVersionOrFetcher?: string | typeof fetch,
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  const expectedVersion = typeof expectedVersionOrFetcher === 'string' ? expectedVersionOrFetcher : undefined;
  if (typeof expectedVersionOrFetcher === 'function') fetcher = expectedVersionOrFetcher;
  const versionFilter = expectedVersion ? `&updated_at=eq.${encodeURIComponent(expectedVersion)}` : '';
  const updated = await request<T[]>(`${postgrestUrl}/${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}${versionFilter}`, fetcher, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (expectedVersion && updated.length === 0) throw new Error('This row changed elsewhere. Reload it before saving your edit.');
  return updated;
}

export async function deleteRow(
  tableName: string,
  id: string,
  expectedVersionOrFetcher?: string | typeof fetch,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const expectedVersion = typeof expectedVersionOrFetcher === 'string' ? expectedVersionOrFetcher : undefined;
  if (typeof expectedVersionOrFetcher === 'function') fetcher = expectedVersionOrFetcher;
  const versionFilter = expectedVersion ? `&updated_at=eq.${encodeURIComponent(expectedVersion)}` : '';
  const response = await fetcher(`${postgrestUrl}/${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}${versionFilter}`, {
    method: 'DELETE',
    headers: { 'X-Sheetbase-Client-ID': sheetbaseClientID, Prefer: 'return=representation' },
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail && detail !== '{}' ? detail : `PostgREST request failed: ${response.status}`);
  }
  if (expectedVersion && (await response.json() as unknown[]).length === 0) throw new Error('This row changed elsewhere. Reload it before deleting.');
}

async function request<T>(url: string, fetcher: typeof fetch, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, {
    ...init,
    headers: { 'X-Sheetbase-Client-ID': sheetbaseClientID, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail && detail !== '{}' ? detail : `PostgREST request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
