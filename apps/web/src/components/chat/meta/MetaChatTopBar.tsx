import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Lock, Maximize2, MoreHorizontal, Share2, SquarePen, X } from "lucide-react";
import { useChatStore, type Session, type SessionMessage } from "../../../stores";

function compactSceneName(sceneId: string): string {
  const normalized = sceneId.trim();
  if (!normalized) {
    return sceneId;
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  if (normalized.startsWith("scene-")) {
    return `scene-${normalized.slice(-6)}`;
  }

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user" && message.content.trim().length > 0);

  if (latestUserMessage) {
    return latestUserMessage.content;
  }

  if (session.currentScene?.sceneId) {
    return compactSceneName(session.currentScene.sceneId);
  }

  return `Session ${session.sessionId.slice(0, 8)}`;
}

function truncateTitle(value: string, maxLength = 48): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

export function MetaChatTopBar() {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const sessions = useChatStore((state) => state.sessions);
  const messages = useChatStore((state) => state.messages);
  const startDraftSession = useChatStore((state) => state.startDraftSession);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );
  const sessionMessages = activeSessionId ? (messages[activeSessionId] ?? []) : [];

  const fullTitle = useMemo(() => {
    if (!activeSession) {
      return "New AI chat";
    }

    return deriveSessionTitle(activeSession, sessionMessages);
  }, [activeSession, sessionMessages]);
  const displayTitle = truncateTitle(fullTitle);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleShare = async () => {
    if (typeof window === "undefined") {
      return;
    }

    const shareUrl = new URL(window.location.href);
    if (activeSessionId) {
      shareUrl.searchParams.set("session", activeSessionId);
    }

    if (!navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      setCopied(true);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 flex min-h-[2.7rem] items-center justify-between gap-1.5 border-b border-meta-border bg-surface/95 px-2 py-1.5 backdrop-blur-2xl md:min-h-[3.25rem] md:gap-2 md:px-4 md:py-3" aria-label="Meta chat top bar">
      <div className="inline-flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md bg-transparent px-1 py-0.5 text-[0.87rem] font-medium text-meta-text transition-colors duration-150 hover:bg-white/5"
          aria-label="Create new chat"
          title="Create new chat"
          onClick={startDraftSession}
        >
          <span className="max-w-[min(46vw,10.5rem)] truncate md:max-w-[min(45vw,20rem)]" title={fullTitle}>{displayTitle}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <div className="hidden items-center gap-1 rounded-full border border-zinc-700 bg-zinc-700/35 px-2 py-0.5 text-[0.66rem] font-semibold uppercase tracking-[0.02em] text-zinc-300 md:inline-flex" aria-label="Private chat">
          <Lock className="h-3 w-3" />
          <span>Private</span>
        </div>
      </div>

      <div className="inline-flex items-center gap-1">
        <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/70 text-meta-muted transition-colors duration-150 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 md:inline-flex" aria-label="Rename chat" title="Rename chat (planned)">
          <SquarePen className="h-4 w-4" />
        </button>
        <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/70 text-meta-muted transition-colors duration-150 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 md:inline-flex" aria-label="Maximize chat" title="Maximize chat (planned)">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={`inline-flex min-h-[1.82rem] items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/70 text-zinc-200 transition-colors duration-150 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 ${copied ? 'w-auto px-2' : 'w-[1.82rem] px-0 md:w-auto md:px-3'}`}
          aria-label="Copy share link"
          title="Copy share link"
          onClick={() => {
            void handleShare();
          }}
        >
          <Share2 className="h-3.5 w-3.5" />
          <span className={`${copied ? 'inline text-[0.69rem] md:text-[0.78rem]' : 'hidden md:inline'} ml-1 whitespace-nowrap`}>{copied ? "Copied" : "Share"}</span>
        </button>
        <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/70 text-meta-muted transition-colors duration-150 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 md:inline-flex" aria-label="More options" title="More options (planned)">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/70 text-meta-muted transition-colors duration-150 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close chat"
          title="Close chat"
          onClick={startDraftSession}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
