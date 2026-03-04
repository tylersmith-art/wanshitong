import { describe, it, expect } from "vitest";
import {
  CreateOrgSchema,
  OrgSchema,
  OrgRoleSchema,
  UpdateOrgSchema,
} from "./organization.js";

describe("OrgRoleSchema", () => {
  it("accepts valid roles", () => {
    expect(OrgRoleSchema.safeParse("owner").success).toBe(true);
    expect(OrgRoleSchema.safeParse("admin").success).toBe(true);
    expect(OrgRoleSchema.safeParse("member").success).toBe(true);
  });

  it("rejects invalid role", () => {
    expect(OrgRoleSchema.safeParse("superadmin").success).toBe(false);
  });
});

describe("CreateOrgSchema", () => {
  it("accepts valid input", () => {
    const result = CreateOrgSchema.safeParse({
      name: "Acme Corp",
      slug: "acme-corp",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = CreateOrgSchema.safeParse({ name: "", slug: "acme" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid slug with uppercase", () => {
    const result = CreateOrgSchema.safeParse({
      name: "Acme",
      slug: "Acme-Corp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid slug with spaces", () => {
    const result = CreateOrgSchema.safeParse({
      name: "Acme",
      slug: "acme corp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid slug with special chars", () => {
    const result = CreateOrgSchema.safeParse({
      name: "Acme",
      slug: "acme_corp!",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty slug", () => {
    const result = CreateOrgSchema.safeParse({ name: "Acme", slug: "" });
    expect(result.success).toBe(false);
  });
});

describe("OrgSchema", () => {
  it("accepts valid org with all fields", () => {
    const result = OrgSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      name: "Acme Corp",
      slug: "acme-corp",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid uuid", () => {
    const result = OrgSchema.safeParse({
      id: "not-a-uuid",
      name: "Acme Corp",
      slug: "acme-corp",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateOrgSchema", () => {
  it("accepts partial update with name only", () => {
    const result = UpdateOrgSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with slug only", () => {
    const result = UpdateOrgSchema.safeParse({ slug: "new-slug" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no fields required)", () => {
    const result = UpdateOrgSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects invalid slug in update", () => {
    const result = UpdateOrgSchema.safeParse({ slug: "Invalid Slug!" });
    expect(result.success).toBe(false);
  });
});
