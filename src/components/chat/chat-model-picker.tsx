"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODEL_OPTIONS } from "@/lib/ai/model-options";
import { Cpu, Zap } from "lucide-react";

interface ChatModelPickerProps {
  value: string;
  onChange: (model: string) => void;
}

export function ChatModelPicker({ value, onChange }: ChatModelPickerProps) {
  return (
    <Select
      value={value}
      onValueChange={(v: string | null) => {
        if (v) onChange(v);
      }}
    >
      <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs">
        <Cpu className="size-3" />
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent>
        {MODEL_OPTIONS.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            <div className="flex items-center gap-1.5">
              {model.tier === "free" && (
                <Zap className="size-3 text-green-500" />
              )}
              <span>{model.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
