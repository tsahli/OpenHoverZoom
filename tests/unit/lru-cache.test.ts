import { describe, expect, it } from "vitest";
import { LruCache } from "../../src/shared/lru-cache";

describe("LRU cache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new LruCache<string, number>(2, () => 0);
    cache.set("one", 1, 100);
    cache.set("two", 2, 100);
    expect(cache.get("one")).toBe(1);
    cache.set("three", 3, 100);
    expect(cache.get("two")).toBeUndefined();
    expect(cache.get("one")).toBe(1);
  });

  it("expires entries", () => {
    let now = 0;
    const cache = new LruCache<string, number>(2, () => now);
    cache.set("one", 1, 10);
    now = 10;
    expect(cache.get("one")).toBeUndefined();
  });
});
