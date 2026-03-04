import { describe, it, expect } from "vitest";
import { CreateProjectSchema, ProjectSchema, UpdateProjectSchema } from "./project.js";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("CreateProjectSchema", () => {
  it("accepts valid input", () => {
    const result = CreateProjectSchema.safeParse({
      name: "My Project",
      orgId: validUuid,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("");
    }
  });

  it("rejects empty name", () => {
    const result = CreateProjectSchema.safeParse({
      name: "",
      orgId: validUuid,
    });
    expect(result.success).toBe(false);
  });

  it("requires orgId", () => {
    const result = CreateProjectSchema.safeParse({
      name: "My Project",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid orgId", () => {
    const result = CreateProjectSchema.safeParse({
      name: "My Project",
      orgId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("ProjectSchema", () => {
  it("accepts valid project", () => {
    const result = ProjectSchema.safeParse({
      id: validUuid,
      name: "My Project",
      description: "A description",
      orgId: validUuid,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateProjectSchema", () => {
  it("accepts partial updates", () => {
    const result = UpdateProjectSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = UpdateProjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects empty name string", () => {
    const result = UpdateProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});
