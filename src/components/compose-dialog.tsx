"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { RecipientInput } from "@/components/recipient-input";

const DRAFT_STORAGE_KEY = "mail_compose_draft";

interface ComposeAttachment {
  file: File;
  name: string;
  size: number;
  type: string;
  preview?: string;
}

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  threadId?: string;
  mode?: "compose" | "reply" | "replyAll" | "forward";
}

export function ComposeDialog({
  open,
  onOpenChange,
  initialTo = "",
  initialSubject = "",
  initialBody = "",
  threadId,
  mode = "compose",
}: ComposeDialogProps) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(initialSubject);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Write your message...",
      }),
      Underline,
    ],
    content: initialBody || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[200px] px-4 py-3 text-sm outline-none",
      },
    },
  });

  // Focus To input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => toInputRef.current?.focus(), 100);
    }
  }, [open]);

  // Reset fields when dialog opens, restore from session storage if available
  useEffect(() => {
    if (open) {
      const saved = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        try {
          const draft = JSON.parse(saved);
          setTo(draft.to || "");
          setCc(draft.cc || "");
          setBcc(draft.bcc || "");
          setSubject(draft.subject || "");
          setDraftId(draft.draftId || null);
          setShowCc(!!draft.cc);
          setShowBcc(!!draft.bcc);
          if (editor) {
            editor.commands.setContent(draft.html || "");
          }
          return;
        } catch {
          // Fall through to defaults
        }
      }
      setTo(initialTo);
      setCc("");
      setBcc("");
      setSubject(initialSubject);
      setShowCc(false);
      setShowBcc(false);
      setDraftId(null);
      if (editor && initialBody) {
        editor.commands.setContent(initialBody);
      } else if (editor) {
        editor.commands.clearContent();
      }
    }
  }, [open, initialTo, initialSubject, initialBody, editor]);

  // Mark as unsaved when form changes
  useEffect(() => {
    if (!open) return;
    const handler = () => setHasUnsavedChanges(true);
    // We'll trigger this by watching the form values
    return () => {};
  }, [open, to, cc, bcc, subject, attachments]);

  // Auto-save draft after 3 seconds of inactivity
  useEffect(() => {
    if (!hasUnsavedChanges || !open || isSavingDraft) return;
    if (!to.trim() && !subject.trim() && !editor?.getHTML()) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      setIsSavingDraft(true);
      try {
        const htmlBody = editor?.getHTML() || "";
        const res = await fetch("/api/mail/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: draftId ? "update" : "create",
            draftId,
            to,
            cc: showCc ? cc : undefined,
            bcc: showBcc ? bcc : undefined,
            subject: subject || "(No subject)",
            html: htmlBody,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const newDraftId = data.id && !draftId ? data.id : draftId;
          if (newDraftId) {
            setDraftId(newDraftId);
          }
          setHasUnsavedChanges(false);
          sessionStorage.setItem(
            DRAFT_STORAGE_KEY,
            JSON.stringify({
              draftId: newDraftId,
              to,
              cc: showCc ? cc : "",
              bcc: showBcc ? bcc : "",
              subject,
              html: htmlBody,
            }),
          );
        }
      } catch {
        // Silent fail for auto-save
      } finally {
        setIsSavingDraft(false);
      }
    }, 3000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, open, isSavingDraft, to, cc, bcc, showCc, showBcc, subject, editor, draftId]);

  const handleAddFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: ComposeAttachment[] = [];
    for (const file of Array.from(files)) {
      const attachment: ComposeAttachment = {
        file,
        name: file.name,
        size: file.size,
        type: file.type,
      };
      // Create preview for images
      if (file.type.startsWith("image/")) {
        attachment.preview = URL.createObjectURL(file);
      }
      newAttachments.push(attachment);
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const removed = prev[index];
      if (removed?.preview) {
        URL.revokeObjectURL(removed.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (files?.length) {
        handleAddFiles(files);
      }
    },
    [handleAddFiles],
  );

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSaveDraft = useCallback(async () => {
    if (isSavingDraft) return;
    if (!to.trim() && !subject.trim() && !editor?.getHTML().replace(/<p><\/p>/g, "")) return;

    setIsSavingDraft(true);
    try {
      const htmlBody = editor?.getHTML() || "";
      const res = await fetch("/api/mail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: draftId ? "update" : "create",
          draftId,
          to,
          cc: showCc ? cc : undefined,
          bcc: showBcc ? bcc : undefined,
          subject: subject || "(No subject)",
          html: htmlBody,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const newDraftId = data.id && !draftId ? data.id : draftId;
        if (newDraftId) {
          setDraftId(newDraftId);
        }
        setHasUnsavedChanges(false);
        sessionStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({
            draftId: newDraftId,
            to,
            cc: showCc ? cc : "",
            bcc: showBcc ? bcc : "",
            subject,
            html: htmlBody,
          }),
        );
      }
    } catch {
      // Silent fail for manual save
    } finally {
      setIsSavingDraft(false);
    }
  }, [isSavingDraft, to, cc, bcc, showCc, showBcc, subject, editor, draftId]);

  const handleDiscardDraft = useCallback(async () => {
    if (draftId) {
      try {
        await fetch("/api/mail/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", draftId }),
        });
      } catch {
        // Silent fail
      }
    }
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    setShowDiscardDialog(false);
    onOpenChange(false);
  }, [draftId, onOpenChange]);

  const handleSend = useCallback(async () => {
    if (!to.trim() || isSending) return;
    setIsSending(true);

    try {
      const htmlBody = editor?.getHTML() || "";
      const textBody = editor?.getText() || "";

      // Serialize attachments to base64
      const serializedAttachments = await Promise.all(
        attachments.map(async (att) => {
          return new Promise<{ filename: string; mimeType: string; data: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(",")[1] || "";
              resolve({
                filename: att.name,
                mimeType: att.type,
                data: base64,
              });
            };
            reader.readAsDataURL(att.file);
          });
        }),
      );

      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          to: to.split(",").map((e) => e.trim()).filter(Boolean),
          cc: showCc && cc ? cc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
          bcc: showBcc && bcc ? bcc.split(",").map((e) => e.trim()).filter(Boolean) : undefined,
          subject: subject || "(No subject)",
          html: htmlBody,
          text: textBody,
          threadId,
          attachments: serializedAttachments.length > 0 ? serializedAttachments : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Send failed" }));
        console.error("Send failed:", err.error);
        return;
      }

      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      onOpenChange(false);
    } catch (err) {
      console.error("Send error:", err);
    } finally {
      setIsSending(false);
    }
  }, [to, cc, bcc, showCc, showBcc, subject, editor, threadId, isSending, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    },
    [handleSend, onOpenChange],
  );

  const title =
    mode === "reply"
      ? "Reply"
      : mode === "replyAll"
        ? "Reply All"
        : mode === "forward"
          ? "Forward"
          : "New Message";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[8%] translate-y-0 sm:max-w-2xl"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col">
          {/* To */}
          <div className="flex items-center border-b">
            <span className="text-muted-foreground w-16 shrink-0 px-3 text-xs">
              To
            </span>
            <RecipientInput
              ref={toInputRef}
              value={to}
              onChange={setTo}
              placeholder="recipient@email.com"
              className="flex-1"
            />
            {!showCc && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground px-2 text-xs"
                onClick={() => setShowCc(true)}
              >
                Cc
              </button>
            )}
            {!showBcc && showCc && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground px-2 text-xs"
                onClick={() => setShowBcc(true)}
              >
                Bcc
              </button>
            )}
          </div>

          {/* CC */}
          {showCc && (
            <div className="flex items-center border-b">
              <span className="text-muted-foreground w-16 shrink-0 px-3 text-xs">
                Cc
              </span>
              <RecipientInput
                value={cc}
                onChange={setCc}
                placeholder="cc@email.com"
                className="flex-1"
              />
            </div>
          )}

          {/* BCC */}
          {showBcc && (
            <div className="flex items-center border-b">
              <span className="text-muted-foreground w-16 shrink-0 px-3 text-xs">
                Bcc
              </span>
              <RecipientInput
                value={bcc}
                onChange={setBcc}
                placeholder="bcc@email.com"
                className="flex-1"
              />
            </div>
          )}

          {/* Subject */}
          <div className="flex items-center border-b">
            <span className="text-muted-foreground w-16 shrink-0 px-3 text-xs">
              Subject
            </span>
            <input
              className="bg-transparent text-foreground placeholder:text-muted-foreground flex-1 px-1 py-2.5 text-sm outline-none"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Editor */}
          <div className="min-h-[250px] overflow-y-auto" onPaste={handlePaste}>
            <EditorContent editor={editor} />
          </div>

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t px-4 py-2">
              {attachments.map((att, i) => (
                <div
                  key={`${att.name}-${i}`}
                  className="bg-muted flex items-center gap-2 rounded-md px-2 py-1 text-xs"
                >
                  {att.preview ? (
                    <img
                      src={att.preview}
                      alt={att.name}
                      className="size-6 rounded object-cover"
                    />
                  ) : (
                    <svg className="text-muted-foreground size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 2" />
                    </svg>
                  )}
                  <span className="max-w-[120px] truncate">{att.name}</span>
                  <span className="text-muted-foreground">{formatFileSize(att.size)}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(i)}
                    className="text-muted-foreground hover:text-foreground ml-1"
                  >
                    <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t pt-3">
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!to.trim() || isSending}
            className="bg-primary text-primary-foreground"
          >
            {isSending ? "Sending..." : "Send"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || (!to.trim() && !subject.trim())}
          >
            Save Draft
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDiscardDialog(true)}
          >
            Discard
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {isSavingDraft && (
              <span className="text-muted-foreground text-[0.65rem]">Saving draft...</span>
            )}
            {!isSavingDraft && draftId && (
              <span className="text-muted-foreground text-[0.65rem]">Draft saved</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleAddFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="text-muted-foreground h-8 w-8 p-0"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </Button>
            <span className="text-[0.65rem] text-muted-foreground">
              {navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"}+Enter to send
            </span>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft will be permanently deleted from your Gmail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardDraft}>Yes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
