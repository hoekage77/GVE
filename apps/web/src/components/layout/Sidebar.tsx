import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  MonitorPlay,
  ListTodo,
  Settings,
  Plus,
  LogOut,
  Layers,
  Sparkles,
  PanelLeftOpen,
  PanelLeftClose,
  MessageSquare,
} from "lucide-react";
import { useChatStore, type Session, type SessionMessage } from "../../stores";
import { useAuth } from "../../lib/clerk";
import { useSessions } from "../../hooks/queries";

const SIDEBAR_BG = "#111113";
const WHITE_70 = "rgba(255,255,255,0.65)";
const WHITE_45 = "rgba(255,255,255,0.38)";
const WHITE_20 = "rgba(255,255,255,0.15)";
const WHITE_06 = "rgba(255,255,255,0.05)";
const ACCENT = "#e8e8e8";

/* ─── Session Naming ─── */
function generateSessionName(session: Session, messages: SessionMessage[]): string {
  const userMessages = messages.filter((m) => m.role === "user" && m.content.trim().length > 0);
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

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const deltaMinutes = Math.floor((Date.now() - timestamp) / 60000);
  if (deltaMinutes < 1) return "Just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getActiveDestination(pathname: string): SidebarDestination {
  if (pathname.startsWith("/scenes")) return "scenes";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/sessions")) return "sessions";
  if (pathname.startsWith("/profile")) return "profile";
  return "chat";
}

type SidebarDestination = "chat" | "scenes" | "tasks" | "sessions" | "profile";

/* ═══════════════════════════════════════════
   COMPACT NAV ITEM — Cursor / VS Code style
   ═══════════════════════════════════════════ */

interface NavItemDef {
  id: SidebarDestination;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItemDef[] = [
  { id: "chat", label: "Studio", icon: <LayoutGrid className="h-[15px] w-[15px]" strokeWidth={2} /> },
  { id: "scenes", label: "Scenes", icon: <MonitorPlay className="h-[15px] w-[15px]" strokeWidth={2} /> },
  { id: "tasks", label: "Tasks", icon: <ListTodo className="h-[15px] w-[15px]" strokeWidth={2} /> },
  { id: "sessions", label: "Sessions", icon: <Layers className="h-[15px] w-[15px]" strokeWidth={2} /> },
];

function NavItem({
  item,
  isActive,
  onClick,
}: {
  item: NavItemDef;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex w-full items-center gap-2.5 rounded-md px-2 py-[6px] text-left transition-all duration-150"
      style={{
        background: isActive ? "rgba(255,255,255,0.055)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Active indicator — thin left bar */}
      {isActive && (
        <motion.div
          layoutId="navActive"
          className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full"
          style={{ background: ACCENT }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}

      <span style={{ color: isActive ? "#fff" : WHITE_45 }} className="flex shrink-0 items-center">
        {item.icon}
      </span>
      <span
        className="truncate text-[13px] leading-none"
        style={{ color: isActive ? "#fff" : WHITE_70, fontWeight: isActive ? 500 : 400 }}
      >
        {item.label}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════
   COMPACT SESSION ITEM
   ═══════════════════════════════════════════ */

function SessionItem({
  session,
  isActive,
  onClick,
}: {
  session: { sessionId: string; title: string; updatedAt: string };
  isActive: boolean;
  onClick: () => void;
}) {
  const initial = session.title.trim() ? session.title.charAt(0).toUpperCase() : "C";
  const hue = (session.title.charCodeAt(0) * 137) % 360;
  const dotColor = `hsl(${hue}, 55%, 55%)`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left transition-all duration-150"
      style={{
        background: isActive ? "rgba(255,255,255,0.055)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.035)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {isActive && (
        <motion.div
          layoutId="sessionActive"
          className="absolute left-0 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-r-full"
          style={{ background: "rgba(255,255,255,0.35)" }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}

      {/* Small dot instead of avatar circle */}
      <div
        className="h-[6px] w-[6px] shrink-0 rounded-full"
        style={{
          background: dotColor,
          opacity: isActive ? 1 : 0.6,
          boxShadow: isActive ? `0 0 6px ${dotColor}50` : "none",
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className="truncate text-[12px] leading-[1.35]"
          style={{ color: isActive ? "#fff" : WHITE_70, fontWeight: isActive ? 450 : 400 }}
          title={session.title}
        >
          {session.title}
        </span>
      </div>

      <span className="shrink-0 text-[10px]" style={{ color: WHITE_20 }}>
        {session.updatedAt}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════
   SIDEBAR PANEL
   ═══════════════════════════════════════════ */

function SidebarPanel({
  activeDestination,
  navigateTo,
  sessionRows,
  activeSessionId,
  selectSession,
  startDraftSession,
  signOut,
  onClose,
  isMobile,
  sessionsLoading,
}: {
  activeDestination: SidebarDestination;
  navigateTo: (dest: SidebarDestination) => void;
  sessionRows: { sessionId: string; title: string; updatedAt: string }[];
  activeSessionId: string | null;
  selectSession: (sessionId: string) => void;
  startDraftSession: () => void;
  signOut: (() => void) | undefined;
  onClose: () => void;
  isMobile?: boolean;
  sessionsLoading?: boolean;
}) {
  const handleNav = (dest: SidebarDestination) => {
    navigateTo(dest);
    if (isMobile) onClose();
  };

  const handleSelectSession = (sessionId: string) => {
    selectSession(sessionId);
    if (isMobile) onClose();
  };

  return (
    <div className="relative flex h-full w-[240px] flex-col overflow-hidden" style={{ background: SIDEBAR_BG }}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-3 pt-4 pb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" style={{ color: WHITE_45 }} />
          <span className="text-[12px] font-semibold tracking-tight" style={{ color: WHITE_70 }}>
            GenVis
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex shrink-0 flex-col gap-px px-2 pb-1">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            isActive={activeDestination === item.id}
            onClick={() => handleNav(item.id)}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="mx-3 my-1.5 h-px" style={{ background: "rgba(255,255,255,0.04)" }} />

      {/* Session List — fills space */}
      <div className="flex min-h-0 flex-1 flex-col px-2">
        {/* Section label */}
        <div className="mb-0.5 flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: WHITE_20 }}>
            History
          </span>
          <span className="text-[10px]" style={{ color: WHITE_20 }}>
            {sessionRows.length}
          </span>
        </div>

        {sessionsLoading && sessionRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-white/40" />
            <p className="mt-1.5 text-[11px]" style={{ color: WHITE_20 }}>Loading…</p>
          </div>
        ) : sessionRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <MessageSquare className="mb-1.5 h-4 w-4" style={{ color: WHITE_20 }} />
            <p className="text-[11px]" style={{ color: WHITE_20 }}>No sessions yet</p>
          </div>
        ) : (
          <div className="scrollbar flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pb-1">
            {sessionRows.map((session) => (
              <SessionItem
                key={session.sessionId}
                session={session}
                isActive={session.sessionId === activeSessionId}
                onClick={() => handleSelectSession(session.sessionId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t px-2 py-1.5" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        <button
          type="button"
          onClick={() => { startDraftSession(); if (isMobile) onClose(); }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left transition-all duration-150 hover:bg-white/[0.04]"
        >
          <Plus className="h-[14px] w-[14px] shrink-0" style={{ color: WHITE_45 }} />
          <span className="text-[13px]" style={{ color: WHITE_70 }}>New chat</span>
        </button>

        <button
          type="button"
          onClick={() => handleNav("profile")}
          className="flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left transition-all duration-150"
          style={{ background: activeDestination === "profile" ? "rgba(255,255,255,0.055)" : "transparent" }}
          onMouseEnter={(e) => { if (activeDestination !== "profile") e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          onMouseLeave={(e) => { if (activeDestination !== "profile") e.currentTarget.style.background = "transparent"; }}
        >
          <Settings className="h-[14px] w-[14px] shrink-0" style={{ color: activeDestination === "profile" ? "#fff" : WHITE_45 }} />
          <span className="text-[13px]" style={{ color: activeDestination === "profile" ? "#fff" : WHITE_70 }}>Settings</span>
        </button>

        <button
          type="button"
          onClick={() => signOut?.()}
          className="flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left transition-all duration-150 hover:bg-white/[0.04]"
        >
          <LogOut className="h-[14px] w-[14px] shrink-0" style={{ color: WHITE_20 }} />
          <span className="text-[12px]" style={{ color: WHITE_20 }}>Sign Out</span>
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   TRIGGER BUTTON
   ═══════════════════════════════════════════ */

function SidebarTrigger({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ duration: 0.15 }}
      className="fixed left-2 top-1/2 z-50 flex -translate-y-1/2 items-center rounded-lg border border-white/[0.04] bg-[#141416]/90 p-2 backdrop-blur-sm transition-all duration-150 hover:border-white/[0.08] hover:bg-[#18181A] active:scale-95"
      style={{ boxShadow: "0 4px 20px rgba(0,0,0,0.35)" }}
    >
      <PanelLeftOpen className="h-3.5 w-3.5 text-white/40" />
    </motion.button>
  );
}

/* ═══════════════════════════════════════════
   MAIN SIDEBAR
   ═══════════════════════════════════════════ */

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("genvis.sidebar.open") === "1";
  });
  const [isMobile, setIsMobile] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const { data: sessionsData, isLoading: sessionsLoading } = useSessions();
  const sessions = sessionsData?.sessions ?? [];
  const messages = useChatStore((state) => state.messages);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const startDraftSession = useChatStore((state) => state.startDraftSession);
  const selectSession = useChatStore((state) => state.selectSession);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("genvis.sidebar.open", isOpen ? "1" : "0");
    }
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
        };
      })
      .sort((a, b) => {
        const aTime = new Date(sessions.find((s: any) => s.sessionId === a.sessionId)?.updatedAt || 0).getTime();
        const bTime = new Date(sessions.find((s: any) => s.sessionId === b.sessionId)?.updatedAt || 0).getTime();
        return bTime - aTime;
      });
  }, [messages, sessions]);

  const activeDestination = getActiveDestination(pathname);

  const navigateTo = useCallback(
    (destination: SidebarDestination) => {
      const to = destination === "chat" ? "/chat" : `/${destination}`;
      void navigate({ to });
    },
    [navigate]
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches[0].clientX < 20) {
      setTouchStartX(e.touches[0].clientX);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const delta = e.touches[0].clientX - touchStartX;
    if (delta > 50 && !isOpen) {
      setIsOpen(true);
      setTouchStartX(null);
    }
  }, [touchStartX, isOpen]);

  const handleTouchEnd = useCallback(() => {
    setTouchStartX(null);
  }, []);

  const panelProps = {
    activeDestination,
    navigateTo,
    sessionRows,
    activeSessionId,
    selectSession,
    startDraftSession,
    signOut,
    onClose: close,
    isMobile,
    sessionsLoading,
  };

  return (
    <>
      {/* Desktop: push sidebar */}
      {!isMobile && (
        <motion.aside
          className="shrink-0 h-full overflow-hidden"
          initial={false}
          animate={{ width: isOpen ? 240 : 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 35, mass: 0.8 }}
        >
          <SidebarPanel {...panelProps} />
        </motion.aside>
      )}

      {/* Mobile: overlay sidebar */}
      {isMobile && (
        <>
          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[160] bg-black/50 backdrop-blur-sm"
                onClick={close}
              />
            )}
          </AnimatePresence>
          <motion.aside
            className="fixed inset-y-0 left-0 z-[161] h-full"
            initial={false}
            animate={{ x: isOpen ? 0 : -240 }}
            transition={{ type: "spring", stiffness: 400, damping: 35, mass: 0.8 }}
          >
            <SidebarPanel {...panelProps} />
          </motion.aside>
        </>
      )}

      {/* Trigger (when closed) */}
      <AnimatePresence>
        {!isOpen && <SidebarTrigger onClick={open} />}
      </AnimatePresence>

      {/* Mobile swipe catcher */}
      {isMobile && !isOpen && (
        <div
          className="fixed inset-y-0 left-0 z-[100] w-5"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      )}
    </>
  );
}
