import { useState, type ReactNode } from "react";
import { Maximize2, Layers } from "lucide-react";

export interface InlineArtifactCardProps {
  sceneId: string;
  skill: string;
  onExpand?: () => void;
  children: ReactNode;
  statusDot?: "ready" | "processing" | "error";
}

export function InlineArtifactCard({
  sceneId,
  skill,
  onExpand,
  children,
  statusDot = "ready",
}: InlineArtifactCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const dotColor =
    statusDot === "error"
      ? "bg-red-400/80 shadow-[0_0_6px_rgba(248,113,113,0.4)]"
      : statusDot === "processing"
        ? "bg-amber-400/80 shadow-[0_0_6px_rgba(251,191,36,0.4)]"
        : "bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.4)]";

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        className="group mt-3 flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.04]"
      >
        <div className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-[11px] font-medium text-white/50">{sceneId || "Artifact"}</span>
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
      {/* Content */}
      <div className="relative">
        {children}

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
    </div>
  );
}
