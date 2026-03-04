/**
 * In-memory sliding-window rate limiter for API-key-authenticated requests.
 *
 * Each API key is tracked by its ID. Entries older than the configured window
 * are lazily cleaned up on every `consume()` call, plus a periodic sweep runs
 * to prevent unbounded memory growth from inactive keys.
 */

export interface RateLimiterConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** How often (ms) to sweep stale entries. Defaults to `windowMs`. */
  cleanupIntervalMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;

    const interval = config.cleanupIntervalMs ?? config.windowMs;
    this.cleanupTimer = setInterval(() => this.sweep(), interval);
    // Allow the process to exit without waiting for the timer.
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Try to consume one request token for the given key.
   * Returns whether the request is allowed and how many tokens remain.
   */
  consume(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    // Prune timestamps outside the current window
    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      const oldestInWindow = timestamps[0]!;
      return {
        allowed: false,
        remaining: 0,
        resetAtMs: oldestInWindow + this.windowMs,
      };
    }

    timestamps.push(now);
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetAtMs: timestamps[0]! + this.windowMs,
    };
  }

  /** Remove all entries whose timestamps have fully expired. */
  private sweep(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.buckets) {
      while (timestamps.length > 0 && timestamps[0]! < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  /** Stop the background cleanup timer and clear all state. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }

  /** Reset a single key (useful after key revocation). */
  reset(key: string): void {
    this.buckets.delete(key);
  }
}

/**
 * Default rate limiter for API-key-authenticated requests:
 * 500 requests per 15-minute window.
 */
export const apiKeyRateLimiter = new RateLimiter({
  maxRequests: 500,
  windowMs: 15 * 60 * 1000,
});
