export interface SheetForm {
  id: string;
  slug: string;
  name: string;
  generated_table_name: string;
}

export interface SheetField {
  name: string;
  column_name: string;
  position: number;
  type: string;
  hidden: boolean;
}

const postgrestUrl = import.meta.env.VITE_POSTGREST_URL ?? '/api';

export async function listSheetForms(fetcher: typeof fetch = fetch): Promise<SheetForm[]> {
  return request<SheetForm[]>(`${postgrestUrl}/sheet_forms?select=*&order=created_at.desc`, fetcher);
}

export async function listSheetFields(sheetFormId: string, fetcher: typeof fetch = fetch): Promise<SheetField[]> {
  const filter = encodeURIComponent(`eq.${sheetFormId}`);
  return request<SheetField[]>(
    `${postgrestUrl}/sheet_fields?sheet_form_id=${filter}&select=name,column_name,position,type,hidden&order=position.asc`,
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

export async function listRows<T extends Record<string, unknown>>(
  tableName: string,
  fetcher: typeof fetch = fetch,
): Promise<T[]> {
  return request<T[]>(`${postgrestUrl}/${encodeURIComponent(tableName)}?select=*`, fetcher);
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

async function request<T>(url: string, fetcher: typeof fetch, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  if (!response.ok) {
    throw new Error(`PostgREST request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}
