import { z } from "zod";

export const CreateNotificationSchema = z.object({
  title: z.string().min(1, "Title is required").max(255),
  body: z.string().min(1, "Body is required").max(2000),
  actionUrl: z.string().max(500).nullable().optional(),
});

export const NotificationSchema = CreateNotificationSchema.extend({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  read: z.boolean(),
  createdAt: z.date(),
});

export const PushTokenSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  token: z.string().min(1).max(255),
  createdAt: z.date(),
});

export const RegisterPushTokenSchema = z.object({
  token: z.string().min(1).max(255),
});

export const NotificationListInputSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const UpdatePushOptOutSchema = z.object({
  optOut: z.boolean(),
});

export type Notification = z.infer<typeof NotificationSchema>;
export type CreateNotification = z.infer<typeof CreateNotificationSchema>;
export type PushToken = z.infer<typeof PushTokenSchema>;
export type RegisterPushToken = z.infer<typeof RegisterPushTokenSchema>;
export type NotificationListInput = z.infer<typeof NotificationListInputSchema>;
export type UpdatePushOptOut = z.infer<typeof UpdatePushOptOutSchema>;
