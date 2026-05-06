import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "../stores";
import {
  Play,
  Square,
  RotateCcw,
  PanelLeft,
  LayoutPanelTop,
  Monitor,
  ChevronRight,
  Check,
  X,
  AlertCircle,
} from "lucide-react";

/* ─── Animation Test Suite ─── */

interface TestResult {
  name: string;
  status: "idle" | "running" | "pass" | "fail";
  duration?: number;
  error?: string;
}

function useAnimationTest(name: string, action: () => void, check: () => boolean, cleanup?: () => void): TestResult & { run: () => Promise<void> } {
  const [result, setResult] = useState<TestResult>({ name, status: "idle" });

  const run = useCallback(async () => {
    setResult({ name, status: "running" });
    const start = performance.now();
    try {
      action();
      // Wait for animation frame + spring settle (Framer Motion springs ~300-500ms)
      await new Promise((r) => setTimeout(r, 600));
      const ok = check();
      const duration = Math.round(performance.now() - start);
      if (ok) {
        setResult({ name, status: "pass", duration });
      } else {
        setResult({ name, status: "fail", duration, error: "State mismatch after animation" });
      }
    } catch (err) {
      setResult({ name, status: "fail", error: String(err) });
    } finally {
      cleanup?.();
    }
  }, [name, action, check, cleanup]);

  return { ...result, run };
}

export default function AnimationTestPage() {
  const [manualSidebar, setManualSidebar] = useState(false);
  const [manualWorkspace, setManualWorkspace] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  /* ─── Store actions ─── */
  const openWorkspace = useChatStore((s) => s.openWorkspace);
  const closeWorkspace = useChatStore((s) => s.closeWorkspace);
  const workspaceOpen = useChatStore((s) => s.workspaceOpen);
  const openTheaterMode = useChatStore((s) => s.openTheaterMode);
  const closeTheaterMode = useChatStore((s) => s.closeTheaterMode);
  const activeArtifactId = useChatStore((s) => s.activeArtifactId);
  const setComposerValue = useChatStore((s) => s.setComposerValue);

  /* ─── Automated Tests ─── */

  const t1 = useAnimationTest(
    "Sidebar Spring (0→240px)",
    () => setManualSidebar(true),
    () => {
      const sidebar = document.querySelector("aside");
      const width = sidebar?.getBoundingClientRect().width ?? 0;
      return width >= 230;
    },
    () => setManualSidebar(false)
  );

  const t2 = useAnimationTest(
    "Workspace Drawer Spring (0→520px)",
    () => { setManualSidebar(false); openWorkspace(); },
    () => workspaceOpen,
    () => closeWorkspace()
  );

  const t3 = useAnimationTest(
    "Cinematic Player Overlay",
    () => openTheaterMode("test-artifact-123"),
    () => activeArtifactId === "test-artifact-123",
    () => closeTheaterMode()
  );

  const t4 = useAnimationTest(
    "Composer State Update",
    () => setComposerValue("Hello animation test"),
    () => useChatStore.getState().composerValue === "Hello animation test",
    () => setComposerValue("")
  );

  const runAll = useCallback(async () => {
    log("Starting automated animation suite...");
    await t1.run();
    log(`Sidebar: ${t1.status}${t1.duration ? ` (${t1.duration}ms)` : ""}`);
    await new Promise((r) => setTimeout(r, 400));

    await t2.run();
    log(`Workspace: ${t2.status}${t2.duration ? ` (${t2.duration}ms)` : ""}`);
    await new Promise((r) => setTimeout(r, 400));

    await t3.run();
    log(`Cinematic: ${t3.status}${t3.duration ? ` (${t3.duration}ms)` : ""}`);
    await new Promise((r) => setTimeout(r, 400));

    await t4.run();
    log(`Composer: ${t4.status}${t4.duration ? ` (${t4.duration}ms)` : ""}`);
    log("Suite complete.");
  }, [t1, t2, t3, t4, log]);

  /* ─── Manual visual tests ─── */

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0a0a0c] text-white/90">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.04] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-white/5">
            <Play className="h-3 w-3 text-emerald-400" />
          </div>
          <h1 className="text-sm font-semibold tracking-tight">Animation Test Suite</h1>
        </div>
        <button
          onClick={runAll}
          className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.1]"
        >
          <RotateCcw className="h-3 w-3" />
          Run All
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: Tests */}
        <div className="flex w-[420px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/[0.04] p-4">
          {/* Automated Tests */}
          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/30">Automated</h2>
            <div className="flex flex-col gap-1.5">
              <TestRow result={t1} onRun={t1.run} />
              <TestRow result={t2} onRun={t2.run} />
              <TestRow result={t3} onRun={t3.run} />
              <TestRow result={t4} onRun={t4.run} />
            </div>
          </section>

          {/* Manual Controls */}
          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/30">Manual Controls</h2>
            <div className="flex flex-col gap-1.5">
              <ManualButton
                active={manualSidebar}
                onClick={() => { setManualSidebar((p) => !p); log(manualSidebar ? "Sidebar closed" : "Sidebar opened"); }}
                icon={<PanelLeft className="h-3.5 w-3.5" />}
                label="Toggle Sidebar"
                desc="Spring width 0↔240px"
              />
              <ManualButton
                active={manualWorkspace}
                onClick={() => {
                  if (manualWorkspace) { closeWorkspace(); setManualWorkspace(false); log("Workspace closed"); }
                  else { openWorkspace(); setManualWorkspace(true); log("Workspace opened"); }
                }}
                icon={<LayoutPanelTop className="h-3.5 w-3.5" />}
                label="Toggle Workspace"
                desc="Spring width 0↔520px"
              />
              <ManualButton
                active={!!activeArtifactId}
                onClick={() => {
                  if (activeArtifactId) { closeTheaterMode(); log("Cinematic closed"); }
                  else { openTheaterMode("test-anim-123"); log("Cinematic opened"); }
                }}
                icon={<Monitor className="h-3.5 w-3.5" />}
                label="Toggle Cinematic"
                desc="Opacity + scale overlay"
              />
            </div>
          </section>

          {/* Live Spring Demo */}
          <section>
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-white/30">Spring Visualizer</h2>
            <SpringDemo />
          </section>
        </div>

        {/* Right: Preview + Logs */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Preview Area */}
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-[#08080a]">
            <p className="absolute top-3 left-3 text-[10px] text-white/20">Preview Canvas</p>

            {/* Simulated Sidebar */}
            <AnimatePresence>
              {manualSidebar && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: 240 }}
                  exit={{ width: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 35, mass: 0.8 }}
                  className="absolute inset-y-0 left-0 z-20 flex flex-col border-r border-white/[0.04] bg-[#111113]"
                >
                  <div className="p-3 text-[10px] text-white/30">Sidebar (240px)</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Simulated Workspace */}
            <AnimatePresence>
              {manualWorkspace && (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: 320 }}
                  exit={{ width: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.9 }}
                  className="absolute inset-y-0 right-0 z-20 flex flex-col border-l border-white/[0.04] bg-[#0c0c0f]"
                >
                  <div className="p-3 text-[10px] text-white/30">Workspace (320px)</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Simulated Cinematic */}
            <AnimatePresence>
              {activeArtifactId && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-30 flex items-center justify-center bg-black/90"
                >
                  <motion.div
                    initial={{ scale: 0.92 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.92 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className="h-48 w-72 rounded-xl border border-white/10 bg-[#111]"
                  >
                    <div className="flex h-full items-center justify-center text-xs text-white/30">
                      Cinematic Overlay
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="text-center">
              <p className="mb-1 text-xs text-white/40">Use manual controls to test animations</p>
              <p className="text-[10px] text-white/20">All springs use Framer Motion physics</p>
            </div>
          </div>

          {/* Logs */}
          <div className="h-40 shrink-0 border-t border-white/[0.04] bg-[#0a0a0c]">
            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/25">Event Log</span>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] text-white/25 transition-colors hover:text-white/50"
              >
                Clear
              </button>
            </div>
            <div className="scrollbar h-[calc(100%-28px)] overflow-y-auto px-3 pb-2">
              {logs.length === 0 ? (
                <p className="py-2 text-[10px] text-white/15">No events yet. Run tests or toggle controls.</p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {logs.map((log, i) => (
                    <div key={i} className="text-[11px] text-white/40 font-mono">{log}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Subcomponents ─── */

function TestRow({ result, onRun }: { result: TestResult; onRun: () => Promise<void> }) {
  const icon =
    result.status === "pass" ? <Check className="h-3 w-3 text-emerald-400" /> :
    result.status === "fail" ? <AlertCircle className="h-3 w-3 text-red-400" /> :
    result.status === "running" ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="h-3 w-3 rounded-full border border-white/20 border-t-white/60" /> :
    <ChevronRight className="h-3 w-3 text-white/20" />;

  return (
    <button
      onClick={onRun}
      disabled={result.status === "running"}
      className="flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-all hover:border-white/[0.04] hover:bg-white/[0.02] disabled:opacity-60"
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] text-white/80">{result.name}</span>
        {result.error && <span className="text-[10px] text-red-400/80">{result.error}</span>}
        {result.duration && <span className="text-[10px] text-white/25">{result.duration}ms</span>}
      </div>
    </button>
  );
}

function ManualButton({ active, onClick, icon, label, desc }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-all ${
        active
          ? "border-white/[0.06] bg-white/[0.04]"
          : "border-transparent hover:border-white/[0.04] hover:bg-white/[0.02]"
      }`}
    >
      <span className={`flex shrink-0 ${active ? "text-white/70" : "text-white/35"}`}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[12px] text-white/80">{label}</span>
        <span className="text-[10px] text-white/30">{desc}</span>
      </div>
      <div className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${active ? "bg-emerald-400" : "bg-white/10"}`} />
    </button>
  );
}

function SpringDemo() {
  const [target, setTarget] = useState(0);
  const configs = [
    { label: "Sidebar", stiffness: 400, damping: 35, mass: 0.8 },
    { label: "Workspace", stiffness: 380, damping: 32, mass: 0.9 },
    { label: "Snappy", stiffness: 500, damping: 25, mass: 0.6 },
    { label: "Soft", stiffness: 200, damping: 20, mass: 1.2 },
  ];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/[0.04] bg-white/[0.015] p-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-white/30">Target:</span>
        <button onClick={() => setTarget(0)} className={`rounded px-1.5 py-0.5 text-[10px] ${target === 0 ? "bg-white/10 text-white/70" : "text-white/30 hover:bg-white/5"}`}>0px</button>
        <button onClick={() => setTarget(200)} className={`rounded px-1.5 py-0.5 text-[10px] ${target === 200 ? "bg-white/10 text-white/70" : "text-white/30 hover:bg-white/5"}`}>200px</button>
      </div>
      <div className="flex flex-col gap-1.5">
        {configs.map((c) => (
          <div key={c.label} className="flex items-center gap-2">
            <span className="w-16 text-[10px] text-white/40">{c.label}</span>
            <div className="relative h-5 flex-1 rounded bg-white/[0.03]">
              <motion.div
                className="absolute inset-y-0 left-0 rounded bg-emerald-500/30"
                animate={{ width: target }}
                transition={{ type: "spring", ...c }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
