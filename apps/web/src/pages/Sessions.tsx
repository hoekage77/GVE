import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useChatStore } from "../stores";
import { Clock, MessageSquare, ArrowLeft } from "lucide-react";

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (deltaMinutes < 1) return "Just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function generateSessionName(session: any, messages: any[]): string {
  const userMessages = messages.filter((m: any) => m.role === "user" && m.content.trim().length > 0);
  const firstMessage = userMessages[0];

  if (firstMessage) {
    const content = firstMessage.content.trim();
    const words = content.split(/\s+/).slice(0, 5);
    let name = words.join(" ");
    name = name.replace(/[.,!?;:]$/, "");
    if (name.length > 35) name = name.slice(0, 32).trim() + "…";
    if (name.length > 0) return name.charAt(0).toUpperCase() + name.slice(1);
  }

  if (session.currentScene?.sceneId) {
    const sceneId = session.currentScene.sceneId;
    if (sceneId.startsWith("scene-")) return `Scene ${sceneId.slice(-6)}`;
    return sceneId.length <= 20 ? sceneId : sceneId.slice(0, 17) + "…";
  }

  const date = new Date(session.createdAt);
  return `Chat ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const sessions = useChatStore((state) => state.sessions);
  const messages = useChatStore((state) => state.messages);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const selectSession = useChatStore((state) => state.selectSession);
  const startDraftSession = useChatStore((state) => state.startDraftSession);

  useEffect(() => {
    document.title = "GenVis | Sessions";
  }, []);

  const sessionRows = useMemo(() => {
    return (sessions || [])
      .filter((session) => Boolean(session?.sessionId))
      .map((session) => {
        const sessionMessages = messages[session.sessionId] ?? [];
        return {
          sessionId: session.sessionId,
          title: generateSessionName(session, sessionMessages),
          updatedAt: formatUpdatedAt(session.updatedAt),
          messageCount: sessionMessages.filter((m: any) => m.role === "assistant").length,
        };
      })
      .sort((a, b) => {
        const aTime = new Date(sessions.find((s: any) => s.sessionId === a.sessionId)?.updatedAt || 0).getTime();
        const bTime = new Date(sessions.find((s: any) => s.sessionId === b.sessionId)?.updatedAt || 0).getTime();
        return bTime - aTime;
      });
  }, [messages, sessions]);

  const handleSessionClick = (sessionId: string) => {
    void selectSession(sessionId);
    void navigate({ to: "/chat" });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.04] px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate({ to: "/chat" })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-[15px] font-semibold tracking-tight text-white/90">Sessions</h1>
        </div>
        <button
          type="button"
          onClick={startDraftSession}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-3 py-1.5 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white/90"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          New Chat
        </button>
      </div>

      {/* Content */}
      <div className="scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4 md:px-6 md:py-6">
        {sessionRows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04]">
              <MessageSquare className="h-5 w-5 text-white/20" />
            </div>
            <p className="text-[13px] text-white/40">No sessions yet</p>
            <p className="text-[11px] text-white/25">Start a new chat to begin</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-1">
            {sessionRows.map((session) => {
              const hue = (session.title.charCodeAt(0) * 137) % 360;
              const avatarBg = `hsl(${hue}, 55%, 50%)`;
              const isActive = session.sessionId === activeSessionId;

              return (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => handleSessionClick(session.sessionId)}
                  className="group flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-all duration-200 hover:bg-white/[0.04]"
                  style={{
                    background: isActive ? "rgba(255,255,255,0.04)" : "transparent",
                    border: isActive ? "1px solid rgba(255,255,255,0.06)" : "1px solid transparent",
                  }}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                    style={{ background: `${avatarBg}20`, color: avatarBg, border: `1.5px solid ${avatarBg}30` }}
                  >
                    {session.title.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-white/85" title={session.title}>
                        {session.title}
                      </span>
                      {isActive && (
                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-white/35">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {session.updatedAt}
                      </span>
                      {session.messageCount > 0 && (
                        <span>· {session.messageCount} messages</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
