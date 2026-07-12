import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5_000 });

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.ResizeObserver ??= ResizeObserverStub as typeof ResizeObserver;
globalThis.IntersectionObserver ??= IntersectionObserverStub as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= function () {};
