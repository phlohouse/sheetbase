export interface APIKeyRecord {
  id: string;
  name: string;
  token_prefix: string;
  sheet_form_id: string;
  sheet_form_name: string;
  can_read: boolean;
  can_write: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedAPIKey extends APIKeyRecord {
  token: string;
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error((await response.text()).trim() || `Request failed: ${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function listAPIKeys(): Promise<APIKeyRecord[]> {
  return adminRequest('/admin/api-keys');
}

export function createAPIKey(name: string, sheetFormId: string, canWrite: boolean): Promise<CreatedAPIKey> {
  return adminRequest('/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sheet_form_id: sheetFormId, can_read: true, can_write: canWrite }),
  });
}

export function revokeAPIKey(id: string): Promise<void> {
  return adminRequest(`/admin/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
