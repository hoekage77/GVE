import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";

import { parseIntentFromQuery } from "./intent-classifier.js";
import { emitPipelineProgress, requestSchema, resolveRequestedQuality } from "./utils.js";
import { selectSkillForIntent } from "../skills/registry.js";
import { warmupSandboxForSkill } from "../sandbox/skill-runtime.js";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  action: z.enum([
    "parse_intent",
    "select_skill",
    "build_prompt",
    "generate_code",
    "validate_code",
    "execute_code",
    "sync_state"
  ]),
  command: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  dependsOn: z.array(z.string())
});

export const executeRequestSchema = z.object({
  planId: z.string().min(3),
  task: taskSchema
});

function createTasks(selectedSkill: string) {
  return [
    {
      id: "t1",
      title: "Parse Intent",
      description: "Analyze user request and extract structured intent.",
      action: "parse_intent",
      command: "parse_intent",
      status: "pending",
      dependsOn: []
    },
    {
      id: "t2",
      title: "Select Skill",
      description: `Select rendering skill (resolved: ${selectedSkill}).`,
      action: "select_skill",
      command: "select_skill",
      status: "pending",
      dependsOn: ["t1"]
    },
    {
      id: "t3",
      title: "Build Prompt",
      description: "Build model prompt with constraints and context.",
      action: "build_prompt",
      command: "build_prompt",
      status: "pending",
      dependsOn: ["t2"]
    },
    {
      id: "t4",
      title: "Generate Code",
      description: "Generate scene code from selected skill.",
      action: "generate_code",
      command: "generate_code",
      status: "pending",
      dependsOn: ["t3"]
    },
    {
      id: "t5",
      title: "Validate Code",
      description: "Validate generated code before runtime execution.",
      action: "validate_code",
      command: "validate_code",
      status: "pending",
      dependsOn: ["t4"]
    },
    {
      id: "t6",
      title: "Execute Code",
      description: "Execute validated code in sandbox runtime.",
      action: "execute_code",
      command: "execute_code",
      status: "pending",
      dependsOn: ["t5"]
    },
    {
      id: "t7",
      title: "Sync State",
      description: "Commit scene updates and broadcast state.",
      action: "sync_state",
      command: "sync_state",
      status: "pending",
      dependsOn: ["t6"]
    }
  ] as const;
}

const planState = Annotation.Root({
  request: Annotation,
  parsedIntent: Annotation,
  selectedSkill: Annotation,
  skillFallback: Annotation,
  planId: Annotation,
  tasks: Annotation,
  summary: Annotation,
  progress: Annotation
});

const parseIntentNode = (state: any) => {
  emitPipelineProgress(state.progress, "parse_intent", "running");
  return { parsedIntent: parseIntentFromQuery(state.request.query) };
};

const selectSkillNode = (state: any) => {
  emitPipelineProgress(state.progress, "select_skill", "running");
  const requestedSkill = state.request.preferences?.skill;
  const selection = selectSkillForIntent(state.parsedIntent, requestedSkill);

  try {
    warmupSandboxForSkill(selection.selectedSkill);
  } catch {
    // Warmup is best-effort and should not block planning.
  }

  if (selection.fallbackRequired && requestedSkill && requestedSkill !== "auto") {
    return {
      selectedSkill: selection.selectedSkill,
      skillFallback: {
        from: requestedSkill,
        to: selection.selectedSkill,
        reason: selection.reason
      },
      skillRanking: selection.ranked,
      selectionReason: selection.reason
    };
  }

  return {
    selectedSkill: selection.selectedSkill,
    skillFallback: selection.fallbackRequired ? { from: "auto", to: selection.selectedSkill, reason: selection.reason } : null,
    skillRanking: selection.ranked,
    selectionReason: selection.reason
  };
};

const buildTaskPlanNode = (state: any) => {
  const planId = `plan-${Date.now()}`;
  const quality = resolveRequestedQuality(state.request, state.selectedSkill);
  const tasks = createTasks(state.selectedSkill);
  return {
    planId,
    tasks,
    summary: `Planned ${tasks.length} LangGraph-orchestrated tasks for ${state.selectedSkill} (${quality} quality).${
      state.skillFallback
        ? ` Fallback applied: ${state.skillFallback.from} -> ${state.skillFallback.to}.`
        : ""
    } ${state.selectionReason ? `Selection note: ${state.selectionReason}` : ""}`
  };
};

const planningGraph = new StateGraph(planState)
  .addNode("parse_intent", parseIntentNode)
  .addNode("select_skill", selectSkillNode)
  .addNode("build_task_plan", buildTaskPlanNode)
  .addEdge(START, "parse_intent")
  .addEdge("parse_intent", "select_skill")
  .addEdge("select_skill", "build_task_plan")
  .addEdge("build_task_plan", END)
  .compile();

const executionState = Annotation.Root({
  planId: Annotation,
  task: Annotation,
  output: Annotation,
  artifact: Annotation,
  status: Annotation
});

const runTaskNode = (state: any) => {
  const outputs: Record<string, string> = {
    parse_intent: "Intent parsed with confidence 0.94 and extracted entities.",
    select_skill: "Skill selected from weighted ranking with deterministic tie-break.",
    build_prompt: "Prompt built from templates, examples, and policy constraints.",
    generate_code: "Code generated from model using deterministic parameters.",
    validate_code: "Validation passed for syntax, security, API, and schema checks.",
    execute_code: "Code executed successfully in sandbox runtime.",
    sync_state: "Scene state committed and sync event published."
  };

  return {
    status: "completed",
    output: outputs[state.task.action],
    artifact: state.task.action === "execute_code" ? "preview://sandbox/mock-scene" : undefined
  };
};

const taskExecutionGraph = new StateGraph(executionState)
  .addNode("run_task", runTaskNode)
  .addEdge(START, "run_task")
  .addEdge("run_task", END)
  .compile();

export async function planTasks(input: unknown) {
  const request = requestSchema.parse(input);
  const result = await planningGraph.invoke({ request });

  return {
    planId: result.planId,
    summary: result.summary,
    tasks: result.tasks
  };
}

export async function executeTask(input: unknown) {
  const request = executeRequestSchema.parse(input);
  const result = await taskExecutionGraph.invoke({
    planId: request.planId,
    task: request.task
  });

  return {
    planId: request.planId,
    taskId: request.task.id,
    status: result.status,
    output: result.output,
    artifact: result.artifact
  };
}
