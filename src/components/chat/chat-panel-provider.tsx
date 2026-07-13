"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { DEFAULT_MODEL, MODEL_OPTIONS, type ModelOption } from "@/lib/ai/model-options";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

type ChatPanelState = {
  open: boolean;
  activeThreadId: string | null;
  model: string;
  reasoningEffort: ReasoningEffort | undefined;
};

type ChatPanelContextValue = ChatPanelState & {
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveThreadId: (id: string | null) => void;
  startNewThread: () => void;
  setModel: (model: string) => void;
  setReasoningEffort: (effort: ReasoningEffort | undefined) => void;
};

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

function getDefaultReasoningEffort(modelId: string): ReasoningEffort | undefined {
  const opt = MODEL_OPTIONS.find((m) => m.id === modelId);
  return opt?.defaultReasoningEffort;
}

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [model, setModelState] = useState<string>(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffortState] = useState<ReasoningEffort | undefined>(
    getDefaultReasoningEffort(DEFAULT_MODEL),
  );

  // Sync from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const stored = localStorage.getItem("cosmos-chat-model");
    if (stored && MODEL_OPTIONS.some((m) => m.id === stored)) {
      setModelState(stored);
      setReasoningEffortState(getDefaultReasoningEffort(stored));
    }
  }, []);

  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const toggle = useCallback(() => setOpenState((o) => !o), []);
  const startNewThread = useCallback(() => setActiveThreadId(null), []);

  const setModel = useCallback((m: string) => {
    setModelState(m);
    setReasoningEffortState(getDefaultReasoningEffort(m));
    if (typeof window !== "undefined") {
      localStorage.setItem("cosmos-chat-model", m);
    }
  }, []);

  const setReasoningEffort = useCallback((effort: ReasoningEffort | undefined) => {
    setReasoningEffortState(effort);
  }, []);

  return (
    <ChatPanelContext.Provider
      value={{ open, setOpen, toggle, activeThreadId, setActiveThreadId, startNewThread, model, setModel, reasoningEffort, setReasoningEffort }}
    >
      {children}
    </ChatPanelContext.Provider>
  );
}

export function useChatPanel() {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) throw new Error("useChatPanel must be used within ChatPanelProvider");
  return ctx;
}
