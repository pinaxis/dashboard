export interface Expiring<T> {
  get(load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function expiring<T>(lifetimeMs: number, now: () => number = Date.now): Expiring<T> {
  let entry: { at: number; value: Promise<T> } | null = null;
  return {
    get(load) {
      if (entry && now() - entry.at < lifetimeMs) {
        return entry.value;
      }
      const value = load();
      const loaded = { at: now(), value };
      entry = loaded;
      value.catch(() => {
        if (entry === loaded) {
          entry = null;
        }
      });
      return value;
    },
    clear() {
      entry = null;
    },
  };
}
