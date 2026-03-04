import { z } from "zod";

export const OrgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const CreateOrgSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must be lowercase alphanumeric with hyphens",
    ),
});

export const OrgSchema = CreateOrgSchema.extend({
  id: z.string().uuid(),
  createdAt: z.date(),
});

export const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug must be lowercase alphanumeric with hyphens",
    )
    .optional(),
});

export type Org = z.infer<typeof OrgSchema>;
export type CreateOrg = z.infer<typeof CreateOrgSchema>;
export type UpdateOrg = z.infer<typeof UpdateOrgSchema>;
