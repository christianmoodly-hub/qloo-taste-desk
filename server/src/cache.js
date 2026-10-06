export function createCache({ maxEntries = 100, ttlMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
  const entries = new Map();

  function get(key) {
    const hit = entries.get(key);
    if (!hit) return undefined;
    if (now() - hit.storedAt > ttlMs) {
      entries.delete(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, hit);
    return hit.value;
  }

  function set(key, value) {
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { value, storedAt: now() });
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      entries.delete(oldest);
    }
  }

  return { get, set, size: () => entries.size };
}
