export type ModelOption = {
  id: string;
  label: string;
  tier: "free" | "pro";
};

export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "stepfun/step-3.7-flash:free",
    label: "StepFun 3.7 Flash (free)",
    tier: "free",
  },
  { id: "kilo-auto/free", label: "Kilo Auto (free)", tier: "free" },
  { id: "kilo-auto/small", label: "Kilo Auto (small)", tier: "free" },
];
