export interface ChangeEvent {
  id: number;
  scope: 'workspace' | 'dataset';
  kind: string;
  sheet_form_id?: string;
  row_id?: string;
  client_id?: string;
}

export const sheetbaseClientID = globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createLatestEventTracker() {
  const latest = new Map<string, number>();
  return {
    begin(rowID: string, eventID: number) {
      if (eventID <= (latest.get(rowID) ?? -1)) return false;
      latest.set(rowID, eventID);
      return true;
    },
    isCurrent(rowID: string, eventID: number) { return latest.get(rowID) === eventID; },
  };
}

export function subscribeToChanges(
  target: { scope: 'workspace' } | { dataset: string },
  handlers: { onReady?: () => void; onChange: (event: ChangeEvent) => void; onStatus?: (status: 'connecting' | 'connected' | 'offline') => void },
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  const query = 'scope' in target ? `scope=${target.scope}` : `dataset=${encodeURIComponent(target.dataset)}`;
  const source = new EventSource(`/internal/events?${query}`);
  handlers.onStatus?.('connecting');
  source.addEventListener('ready', () => { handlers.onStatus?.('connected'); handlers.onReady?.(); });
  source.addEventListener('change', (message) => {
    try { handlers.onChange(JSON.parse((message as MessageEvent).data) as ChangeEvent); } catch { handlers.onStatus?.('offline'); }
  });
  source.onerror = () => handlers.onStatus?.('offline');
  return () => source.close();
}
