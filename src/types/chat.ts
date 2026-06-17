import type { InferSelectModel } from "drizzle-orm";
import type { chatThread, chatMessage } from "@/server/db/schema";

export type ChatThread = InferSelectModel<typeof chatThread>;
export type ChatMessage = InferSelectModel<typeof chatMessage>;

export type ChatRole = ChatMessage["role"];
export type ChatMessagePart = unknown;
