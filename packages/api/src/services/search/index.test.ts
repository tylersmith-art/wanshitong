import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    execute: vi.fn(),
  })),
}));

import {
  getSearchAdapter,
  setSearchAdapter,
  resetSearchAdapter,
} from "./index.js";
import type { SearchAdapter } from "./types.js";

describe("getSearchAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSearchAdapter();
  });

  afterEach(() => {
    resetSearchAdapter();
  });

  it("returns a pgvector adapter by default", () => {
    const adapter = getSearchAdapter();
    expect(adapter).toBeDefined();
    expect(adapter.search).toBeTypeOf("function");
  });

  it("returns the same instance on subsequent calls", () => {
    const first = getSearchAdapter();
    const second = getSearchAdapter();
    expect(first).toBe(second);
  });

  it("returns custom adapter after setSearchAdapter", () => {
    const custom: SearchAdapter = {
      search: vi.fn(),
    };

    setSearchAdapter(custom);
    const adapter = getSearchAdapter();
    expect(adapter).toBe(custom);
  });

  it("creates a new adapter after resetSearchAdapter", () => {
    const first = getSearchAdapter();
    resetSearchAdapter();
    const second = getSearchAdapter();
    expect(first).not.toBe(second);
  });
});
