import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chat";
import { runClientValidation, type ClientValidationResult } from "../lib/client-skill-runner";

interface UseClientSkillValidationOptions {
  code?: string | null;
  skill?: string | null;
  sessionId?: string | null;
  enabled?: boolean;
  debounceMs?: number;
}

const JS_SKILLS = new Set(["threejs", "p5js", "p5.js", "d3js", "d3", "animejs", "anime.js"]);

function isJsSkill(skill: string | null): boolean {
  return skill !== null && JS_SKILLS.has(skill);
}

/**
 * Hook that runs client-side skill validation when code/skill changes
 * and sends results back to the server via WebSocket.
 *
 * This enables "edge rendering" — validation happens in the browser
 * using real WebGL/Canvas instead of a mocked Node.js VM on the backend.
 */
export function useClientSkillValidation(options: UseClientSkillValidationOptions): {
  lastResult: ClientValidationResult | null;
} {
  const { code, skill, sessionId, enabled = true, debounceMs = 800 } = options;
  const lastResultRef = useRef<ClientValidationResult | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ws = useChatStore((state) => (state as any)._ws as WebSocket | null);

  useEffect(() => {
    if (!enabled || !code || !skill || !sessionId || !isJsSkill(skill)) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      const sendResult = (result: ClientValidationResult) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "client:validation_result",
            payload: {
              sessionId,
              skillId: skill,
              success: result.success,
              status: result.status,
              durationMs: result.durationMs,
              renderCount: result.renderCount,
              frameCount: result.frameCount,
              logs: result.logs.slice(0, 50), // Limit log size
              summary: result.summary,
              error: result.error,
              frameBudgetReached: result.frameBudgetReached
            }
          }));
        }
      };

      runClientValidation({
        skillId: skill,
        code,
        sessionId,
        onResult: sendResult
      }).then((result) => {
        lastResultRef.current = result;
      }).catch((err) => {
        console.error("[useClientSkillValidation] Validation failed:", err);
      });
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [code, skill, sessionId, enabled, debounceMs, ws]);

  return { lastResult: lastResultRef.current };
}