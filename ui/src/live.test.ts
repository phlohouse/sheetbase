import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLatestEventTracker, subscribeToChanges } from './live';

class FakeEventSource {
  static latest: FakeEventSource;
  listeners = new Map<string, (event: Event | MessageEvent) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.latest = this; }
  addEventListener(name: string, handler: (event: Event | MessageEvent) => void) { this.listeners.set(name, handler); }
  close() { this.closed = true; }
  emit(name: string, data = '') { this.listeners.get(name)?.(new MessageEvent(name, { data })); }
}

describe('live change subscriptions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('subscribes to a dataset and forwards ready and change events', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onReady = vi.fn();
    const onChange = vi.fn();
    const stop = subscribeToChanges({ dataset: 'form-1' }, { onReady, onChange });
    expect(FakeEventSource.latest.url).toBe('/internal/events?dataset=form-1');
    FakeEventSource.latest.emit('ready');
    FakeEventSource.latest.emit('change', '{"id":7,"scope":"dataset","kind":"row_update"}');
    expect(onReady).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({ id: 7, scope: 'dataset', kind: 'row_update' });
    stop();
    expect(FakeEventSource.latest.closed).toBe(true);
  });

  it('discards row responses superseded by a newer event', () => {
    const tracker = createLatestEventTracker();
    expect(tracker.begin('row-1', 4)).toBe(true);
    expect(tracker.begin('row-1', 5)).toBe(true);
    expect(tracker.isCurrent('row-1', 4)).toBe(false);
    expect(tracker.isCurrent('row-1', 5)).toBe(true);
    expect(tracker.begin('row-1', 3)).toBe(false);
  });
});
