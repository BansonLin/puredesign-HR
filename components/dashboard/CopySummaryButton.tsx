"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 「複製今日一行摘要」 (CLAUDE.md §8, PLAN T20). The summary text is produced
 * on the server (`buildDailySummary`, lib/metrics/summary.ts) and passed in;
 * this component only copies it. It is always shown in a read-only text box
 * so HR can check what will be pasted, and that box doubles as the fallback:
 * when `navigator.clipboard` is unavailable or rejects (the LINE in-app
 * browser, an insecure origin) the click selects the whole text and asks HR
 * to long-press and copy. Focusing / tapping the box also selects all.
 * No data, no clock — the initial render is plain markup (unit-testable
 * through react-dom/server).
 */
export const COPY_LABEL = "複製今日一行摘要";
export const COPIED_LABEL = "已複製";
export const SUMMARY_LABEL = "今日一行摘要";
export const FALLBACK_MESSAGE = "無法自動複製，已為您選取文字，請長按複製";

type CopyState = "idle" | "copied" | "fallback";

export interface CopySummaryButtonProps {
  /** The line to copy, already formatted by the server. */
  text: string;
}

/** `navigator.clipboard.writeText` when the browser exposes it, else null. */
function clipboardWriter(): ((text: string) => Promise<void>) | null {
  if (typeof navigator === "undefined") return null;
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return null;
  return (text) => clipboard.writeText(text);
}

export function CopySummaryButton({ text }: CopySummaryButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function selectAll() {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }

  async function copy() {
    const write = clipboardWriter();
    if (write) {
      try {
        await write(text);
        setState("copied");
        return;
      } catch {
        // fall through to the manual path
      }
    }
    selectAll();
    setState("fallback");
  }

  return (
    <div className="flex flex-col gap-2" data-testid="copy-summary" data-state={state}>
      <Label htmlFor="daily-summary">{SUMMARY_LABEL}</Label>
      <Textarea
        id="daily-summary"
        ref={textareaRef}
        readOnly
        value={text}
        rows={3}
        onFocus={(event) => event.currentTarget.select()}
        className="break-all text-sm"
        data-testid="summary-text"
      />
      <Button type="button" data-primary onClick={copy} aria-live="polite" className="w-full">
        {state === "copied" ? COPIED_LABEL : COPY_LABEL}
      </Button>
      {state === "fallback" ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="copy-fallback">
          {FALLBACK_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
