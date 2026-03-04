import { z } from "zod";

export const VisibilitySchema = z.enum(["global", "org", "user"]);
export type Visibility = z.infer<typeof VisibilitySchema>;

export const EmbeddingStatusSchema = z.enum(["pending", "processing", "complete", "failed"]);
export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;

export const CreateSpecSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000).default(""),
  content: z.string().min(1, "Content is required"),
  visibility: VisibilitySchema.default("user"),
  orgId: z.string().uuid().optional(),
}).refine(
  (data) => data.visibility !== "org" || data.orgId !== undefined,
  { message: "orgId is required when visibility is 'org'", path: ["orgId"] }
);

export const SpecSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  visibility: VisibilitySchema,
  orgId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  summary: z.string().nullable().default(null),
  embeddingStatus: EmbeddingStatusSchema.default("pending"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpdateSpecSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  content: z.string().min(1).optional(),
  visibility: VisibilitySchema.optional(),
  orgId: z.string().uuid().optional().nullable(),
});

export type Spec = z.infer<typeof SpecSchema>;
export type CreateSpec = z.infer<typeof CreateSpecSchema>;
export type UpdateSpec = z.infer<typeof UpdateSpecSchema>;
