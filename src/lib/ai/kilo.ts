import "server-only";

import { createOpenAI } from "@ai-sdk/openai";

import { env } from "@/env";

export const KILO_BASE_URL = "https://api.kilo.ai/api/gateway";

export const kilo = createOpenAI({
  baseURL: KILO_BASE_URL,
  apiKey: env.KILO_API_KEY ?? "",
});

export const DEFAULT_MODEL = env.KILO_DEFAULT_MODEL;
