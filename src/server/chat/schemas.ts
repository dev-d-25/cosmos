import { z } from "zod";

export const chatRoleSchema = z.enum(["user", "assistant", "system"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const createThreadSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(200),
});
export type CreateThreadInput = z.infer<typeof createThreadSchema>;

export const updateThreadSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    model: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.model !== undefined ||
      value.archived !== undefined,
    { message: "At least one of title, model, archived is required" },
  );
export type UpdateThreadInput = z.infer<typeof updateThreadSchema>;

export const persistUserMessageSchema = z.object({
  threadId: z.string().min(1),
  id: z.string().min(1),
  parts: z.array(z.unknown()),
});
export type PersistUserMessageInput = z.infer<
  typeof persistUserMessageSchema
>;
