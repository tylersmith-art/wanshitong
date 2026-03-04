import { z } from "zod";

export const CreateApiKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
});

export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  keyPrefix: z.string().max(12),
  lastUsedAt: z.date().nullable().default(null),
  createdAt: z.date(),
});

// Extended schema returned only once when the key is first created
export const ApiKeyCreatedSchema = ApiKeySchema.extend({
  plaintextKey: z.string(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
export type ApiKeyCreated = z.infer<typeof ApiKeyCreatedSchema>;
