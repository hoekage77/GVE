import { useEffect, useRef, useCallback } from "react";
import { useChatStore } from "../stores/chat";
import {
  analyzeClientQuality,
  generatePatchGoals,
  shouldStopIteration,
  type ClientQualitySignals
} from "../lib/client-quality-analyzer";

interface UseClientQualityLoopOptions {
  code?: string | null;
  skill?: string | null;
  prompt?: string | null;
  sessionId?: string | null;
  enabled?: boolean;
  maxIterations?: number;
  threshold?: number;
}

const JS_SKILLS = new Set(["threejs", "p5js", "p5.js", "d3js", "d3", "animejs", "anime.js"]);

function isJsSkill(skill: string | null): boolean {
  return skill !== null && JS_SKILLS.has(skill);
}

/**
 * Client-side quality loop hook.
 *
 * Listens for telemetry from SceneViewer, analyzes quality, and if below
 * threshold, requests patches from the server via WebSocket.
 * Also integrates vision-in-the-loop: screenshot analysis produces
 * visual patch goals that are merged with telemetry-based goals.
 *
 * This is the client-side equivalent of QualityLoopRunner.
 */
export function useClientQualityLoop(options: UseClientQualityLoopOptions): {
  quality: ClientQualitySignals | null;
  iteration: number;
  isPatching: boolean;
} {
  const { code, skill, prompt, sessionId, enabled = true, maxIterations = 2, threshold = 75 } = options;
  const qualityRef = useRef<ClientQualitySignals | null>(null);
  const iterationRef = useRef(0);
  const isPatchingRef = useRef(false);
  const pendingPatchRef = useRef(false);

  const ws = useChatStore((state) => (state as any)._ws as WebSocket | null);
  const visualGoals = useChatStore((state) => {
    const sess = state.sessions.find((s: any) => s.sessionId === sessionId);
    return (sess?.visualGoals ?? []) as Array<{ id: string; category: string; severity: string; description: string }>;
  });

  const lastScreenshotHashRef = useRef<string | null>(null);

  const sendPatchRequest = useCallback((quality: ClientQualitySignals, patchGoals: any[], iteration: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId || !skill) return;

    isPatchingRef.current = true;
    pendingPatchRef.current = true;

    ws.send(JSON.stringify({
      type: "client:patch_request",
      payload: {
        sessionId,
        skillId: skill,
        code,
        qualitySignals: quality,
        patchGoals,
        iteration,
        threshold,
        maxIterations
      }
    }));
  }, [ws, sessionId, skill, code, threshold, maxIterations]);

  const sendTelemetry = useCallback((telemetry: any) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId || !skill) return;

    ws.send(JSON.stringify({
      type: "client:validation_result",
      payload: {
        sessionId,
        skillId: skill,
        ...telemetry
      }
    }));
  }, [ws, sessionId, skill]);

  const sendVisionRequest = useCallback((screenshot: { dataUrl: string; hash: string; width: number; height: number }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId || !skill) return;
    if (!code || !prompt) return;

    // Deduplicate: skip if hash matches last sent screenshot
    if (lastScreenshotHashRef.current === screenshot.hash) {
      return;
    }
    lastScreenshotHashRef.current = screenshot.hash;

    ws.send(JSON.stringify({
      type: "client:vision_request",
      payload: {
        sessionId,
        skillId: skill,
        code,
        prompt,
        screenshot: {
          dataUrl: screenshot.dataUrl,
          hash: screenshot.hash,
          width: screenshot.width,
          height: screenshot.height
        }
      }
    }));
  }, [ws, sessionId, skill, code, prompt]);

  useEffect(() => {
    if (!enabled || !sessionId || !skill || !isJsSkill(skill)) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'scene:telemetry_forward') {
        const telemetry = event.data.telemetry;
        // Offload heavy sync work so the message handler returns quickly
        setTimeout(() => {
          if (!code || !prompt) return;

          // Send telemetry to server for global metrics
          sendTelemetry(telemetry);

          // Run quality analysis (CPU-bound regex work)
          const quality = analyzeClientQuality(code, skill, prompt, telemetry);
          qualityRef.current = quality;

          // Defer patch request to another macrotask to keep each callback short
          setTimeout(() => {
            // Merge vision-in-the-loop goals with telemetry-based goals
            const telemetryGoals = generatePatchGoals(quality);
            const mergedGoals = visualGoals.length > 0
              ? [...telemetryGoals, ...visualGoals]
              : telemetryGoals;

            // Check if we should stop or request patches
            const stopDecision = shouldStopIteration(quality.composite, iterationRef.current, maxIterations, threshold);

            if (!stopDecision.shouldStop && !pendingPatchRef.current && mergedGoals.length > 0) {
              iterationRef.current++;
              sendPatchRequest(quality, mergedGoals, iterationRef.current);
            } else if (stopDecision.shouldStop) {
              pendingPatchRef.current = false;
              isPatchingRef.current = false;
            }
          }, 0);
        }, 0);
      }

      if (event.data?.type === 'scene:screenshot_forward') {
        const screenshot = event.data.screenshot;
        if (!screenshot?.dataUrl || !screenshot?.hash) return;
        // Offload large payload serialization so the message handler returns quickly
        setTimeout(() => {
          sendVisionRequest(screenshot);
        }, 0);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [enabled, sessionId, skill, code, prompt, maxIterations, threshold, sendTelemetry, sendPatchRequest, sendVisionRequest, visualGoals]);

  // Listen for patched code from server
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const handleMessage = (event: MessageEvent) => {
      // Note: This is for cross-window communication if needed
      // WebSocket messages are handled by the store
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [enabled, sessionId]);

  return {
    quality: qualityRef.current,
    iteration: iterationRef.current,
    isPatching: isPatchingRef.current
  };
}