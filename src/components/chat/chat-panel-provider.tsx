"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { DEFAULT_MODEL } from "@/lib/ai/model-options";

type ChatPanelState = {
  open: boolean;
  activeThreadId: string | null;
  model: string;
};

type ChatPanelContextValue = ChatPanelState & {
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setActiveThreadId: (id: string | null) => void;
  startNewThread: () => void;
  setModel: (model: string) => void;
};

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [model, setModelState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("cosmos-chat-model") ?? DEFAULT_MODEL;
    }
    return DEFAULT_MODEL;
  });

  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const toggle = useCallback(() => setOpenState((o) => !o), []);
  const startNewThread = useCallback(() => setActiveThreadId(null), []);

  const setModel = useCallback((m: string) => {
    setModelState(m);
    if (typeof window !== "undefined") {
      localStorage.setItem("cosmos-chat-model", m);
    }
  }, []);

  return (
    <ChatPanelContext.Provider
      value={{ open, setOpen, toggle, activeThreadId, setActiveThreadId, startNewThread, model, setModel }}
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
