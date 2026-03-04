import { describe, it, expect } from "vitest";

describe("vector extension", () => {
  it("init-db.sql creates vector extension", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const sqlPath = path.resolve(import.meta.dirname, "../../../../scripts/init-db.sql");
    const sql = await fs.readFile(sqlPath, "utf-8");
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });
});
