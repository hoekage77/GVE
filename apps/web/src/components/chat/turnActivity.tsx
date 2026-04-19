import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

export type TurnStatusTone = "idle" | "running" | "completed" | "failed";

const TURN_STEP_LABELS: Record<string, string> = {
  turn_started: "Starting",
  parse_intent: "Parse Intent",
  intent_parsed: "Parse Intent",
  select_skill: "Select Skill",
  skill_selected: "Select Skill",
  plan_created: "Build Prompt",
  build_prompt: "Build Prompt",
  generate_code: "Generate Code",
  code_generated: "Generate Code",
  code_modified: "Generate Code",
  validate_code: "Validate",
  validation_failed: "Validate",
  execute_code: "Execute",
  executing: "Execute",
  execution_skipped: "Execute",
  sync_state: "Sync State",
  turn_complete: "Done",
  turn_error: "Error"
};

export function getTurnStepLabel(step: string | null | undefined): string {
  if (!step) {
    return "Waiting";
  }

  return TURN_STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

export function getTurnTone(status: TurnStatusTone | null | undefined, fallback: TurnStatusTone = "idle"): TurnStatusTone {
  if (status === "idle" || status === "running" || status === "completed" || status === "failed") {
    return status;
  }

  return fallback;
}

export function renderTurnStatusIcon(status: TurnStatusTone, className = "chat-task-status-icon") {
  if (status === "running") {
    return <Loader2 className="h-4 w-4 animate-spin text-amber-400" />;
  }

  if (status === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  }

  if (status === "failed") {
    return <XCircle className="h-4 w-4 text-red-400" />;
  }

  return <Circle className="h-4 w-4 text-slate-400" />;
}

export function formatTaskSummary(completed: number, total: number): string {
  return `Task Progress ${completed}/${total}`;
}
