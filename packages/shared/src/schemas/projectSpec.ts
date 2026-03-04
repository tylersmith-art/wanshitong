import { z } from "zod";

export const AttachSpecSchema = z.object({
  projectId: z.string().uuid(),
  specId: z.string().uuid(),
});

export const ProjectSpecSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  specId: z.string().uuid(),
  createdAt: z.date(),
});

export type AttachSpec = z.infer<typeof AttachSpecSchema>;
export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;
