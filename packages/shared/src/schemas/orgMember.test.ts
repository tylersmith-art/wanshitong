import { describe, it, expect } from "vitest";
import {
  OrgMemberSchema,
  AddMemberSchema,
  UpdateMemberRoleSchema,
} from "./orgMember.js";

const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const validUuid2 = "660e8400-e29b-41d4-a716-446655440000";

describe("OrgMemberSchema", () => {
  it("accepts valid member", () => {
    const result = OrgMemberSchema.safeParse({
      id: validUuid,
      orgId: validUuid,
      userId: validUuid2,
      role: "member",
      createdAt: new Date(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid orgId", () => {
    const result = OrgMemberSchema.safeParse({
      id: validUuid,
      orgId: "not-a-uuid",
      userId: validUuid2,
      role: "member",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid userId", () => {
    const result = OrgMemberSchema.safeParse({
      id: validUuid,
      orgId: validUuid,
      userId: "not-a-uuid",
      role: "member",
      createdAt: new Date(),
    });
    expect(result.success).toBe(false);
  });
});

describe("AddMemberSchema", () => {
  it("accepts valid input with explicit role", () => {
    const result = AddMemberSchema.safeParse({
      orgId: validUuid,
      userId: validUuid2,
      role: "admin",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("admin");
    }
  });

  it("defaults role to member", () => {
    const result = AddMemberSchema.safeParse({
      orgId: validUuid,
      userId: validUuid2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("member");
    }
  });
});

describe("UpdateMemberRoleSchema", () => {
  it("accepts valid input", () => {
    const result = UpdateMemberRoleSchema.safeParse({
      orgId: validUuid,
      userId: validUuid2,
      role: "owner",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid role", () => {
    const result = UpdateMemberRoleSchema.safeParse({
      orgId: validUuid,
      userId: validUuid2,
      role: "superadmin",
    });
    expect(result.success).toBe(false);
  });

  it("requires role field", () => {
    const result = UpdateMemberRoleSchema.safeParse({
      orgId: validUuid,
      userId: validUuid2,
    });
    expect(result.success).toBe(false);
  });
});
