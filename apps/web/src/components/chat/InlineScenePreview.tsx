import { useState } from "react";
import { Maximize2, Code2, Eye, Play, Pause } from "lucide-react";
import SceneViewer from "../SceneViewer";

interface InlineScenePreviewProps {
  code: string;
  skill: string;
  sceneId: string;
  versionId: string;
  onExpand?: () => void;
  onCode?: () => void;
}

export function InlineScenePreview({
  code,
  skill,
  sceneId,
  versionId,
  onExpand,
  onCode,
}: InlineScenePreviewProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="group relative mt-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/40 transition-all duration-500 hover:border-white/[0.12] hover:shadow-[0_0_40px_rgba(0,0,0,0.4)]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Scene Label */}
      <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.4)]" />
          <span className="text-[11px] font-medium text-white/50">
            {sceneId || "Scene Preview"}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/30">
            {skill || "threejs"}
          </span>
        </div>

        {/* Toolbar */}
        <div className={`flex items-center gap-1 transition-opacity duration-300 ${isHovered ? "opacity-100" : "opacity-0"}`}>
          {onCode && (
            <button
              type="button"
              onClick={onCode}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/[0.08] hover:text-white"
              title="View Code"
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/[0.08] hover:text-white"
              title="Open Full Preview"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scene Viewport */}
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        <SceneViewer code={code} skill={skill} />
        
        {/* Expand overlay on hover */}
        <div className={`absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px] transition-opacity duration-300 ${isHovered ? "opacity-100" : "opacity-0"} pointer-events-none`}>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-4 py-2.5 text-sm font-medium text-white/90 backdrop-blur-md transition-all hover:border-white/20 hover:bg-black/60"
            >
              <Maximize2 className="h-4 w-4" />
              Open in Cinema Mode
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
