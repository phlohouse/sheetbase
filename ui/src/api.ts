export interface SheetForm {
  id: string;
  slug: string;
  name: string;
  generated_table_name: string;
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

const postgrestUrl = import.meta.env.VITE_POSTGREST_URL ?? '/api';

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

export async function insertRows<T extends Record<string, unknown>>(
  tableName: string,
  rows: T[],
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  return request<T[]>(`${postgrestUrl}/${encodeURIComponent(tableName)}`, fetcher, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
}

export async function updateRow<T extends Record<string, unknown>>(
  tableName: string,
  id: string,
  row: T,
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  return request<T[]>(`${postgrestUrl}/${encodeURIComponent(tableName)}?id=eq.${encodeURIComponent(id)}`, fetcher, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
}

async function request<T>(url: string, fetcher: typeof fetch, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `PostgREST request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
