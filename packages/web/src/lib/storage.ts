/** localStorage wrappers that never throw (private mode, blocked storage, quota). */

const memory = new Map<string, string>();

export function loadString(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    // fall through to the in-memory copy
  }
  return memory.get(key) ?? null;
}

export function saveString(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // in-memory only
  }
}

export function loadJson<T>(key: string): T | null {
  const s = loadString(key);
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function saveJson(key: string, value: unknown): void {
  saveString(key, JSON.stringify(value));
}

/** Random hex id. `crypto.randomUUID` is unavailable on plain-http LAN pages, getRandomValues is not. */
export function randomId(bytes = 8): string {
  const a = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(a);
  } catch {
    for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const DEVICE_KEY = 'gt7.deviceId';

/** Persistent device id (falls back to an in-memory id when storage is blocked). */
export function getDeviceId(): string {
  let id = loadString(DEVICE_KEY);
  if (!id) {
    id = `d-${randomId()}`;
    saveString(DEVICE_KEY, id);
  }
  return id;
}

/** Friendly default name from the user agent. */
export function guessDeviceName(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return 'Tablet';
  if (/Android|iPhone|Mobile/i.test(ua)) return 'Outro aparelho';
  return 'PC';
}
