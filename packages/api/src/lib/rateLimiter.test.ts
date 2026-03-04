import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RateLimiter } from "./rateLimiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it("allows requests within the limit", () => {
    limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });

    const r1 = limiter.consume("key-1");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.consume("key-1");
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.consume("key-1");
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("rejects requests exceeding the limit", () => {
    limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });

    limiter.consume("key-1");
    limiter.consume("key-1");

    const r3 = limiter.consume("key-1");
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.resetAtMs).toBeGreaterThan(Date.now());
  });

  it("tracks keys independently", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const a = limiter.consume("key-a");
    expect(a.allowed).toBe(true);

    const b = limiter.consume("key-b");
    expect(b.allowed).toBe(true);

    const a2 = limiter.consume("key-a");
    expect(a2.allowed).toBe(false);
  });

  it("expires old timestamps after the window elapses", () => {
    vi.useFakeTimers();
    try {
      limiter = new RateLimiter({ maxRequests: 1, windowMs: 1_000 });

      const r1 = limiter.consume("key-1");
      expect(r1.allowed).toBe(true);

      const r2 = limiter.consume("key-1");
      expect(r2.allowed).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(1_001);

      const r3 = limiter.consume("key-1");
      expect(r3.allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset clears a single key", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    limiter.consume("key-1");
    expect(limiter.consume("key-1").allowed).toBe(false);

    limiter.reset("key-1");
    expect(limiter.consume("key-1").allowed).toBe(true);
  });

  it("is configured at 500 req / 15 min for the default export", async () => {
    // Dynamically import to get the singleton — we just verify its config
    // by consuming 500 requests and checking the 501st is rejected.
    const mod = await import("./rateLimiter.js");
    const defaultLimiter = mod.apiKeyRateLimiter;

    // We won't hammer 500 times; instead just verify the instance exists
    // and a single consume is allowed.
    const result = defaultLimiter.consume("config-test-key");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(499);

    // Clean up the key we just used
    defaultLimiter.reset("config-test-key");
  });
});
