import { useMemo, useState } from "react";
import { ChevronDown, Share2, X, ArrowLeft } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useChatStore, type Session, type SessionMessage } from "../../stores";
import { CodebaseAgentTrigger } from "../agents";

function compactSceneName(sceneId: string | undefined): string {
  const normalized = String(sceneId ?? "").trim();
  if (!normalized) return "";
  if (normalized.length <= 16) return normalized;
  if (normalized.startsWith("scene-")) return `scene-${normalized.slice(-6)}`;
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
}

function deriveSessionTitle(session: Session, messages: SessionMessage[]): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user" && message.content.trim().length > 0);
  if (latestUserMessage) {
    return latestUserMessage.content;
  }
  if (session.currentScene?.sceneId) {
    return compactSceneName(session.currentScene.sceneId);
  }
  return `Session ${session.sessionId.slice(0, 8)}`;
}

function truncateTitle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function MetaHeader() {
  const [copied, setCopied] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const sessions = useChatStore((state) => state.sessions);
  const messages = useChatStore((state) => state.messages);
  const startDraftSession = useChatStore((state) => state.startDraftSession);

  const activeSession = useMemo(
    () => (sessions || []).find((session) => session?.sessionId === activeSessionId) ?? null,
    [sessions, activeSessionId]
  );

  const fullTitle = useMemo(() => {
    if (pathname.startsWith("/scenes")) return "Scenes";
    if (pathname.startsWith("/tasks")) return "Tasks Pipeline";
    if (pathname.startsWith("/profile")) return "Settings";
    if (!activeSession) return "New AI chat";
    const sessionMessages = activeSessionId ? (messages[activeSessionId] ?? []) : [];
    return deriveSessionTitle(activeSession, sessionMessages);
  }, [activeSession, activeSessionId, messages, pathname]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const displayTitle = truncateTitle(fullTitle, isMobile ? 28 : 42);

  const isChatRoute = pathname.startsWith("/chat") || pathname === "/";

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <header className="relative z-40 flex shrink-0 border-b border-white/[0.04] bg-transparent backdrop-blur-sm" aria-label="Main header">
      <div className="relative flex w-full items-center justify-between gap-2 py-2 px-3 md:min-h-[2.75rem] md:px-4 lg:px-6">
        {/* Left — Actions */}
        <div className="flex flex-1 items-center gap-2 overflow-hidden">
          {!isChatRoute && (
            <Link
              to="/chat"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
              aria-label="Back to Studio"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
        </div>

        {/* Center — Title */}
        <div className="flex shrink-0 items-center justify-center">
          {isChatRoute ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-white/80 transition-colors hover:bg-white/[0.06]"
              onClick={startDraftSession}
              title="Start new session"
            >
              <span className="max-w-[min(40vw,24rem)] truncate font-medium tracking-tight" title={fullTitle}>
                {displayTitle}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-40" />
            </button>
          ) : (
            <span className="text-[13px] font-semibold tracking-tight text-white/80">{fullTitle}</span>
          )}
        </div>

        {/* Right — Actions */}
        <div className="flex flex-1 items-center justify-end gap-1.5 overflow-hidden">
          <CodebaseAgentTrigger />

          <button
            type="button"
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md transition-colors hover:bg-white/[0.06] ${copied ? "bg-emerald-500/10 text-emerald-400" : "text-white/40 hover:text-white/70"}`}
            onClick={handleShare}
          >
            <Share2 className="h-3.5 w-3.5" />
            {copied && <span className="pr-1 text-[11px] font-medium">Copied</span>}
          </button>

          {isChatRoute && (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
              onClick={startDraftSession}
              title="New session"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {!isChatRoute && (
            <Link
              to="/chat"
              className="inline-flex h-8 items-center justify-center rounded-md bg-white/[0.06] px-3 text-[11px] font-medium uppercase tracking-wider text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white/90"
            >
              Open Studio
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
