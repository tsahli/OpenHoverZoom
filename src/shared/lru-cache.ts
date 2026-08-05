interface CacheEntry<Value> {
  value: Value;
  expiresAt: number;
}

export class LruCache<Key, Value> {
  readonly #entries = new Map<Key, CacheEntry<Value>>();

  constructor(
    readonly capacity: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("LRU capacity must be a positive integer");
    }
  }

  get(key: Key): Value | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value, ttlMilliseconds: number): void {
    if (!Number.isFinite(ttlMilliseconds) || ttlMilliseconds <= 0) return;
    this.#entries.delete(key);
    this.#entries.set(key, {
      value,
      expiresAt: this.now() + ttlMilliseconds,
    });
    const oldest = this.#entries.keys().next().value as Key | undefined;
    if (this.#entries.size > this.capacity && oldest !== undefined) {
      this.#entries.delete(oldest);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
