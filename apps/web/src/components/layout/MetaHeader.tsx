import { useMemo, useState, useEffect, useRef } from "react";
import { ChevronDown, Share2, X, SquarePen, Maximize2, MoreHorizontal, Lock, ArrowLeft, Clapperboard, ListTodo, User, PanelLeftOpen } from "lucide-react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useChatStore, type Session, type SessionMessage } from "../../stores";

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

function truncateTitle(value: string, isMobile = false): string {
  const maxLength = isMobile ? 24 : 48;
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

export function MetaHeader() {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();

  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const sessions = useChatStore((state) => state.sessions);
  const messages = useChatStore((state) => state.messages);
  const startDraftSession = useChatStore((state) => state.startDraftSession);

  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? null,
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

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const displayTitle = truncateTitle(fullTitle, isMobile);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const isSidebarCollapsed = useChatStore((state) => state.isSidebarCollapsed);
  const setSidebarCollapsed = useChatStore((state) => state.setSidebarCollapsed);

  const isChatRoute = pathname.startsWith("/chat") || pathname === "/";

  return (
    <header className="relative z-40 flex shrink-0 bg-surface-2" aria-label="Standard header">
      <div className="relative flex w-full items-center justify-between gap-1.5 py-1.5 px-3 md:min-h-[3rem] md:gap-2 md:py-2 lg:px-24 xl:px-48 2xl:px-72">
        {/* Left Section */}
        <div className="flex flex-1 items-center gap-1.5 md:gap-2 overflow-hidden">
          {/* Sidebar Toggle */}
          {isSidebarCollapsed && (
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text lg:hidden"
              onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
              aria-label="Open sidebar"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}

          {!isChatRoute && (
            <Link 
              to="/chat" 
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text"
              aria-label="Back to Studio"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          
          <div className="hidden items-center gap-2 md:flex">
            {pathname.startsWith("/scenes") && <Clapperboard className="h-4 w-4 text-meta-muted" />}
            {pathname.startsWith("/tasks") && <ListTodo className="h-4 w-4 text-meta-muted" />}
            {pathname.startsWith("/profile") && <User className="h-4 w-4 text-meta-muted" />}
          </div>

        </div>

        {/* Center Section - Title */}
        <div className="flex shrink-0 items-center justify-center px-2">
          {isChatRoute ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-normal text-meta-text transition-colors hover:bg-white/[0.06]"
              onClick={startDraftSession}
            >
              <span className="max-w-[min(35vw,20rem)] truncate font-medium tracking-tight" title={fullTitle}>{displayTitle}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-40" />
            </button>
          ) : (
            <span className="text-[13px] font-semibold tracking-tight text-meta-text">{fullTitle}</span>
          )}
        </div>

        {/* Right Section - Actions */}
        <div className="flex flex-1 items-center justify-end gap-1 overflow-hidden">
          {isChatRoute ? (
            <>
              <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text md:inline-flex" aria-label="Rename chat">
                <SquarePen className="h-4 w-4" />
              </button>
              <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text md:inline-flex" aria-label="Maximize chat">
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={`inline-flex min-h-[1.82rem] items-center justify-center rounded-md bg-surface-3 text-meta-text transition-colors hover:bg-surface ${copied ? 'w-auto px-2' : 'w-[1.82rem] px-0 md:w-auto md:px-3'}`}
                onClick={handleShare}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className={`${copied ? 'inline text-[0.69rem] md:text-[0.78rem]' : 'hidden md:inline'} ml-1 whitespace-nowrap`}>{copied ? "Copied" : "Share"}</span>
              </button>
              <button type="button" className="hidden h-8 w-8 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text md:inline-flex" aria-label="More options">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-surface-3 text-meta-muted transition-colors hover:bg-surface hover:text-meta-text"
                onClick={startDraftSession}
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
             <Link 
              to="/chat" 
              className="inline-flex h-8 items-center justify-center rounded-md bg-surface-3 px-3 text-[11px] font-medium uppercase tracking-wider text-meta-text transition-colors hover:bg-surface"
            >
              Open Studio
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
