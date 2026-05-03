import { useState, useCallback } from "react";
import {
  Maximize2,
  Code2,
  FileCode,
  FolderGit2,
  GitBranch,
  Play,
  Pause,
  X,
  ChevronDown,
  Layers,
} from "lucide-react";
import SceneViewer from "../SceneViewer";
import WorkspaceFileTree from "../workspace/WorkspaceFileTree";
import WorkspaceFileViewer from "../workspace/WorkspaceFileViewer";
import DiffViewer from "../workspace/DiffViewer";

export type InlineViewerTab = "preview" | "code" | "files" | "diff";

interface InlineScenePreviewProps {
  code: string;
  skill: string;
  sceneId: string;
  versionId: string;
  onExpand?: () => void;
}

const TAB_CONFIG: { id: InlineViewerTab; label: string; icon: React.ReactNode }[] = [
  { id: "preview", label: "Preview", icon: <Play className="h-3 w-3" /> },
  { id: "code", label: "Code", icon: <Code2 className="h-3 w-3" /> },
  { id: "files", label: "Files", icon: <FolderGit2 className="h-3 w-3" /> },
  { id: "diff", label: "Diff", icon: <GitBranch className="h-3 w-3" /> },
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
      className={`relative flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 ${
        active
          ? "text-white"
          : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
      }`}
    >
      {active && (
        <span className="absolute bottom-0 left-1.5 right-1.5 h-[1.5px] rounded-full bg-meta-accent shadow-[0_0_8px_rgba(255,106,61,0.5)]" />
      )}
      {tab.icon}
      <span className="hidden sm:inline">{tab.label}</span>
    </button>
  );
}

function CodeView({ code, skill }: { code: string; skill: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.04] px-3 py-1.5">
        <FileCode className="h-3 w-3 text-white/30" />
        <span className="text-[10px] font-mono text-white/40">scene.{skill === "manim" ? "py" : "js"}</span>
        <span className="ml-auto text-[9px] text-white/20">{code.length.toLocaleString()} chars</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <pre className="p-3 text-[11px] leading-relaxed text-white/60">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export function InlineScenePreview({
  code,
  skill,
  sceneId,
  versionId,
  onExpand,
}: InlineScenePreviewProps) {
  const [activeTab, setActiveTab] = useState<InlineViewerTab>("preview");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleTabChange = useCallback((tab: InlineViewerTab) => {
    setActiveTab(tab);
    if (isCollapsed) setIsCollapsed(false);
  }, [isCollapsed]);

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        className="group mt-3 flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.04]"
      >
        <div className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
        <span className="text-[11px] font-medium text-white/50">{sceneId || "Scene"}</span>
        <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/30">
          {skill}
        </span>
        <span className="ml-auto text-[10px] text-white/20">Click to expand</span>
        <Layers className="h-3 w-3 text-white/20" />
      </button>
    );
  }

  return (
    <div
      className="group relative mt-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-sm transition-all duration-300 hover:border-white/[0.12]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.04] px-2 py-1">
        {/* Left: Status + Tabs */}
        <div className="flex items-center gap-1">
          <div className="mr-2 flex items-center gap-1.5 px-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
            <span className="text-[11px] font-medium text-white/50">
              {sceneId || "Scene Preview"}
            </span>
          </div>

          <div className="flex items-center">
            {TAB_CONFIG.map((tab) => (
              <TabButton
                key={tab.id}
                active={activeTab === tab.id}
                tab={tab}
                onClick={() => handleTabChange(tab.id)}
              />
            ))}
          </div>
        </div>

        {/* Right: Actions */}
        <div className={`flex items-center gap-0.5 transition-opacity duration-200 ${isHovered ? "opacity-100" : "opacity-60"}`}>
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-all hover:bg-white/[0.08] hover:text-white"
            title="Collapse"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/30 transition-all hover:bg-white/[0.08] hover:text-white"
              title="Open Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative">
        {activeTab === "preview" && (
          <div className="relative aspect-[16/10] w-full overflow-hidden">
            <SceneViewer code={code} skill={skill} />

            {/* Hover overlay for expand */}
            <div
              className={`absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] transition-opacity duration-300 ${
                isHovered ? "opacity-100" : "opacity-0"
              } pointer-events-none`}
            >
              {onExpand && (
                <button
                  type="button"
                  onClick={onExpand}
                  className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm font-medium text-white/90 backdrop-blur-md transition-all hover:border-white/20 hover:bg-black/60"
                >
                  <Maximize2 className="h-4 w-4" />
                  Cinema Mode
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === "code" && (
          <div className="aspect-[16/10] w-full">
            <CodeView code={code} skill={skill} />
          </div>
        )}

        {activeTab === "files" && (
          <div className="aspect-[16/10] w-full">
            <div className="flex h-full">
              <div className="w-[200px] shrink-0 border-r border-white/[0.04]">
                <WorkspaceFileTree />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <WorkspaceFileViewer />
              </div>
            </div>
          </div>
        )}

        {activeTab === "diff" && (
          <div className="aspect-[16/10] w-full overflow-hidden">
            <DiffViewer />
          </div>
        )}
      </div>
    </div>
  );
}
