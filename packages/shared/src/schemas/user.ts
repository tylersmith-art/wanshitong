import { z } from "zod";

export const RoleSchema = z.enum(["user", "admin"]);
export type Role = z.infer<typeof RoleSchema>;

export const CreateUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
});

export const UserSchema = CreateUserSchema.extend({
  id: z.string().uuid(),
  role: RoleSchema.default("user"),
  avatarUrl: z.string().url().nullable().default(null),
  lastLoginAt: z.date().nullable().default(null),
  createdAt: z.date(),
});

export const UpdateUserRoleSchema = z.object({
  email: z.string().email(),
  role: RoleSchema,
});

export type User = z.infer<typeof UserSchema>;
export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUserRole = z.infer<typeof UpdateUserRoleSchema>;
