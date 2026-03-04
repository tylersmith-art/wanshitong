import { z } from "zod";

export const QueryLogSchema = z.object({
  id: z.string().uuid(),
  apiKeyId: z.string().uuid(),
  query: z.string(),
  resultCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  createdAt: z.date(),
});

export const QueryLogListInputSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  apiKeyId: z.string().uuid().optional(),
});

export type QueryLog = z.infer<typeof QueryLogSchema>;
export type QueryLogListInput = z.infer<typeof QueryLogListInputSchema>;
