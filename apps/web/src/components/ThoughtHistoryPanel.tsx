import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import type { SessionMessage } from "@visual-runtime/shared";

type ThoughtHistoryPanelProps = {
  thoughts: SessionMessage[];
};

type ThoughtEntry = {
  step: string;
  message: SessionMessage;
};

type ThoughtTurn = {
  id: string;
  startedAt: string;
  lastAt: string;
  status: "complete" | "error" | "in_progress";
  thoughts: ThoughtEntry[];
};

function formatStepLabel(step: string): string {
  const labels: Record<string, string> = {
    turn_started: "Turn started",
    intent_parsed: "Intent parsed",
    skill_selected: "Skill selected",
    plan_created: "Plan created",
    code_generated: "Code generated",
    validate_code: "Validating",
    validation_failed: "Validation failed",
    executing: "Executing",
    execution_skipped: "Execution skipped",
    sync_state: "Sync state",
    code_modified: "Code modified",
    turn_complete: "Turn complete",
    turn_error: "Turn error"
  };

  return labels[step] ?? step.replace(/_/g, " ");
}

function formatThoughtTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return value;
  }
}

function normalizeStep(message: SessionMessage): string {
  return message.meta?.[0] ?? message.kind ?? "thought";
}

function buildThoughtTurns(thoughts: SessionMessage[]): ThoughtTurn[] {
  const turns: ThoughtTurn[] = [];
  let current: ThoughtTurn | null = null;
  let turnCounter = 0;

  for (const message of thoughts) {
    const step = normalizeStep(message);
    const startsTurn = step === "turn_started";

    if (!current || startsTurn) {
      turnCounter += 1;
      current = {
        id: `turn-${turnCounter}-${message.id}`,
        startedAt: message.createdAt,
        lastAt: message.createdAt,
        status: "in_progress",
        thoughts: []
      };
      turns.push(current);
    }

    current.thoughts.push({
      step,
      message
    });
    current.lastAt = message.createdAt;

    if (step === "turn_complete") {
      current.status = "complete";
      current = null;
      continue;
    }

    if (step === "turn_error") {
      current.status = "error";
      current = null;
    }
  }

  return turns.reverse();
}

function formatTurnTitle(index: number, total: number): string {
  return `Turn ${total - index}`;
}

function formatStatusLabel(status: ThoughtTurn["status"]): string {
  if (status === "complete") {
    return "completed";
  }

  if (status === "error") {
    return "failed";
  }

  return "in progress";
}

export default function ThoughtHistoryPanel({ thoughts }: ThoughtHistoryPanelProps) {
  const turns = useMemo(() => buildThoughtTurns(thoughts), [thoughts]);
  const [openTurnId, setOpenTurnId] = useState<string | null>(null);

  useEffect(() => {
    if (turns.length === 0) {
      setOpenTurnId(null);
      return;
    }

    setOpenTurnId((current) => {
      if (current && turns.some((turn) => turn.id === current)) {
        return current;
      }

      return turns[0]?.id ?? null;
    });
  }, [turns]);

  if (thoughts.length === 0) {
    return null;
  }

  return (
    <section aria-label="Thought history">
      <details className="rounded-2xl border border-black/10 bg-white/90 p-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/70 [&::-webkit-details-marker]:hidden">
          <Sparkles className="h-3.5 w-3.5 text-black/65" />
          <span>Agent thought process</span>
          <span className="ml-auto rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-black/70">
            {turns.length} turns · {thoughts.length} steps
          </span>
        </summary>

        <div className="mt-2 grid gap-2" role="list">
          {turns.map((turn, index) => {
            const isOpen = openTurnId === turn.id;

            return (
              <article key={turn.id} className="rounded-xl border border-black/10 bg-white/95" role="listitem">
                <button
                  type="button"
                  className="grid w-full grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-xl px-3 py-2 text-left"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpenTurnId((current) => (current === turn.id ? null : turn.id));
                  }}
                >
                  <span className="text-xs font-semibold text-black/85">{formatTurnTitle(index, turns.length)}</span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
                      turn.status === "complete"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : turn.status === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-black/15 bg-black/5 text-black/70"
                    }`}
                  >
                    {formatStatusLabel(turn.status)}
                  </span>
                  <span className="text-[11px] text-black/55">{formatThoughtTime(turn.startedAt)} - {formatThoughtTime(turn.lastAt)}</span>
                  <span className="justify-self-end text-[11px] text-black/55">{turn.thoughts.length} steps</span>
                </button>

                {isOpen && (
                  <div className="grid gap-2 border-t border-black/10 px-3 py-2">
                    {turn.thoughts.map((entry) => (
                      <article key={entry.message.id} className="rounded-lg border-l-2 border-black/25 bg-black/[0.02] px-2.5 py-2">
                        <p className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-black/55">
                          <span>{formatStepLabel(entry.step)}</span>
                          <span>{formatThoughtTime(entry.message.createdAt)}</span>
                        </p>
                        <p className="m-0 text-[12px] leading-relaxed text-black/75">{entry.message.content}</p>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </details>
    </section>
  );
}
