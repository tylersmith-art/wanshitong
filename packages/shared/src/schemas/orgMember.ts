import { z } from "zod";
import { OrgRoleSchema } from "./organization.js";

export const OrgMemberSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: OrgRoleSchema,
  createdAt: z.date(),
});

export const AddMemberSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: OrgRoleSchema.default("member"),
});

export const UpdateMemberRoleSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: OrgRoleSchema,
});

export type OrgMember = z.infer<typeof OrgMemberSchema>;
export type AddMember = z.infer<typeof AddMemberSchema>;
export type UpdateMemberRole = z.infer<typeof UpdateMemberRoleSchema>;
