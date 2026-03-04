import { describe, it, expect } from "vitest";
import { SyncActionSchema, SyncEventSchema, syncChannel } from "./sync.js";

describe("SyncActionSchema", () => {
  it("accepts valid actions", () => {
    expect(SyncActionSchema.safeParse("created").success).toBe(true);
    expect(SyncActionSchema.safeParse("updated").success).toBe(true);
    expect(SyncActionSchema.safeParse("deleted").success).toBe(true);
  });

  it("rejects invalid action", () => {
    expect(SyncActionSchema.safeParse("archived").success).toBe(false);
  });
});

describe("SyncEventSchema", () => {
  it("accepts valid event", () => {
    const result = SyncEventSchema.safeParse({
      action: "created",
      data: { id: "1" },
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });
});

describe("syncChannel", () => {
  it("formats channel name", () => {
    expect(syncChannel("user")).toBe("sync:user");
    expect(syncChannel("post")).toBe("sync:post");
  });
});
