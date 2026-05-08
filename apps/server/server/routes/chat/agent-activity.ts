export type AgentActivityInput = {
  sessionId: string;
  messageId: string;
  step: string;
  status?: "running" | "completed" | "failed" | "streaming";
  payload?: Record<string, unknown>;
};

function mapAgentActivityText(step: string, status: "running" | "completed" | "failed" | "streaming", payload: Record<string, unknown> = {}): string {
  const runningTexts: Record<string, string> = {
    parse_intent: "I am understanding your request and extracting intent.",
    select_skill: "I am selecting the best rendering skill for this scene.",
    build_prompt: "I am composing the generation prompt and constraints.",
    generate_code: "I am writing executable scene code.",
    validate_code: "I am validating the generated code for safety and correctness.",
    execute_code: "I am executing the scene in the sandbox runtime.",
    sync_state: "I am syncing the latest scene state to this session.",
    intent_parsed: "I parsed your intent and generated a plan."
  };

  const completedTexts: Record<string, string> = {
    parse_intent: "I finished parsing your intent.",
    select_skill: "I selected the rendering skill.",
    build_prompt: "I finished building the prompt.",
    generate_code: "I finished code generation.",
    validate_code: "Validation completed successfully.",
    execute_code: "Execution completed successfully.",
    sync_state: "State sync completed.",
    turn_complete: "Your request completed successfully."
  };

  const failedTexts: Record<string, string> = {
    validate_code: "I found validation issues in the generated code.",
    execute_code: "I hit an execution issue in the sandbox.",
    sync_state: "I could not sync the latest state.",
    turn_error: "I could not complete this turn due to an error."
  };

  const technicalError = payload?.error ? ` ${String(payload.error)}` : "";
  if (status === "failed") {
    return `${failedTexts[step] ?? "I encountered an error during this step."}${technicalError}`.trim();
  }
  if (status === "completed") {
    return completedTexts[step] ?? "I completed this step.";
  }
  if (status === "streaming") {
    return "I am generating code in real-time...";
  }
  return runningTexts[step] ?? "I am processing this request.";
}

export function buildAgentActivity({ sessionId, messageId, step, status = "running", payload = {} }: AgentActivityInput) {
  const tone = status === "failed" ? "error" : status === "completed" ? "success" : "progress";
  return {
    id: `activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sessionId,
    messageId,
    step,
    status,
    tone,
    text: mapAgentActivityText(step, status, payload),
    technicalDetail: payload?.error ? String(payload.error) : null,
    createdAt: new Date().toISOString()
  };
}
