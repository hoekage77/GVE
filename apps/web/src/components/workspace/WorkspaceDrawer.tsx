import { motion } from "framer-motion";
import { X, Code2, FolderGit2, GitBranch, Terminal } from "lucide-react";
import { useChatStore } from "../../stores";
import CodeEditor from "../CodeEditor";
import WorkspaceFileTree from "./WorkspaceFileTree";
import WorkspaceFileViewer from "./WorkspaceFileViewer";
import DiffViewer from "./DiffViewer";
import { useState, useCallback } from "react";

type DrawerTab = "code" | "files" | "diff";

const TAB_CONFIG: { id: DrawerTab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "code", label: "Code", icon: <Code2 className="h-4 w-4" />, desc: "Source editor" },
  { id: "files", label: "Files", icon: <FolderGit2 className="h-4 w-4" />, desc: "File tree" },
  { id: "diff", label: "Diff", icon: <GitBranch className="h-4 w-4" />, desc: "Changes" },
];

function TabButton({
  active,
  tab,
  onClick,
}: {
  active: boolean;
  tab: (typeof TAB_CONFIG)[0];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-1 flex-col items-center gap-1 rounded-xl px-3 py-2.5 text-[11px] font-medium transition-all duration-200 ${
        active
          ? "bg-white/[0.06] text-white"
          : "text-white/30 hover:bg-white/[0.03] hover:text-white/60"
      }`}
    >
      <div className={`transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105"}`}>
        {tab.icon}
      </div>
      <span>{tab.label}</span>
      {active && (
        <span className="absolute bottom-0.5 left-1/2 h-[2px] w-6 -translate-x-1/2 rounded-full bg-meta-accent shadow-[0_0_8px_rgba(255,106,61,0.5)]" />
      )}
    </button>
  );
}

export function WorkspaceDrawer() {
  const workspaceOpen = useChatStore((state) => state.workspaceOpen);
  const closeWorkspace = useChatStore((state) => state.closeWorkspace);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const activeArtifactId = useChatStore((state) => state.activeArtifactId);

  const [activeTab, setActiveTab] = useState<DrawerTab>("code");

  const handleTabChange = useCallback((tab: DrawerTab) => {
    setActiveTab(tab);
  }, []);

  if (!workspaceOpen) return null;

  const session = sessions.find((s) => s.sessionId === activeSessionId);
  const artifact = session?.versions?.find((v) => v.versionId === activeArtifactId);
  const activeScene = artifact || session?.currentScene;

  return (
    <motion.div
      initial={false}
      animate={{ width: workspaceOpen ? 520 : 0, opacity: workspaceOpen ? 1 : 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
      className="shrink-0 h-full overflow-hidden border-l border-white/[0.04]"
      style={{ background: "linear-gradient(180deg, #0F0F12 0%, #121216 100%)" }}
    >
      <div className="flex h-full w-[520px] flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3 md:px-5 md:py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.04]">
              <Terminal className="h-4 w-4 text-white/50" />
            </div>
            <div>
              <h3 className="text-[13px] font-semibold tracking-tight text-white/90">
                Workspace
              </h3>
              <p className="text-[10px] text-white/30">
                {activeScene?.sceneId || "No active artifact"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeWorkspace}
            className="group flex h-8 w-8 items-center justify-center rounded-full text-white/40 transition-all hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4 transition-transform group-hover:rotate-90" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 border-b border-white/[0.04] px-3 py-2 md:px-4">
          {TAB_CONFIG.map((tab) => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              tab={tab}
              onClick={() => handleTabChange(tab.id)}
            />
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === "code" && (
            <div className="h-full w-full">
              <CodeEditor
                code={activeScene?.code ?? null}
                skill={activeScene?.skill ?? null}
                readOnly={true}
              />
            </div>
          )}

          {activeTab === "files" && (
            <div className="flex h-full w-full">
              <div className="w-[200px] shrink-0 border-r border-white/5 overflow-hidden">
                <WorkspaceFileTree />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden bg-[#111]">
                <WorkspaceFileViewer />
              </div>
            </div>
          )}

          {activeTab === "diff" && (
            <div className="h-full w-full overflow-hidden">
              <DiffViewer />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
