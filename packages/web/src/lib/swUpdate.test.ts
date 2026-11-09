import { describe, expect, it } from 'vitest';
import { type ServiceWorkerLike, watchServiceWorkerUpdates } from './swUpdate.ts';

function fakeSw(controller: unknown) {
  const listeners = new Set<() => void>();
  const sw: ServiceWorkerLike = {
    controller,
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
  };
  return {
    sw,
    fire: () => {
      for (const l of [...listeners]) l();
    },
    count: () => listeners.size,
  };
}

describe('watchServiceWorkerUpdates', () => {
  it('reports a new worker taking over a controlled page, once', () => {
    const f = fakeSw({});
    let n = 0;
    watchServiceWorkerUpdates(f.sw, () => n++);
    f.fire();
    f.fire();
    expect(n).toBe(1);
  });

  it('ignores the first install (the page had no worker yet)', () => {
    const f = fakeSw(null);
    let n = 0;
    watchServiceWorkerUpdates(f.sw, () => n++);
    f.fire();
    expect(n).toBe(0);
  });

  it('stops listening when asked', () => {
    const f = fakeSw({});
    const stop = watchServiceWorkerUpdates(f.sw, () => {});
    expect(f.count()).toBe(1);
    stop();
    expect(f.count()).toBe(0);
  });
});
