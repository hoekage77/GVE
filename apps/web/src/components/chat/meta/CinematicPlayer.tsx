import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Play,
  Pause,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Compass,
  Grid3X3,
  MessageSquare,
  Info,
  ChevronLeft,
  ChevronRight,
  LayoutPanelTop,
} from "lucide-react";
import { useChatStore } from "../../../stores";
import SceneViewer, { type SceneViewerRef } from "../../SceneViewer";
import MediaViewer from "../../workspace/MediaViewer";
import { useEffect, useState, useRef } from "react";

export function CinematicPlayer() {
  const activeArtifactId = useChatStore((state) => state.activeArtifactId);
  const closeTheaterMode = useChatStore((state) => state.closeTheaterMode);
  const cycleTheaterArtifact = useChatStore((state) => state.cycleTheaterArtifact);
  const selectSceneVersion = useChatStore((state) => state.selectSceneVersion);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const viewerRef = useRef<SceneViewerRef>(null);
  const [isHudVisible, setIsHudVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isOrbitEnabled, setIsOrbitEnabled] = useState(true);
  const [isGridEnabled, setIsGridEnabled] = useState(false);

  // Auto-hide HUD after inactivity
  useEffect(() => {
    if (!activeArtifactId) return;

    let timeout: NodeJS.Timeout;
    const handleMouseMove = () => {
      setIsHudVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setIsHudVisible(false), 3000);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      clearTimeout(timeout);
    };
  }, [activeArtifactId]);

  useEffect(() => {
    if (activeArtifactId) {
      void selectSceneVersion(activeArtifactId);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [activeArtifactId, selectSceneVersion]);

  if (!activeArtifactId) return null;

  const session = sessions.find((s) => s.sessionId === activeSessionId);
  const artifact = session?.versions?.find((v) => v.versionId === activeArtifactId);
  const activeScene = artifact || session?.currentScene;
  const isVideo = activeScene?.outputKind === "media" || activeScene?.skill === "manim";

  return (
    <AnimatePresence>
      {activeArtifactId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-2xl"
        >
          {/* Backdrop Glow */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-[20%] -left-[10%] h-[60%] w-[60%] rounded-full bg-meta-accent/10 blur-[120px]" />
            <div className="absolute -bottom-[20%] -right-[10%] h-[60%] w-[60%] rounded-full bg-fuchsia-500/5 blur-[120px]" />
          </div>

          {/* Top Bar HUD */}
          <motion.div
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: isHudVisible ? 0 : -12, opacity: isHudVisible ? 1 : 0 }}
            transition={{ duration: 0.18 }}
            className="relative z-10 flex items-center justify-between px-4 py-4 md:px-6 md:py-6"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-5 items-center rounded-full bg-meta-accent/20 px-2 text-[10px] font-bold uppercase tracking-widest text-meta-accent">
                  {activeScene?.skill || "Artifact"}
                </span>
                <h2 className="text-base font-medium tracking-tight text-white/90 md:text-xl">
                  {activeScene?.sceneId || "Visual Artifact"}
                </h2>
              </div>
              <p className="text-[10px] text-white/40 font-medium uppercase tracking-wider md:text-xs">
                Version {activeScene?.versionId ? activeScene.versionId.slice(-6) : "v1"} • Cinema Mode
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 rounded-full bg-white/5 p-1 backdrop-blur-md md:gap-2">
                <button
                  onClick={() => cycleTheaterArtifact("prev")}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white md:h-10 md:w-10"
                  title="Previous Version"
                >
                  <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
                </button>
                <div className="h-3 w-px bg-white/10 md:h-4" />
                <button
                  onClick={() => cycleTheaterArtifact("next")}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white md:h-10 md:w-10"
                  title="Next Version"
                >
                  <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
                </button>
              </div>

              <button
                onClick={closeTheaterMode}
                className="group flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/60 backdrop-blur-md transition-all hover:bg-white/10 hover:text-white md:h-12 md:w-12"
              >
                <X className="h-5 w-5 transition-transform group-hover:rotate-90 md:h-6 md:w-6" />
              </button>
            </div>
          </motion.div>

          {/* Main Stage — Preview Only */}
          <motion.div
            layoutId={`artifact-${activeArtifactId}`}
            className="relative flex-1 px-3 pb-20 md:px-12 md:pb-32"
          >
            <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-[0_0_80px_rgba(0,0,0,0.5)]">
              {activeScene ? (
                isVideo ? (
                  <MediaViewer
                    src={activeScene.mediaUrl ?? activeScene.previewUrl ?? null}
                    mediaType={activeScene.mediaType}
                    sceneId={activeScene.sceneId}
                    statusStage="ready"
                  />
                ) : (
                  <SceneViewer
                    ref={viewerRef}
                    code={activeScene.code}
                    skill={activeScene.skill}
                  />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/20">
                  <Info className="h-12 w-12 opacity-20" />
                </div>
              )}
            </div>
          </motion.div>

          {/* Bottom HUD / Controls */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: isHudVisible ? 0 : 12, opacity: isHudVisible ? 1 : 0 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-8 left-1/2 z-20 -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 p-2 backdrop-blur-2xl">
              {!isVideo && (
                <div className="flex items-center gap-1 border-r border-white/5 pr-2">
                  <ControlButton icon={RotateCcw} label="Reset" onClick={() => viewerRef.current?.resetCamera()} />
                  <ControlButton icon={ZoomIn} label="Zoom In" onClick={() => viewerRef.current?.zoomIn()} />
                  <ControlButton icon={ZoomOut} label="Zoom Out" onClick={() => viewerRef.current?.zoomOut()} />
                </div>
              )}

              {!isVideo && (
                <div className="flex items-center gap-1 border-r border-white/5 px-1">
                  <button
                    onClick={() => {
                      viewerRef.current?.togglePlayback();
                      setIsPlaying(!isPlaying);
                    }}
                    className="flex h-9 w-20 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-[12px] font-medium text-white transition-colors hover:bg-white/20 md:h-10 md:w-24 md:gap-2 md:text-[13px]"
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="h-4 w-4 fill-white" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 fill-white" />
                        Play
                      </>
                    )}
                  </button>
                  <ControlButton
                    icon={Compass}
                    label="Orbit"
                    active={isOrbitEnabled}
                    onClick={() => {
                      viewerRef.current?.toggleOrbit();
                      setIsOrbitEnabled(!isOrbitEnabled);
                    }}
                  />
                  <ControlButton
                    icon={Grid3X3}
                    label="Grid"
                    active={isGridEnabled}
                    onClick={() => {
                      viewerRef.current?.toggleGrid();
                      setIsGridEnabled(!isGridEnabled);
                    }}
                  />
                </div>
              )}

              <div className="flex items-center gap-1 pl-1">
                <ControlButton icon={MessageSquare} label="Discuss" onClick={closeTheaterMode} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ControlButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
        active
          ? "bg-meta-accent/20 text-meta-accent"
          : "text-white/50 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
