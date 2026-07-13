import "server-only";

import { createDeepSeek } from "@ai-sdk/deepseek";

import { env } from "@/env";

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/**
 * OpenCode Zen provider.
 *
 * Uses @ai-sdk/deepseek which handles reasoning_content natively.
 * The standard @ai-sdk/openai provider silently drops reasoning_content.
 * See: https://github.com/vercel/ai/issues/4461
 */
export const opencodeZen = createDeepSeek({
  baseURL: OPENCODE_ZEN_BASE_URL,
  apiKey: env.OPENCODE_ZEN_API_KEY ?? "",
});
