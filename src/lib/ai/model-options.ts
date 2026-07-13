export const DEFAULT_MODEL = "deepseek-v4-flash-free";

export type ModelOption = {
  id: string;
  label: string;
  tier: "free" | "pro";
  provider: "kilo" | "opencode-zen";
  defaultReasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "deepseek-v4-flash-free",
    label: "DeepSeek V4 Flash (free)",
    tier: "free",
    provider: "opencode-zen",
    defaultReasoningEffort: "medium",
  },
  {
    id: "mimo-v2.5-free",
    label: "MiMo V2.5 (free)",
    tier: "free",
    provider: "opencode-zen",
  },
  {
    id: "hy3-free",
    label: "Hy3 (free)",
    tier: "free",
    provider: "opencode-zen",
  },
  {
    id: "stepfun/step-3.7-flash:free",
    label: "StepFun 3.7 Flash (free)",
    tier: "free",
    provider: "kilo",
  },
  { id: "kilo-auto/free", label: "Kilo Auto (free)", tier: "free", provider: "kilo" },
];
