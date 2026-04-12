import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Lock, Maximize2, MoreHorizontal, SquarePen, X } from "lucide-react";
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
    <header className="meta-chat-topbar" aria-label="Meta chat top bar">
      <div className="meta-chat-topbar__left">
        <button
          type="button"
          className="meta-chat-topbar__title-button"
          aria-label="Create new chat"
          title="Create new chat"
          onClick={startDraftSession}
        >
          <span className="meta-chat-topbar__title-text" title={fullTitle}>{displayTitle}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        <div className="meta-chat-topbar__private-badge" aria-label="Private chat">
          <Lock className="h-3 w-3" />
          <span>Private</span>
        </div>
      </div>

      <div className="meta-chat-topbar__right">
        <button type="button" className="meta-chat-topbar__icon-button meta-chat-topbar__icon-button--desktop" aria-label="Rename chat" title="Rename chat (planned)">
          <SquarePen className="h-4 w-4" />
        </button>
        <button type="button" className="meta-chat-topbar__icon-button meta-chat-topbar__icon-button--desktop" aria-label="Maximize chat" title="Maximize chat (planned)">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="meta-chat-topbar__share-button"
          aria-label="Copy share link"
          title="Copy share link"
          onClick={() => {
            void handleShare();
          }}
        >
          {copied ? "Copied" : "Share"}
        </button>
        <button type="button" className="meta-chat-topbar__icon-button" aria-label="More options" title="More options (planned)">
          <MoreHorizontal className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="meta-chat-topbar__icon-button"
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
