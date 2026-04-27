import { type GveTaskAction } from '@visual-runtime/shared';
import { type WorkspacePanelView } from './types';


export const WS_RECONNECT_DELAY_MS = 750;
export const WS_OPEN_WAIT_TIMEOUT_MS = 1200;

export const MAX_ACTIVITY_ENTRIES = 120;
export const MAX_STAGE_EVENT_ENTRIES = 40;

export const PIPELINE_ACTION_ORDER: ReadonlyArray<GveTaskAction> = [
  'parse_intent',
  'select_skill',
  'build_prompt',
  'generate_code',
  'validate_code',
  'provision_sandbox',
  'analyze_quality',
  'autonomous_patching',
  'execute_code',
  'sync_state'
];

export const DEFAULT_TASK_DEFINITIONS: ReadonlyArray<{
  id: string;
  title: string;
  description: string;
  action: GveTaskAction;
  command: string;
  dependsOn: string[];
}> = [
  {
    id: 'task-parse-intent',
    title: 'Parse Intent',
    description: 'Extract action, entities, and constraints from user prompt.',
    action: 'parse_intent',
    command: 'parse_intent',
    dependsOn: []
  },
  {
    id: 'task-select-skill',
    title: 'Select Skill',
    description: 'Rank and choose the best visual generation skill.',
    action: 'select_skill',
    command: 'select_skill',
    dependsOn: ['task-parse-intent']
  },
  {
    id: 'task-build-prompt',
    title: 'Build Prompt',
    description: 'Compose structured generation instructions for the model.',
    action: 'build_prompt',
    command: 'build_prompt',
    dependsOn: ['task-select-skill']
  },
  {
    id: 'task-generate-code',
    title: 'Generate Code',
    description: 'Generate executable scene or media source code.',
    action: 'generate_code',
    command: 'generate_code',
    dependsOn: ['task-build-prompt']
  },
  {
    id: 'task-validate-code',
    title: 'Validate Code',
    description: 'Run validation checks for syntax and safety boundaries.',
    action: 'validate_code',
    command: 'validate_code',
    dependsOn: ['task-generate-code']
  },
  {
    id: 'task-provision-sandbox',
    title: 'Provision Sandbox',
    description: 'Acquire dedicated Daytona sandbox environment for runtime execution.',
    action: 'provision_sandbox',
    command: 'provision_sandbox',
    dependsOn: ['task-validate-code']
  },
  {
    id: 'task-analyze-quality',
    title: 'Multi-Agent Review',
    description: 'Trigger autonomous agent team for static and runtime quality analysis.',
    action: 'analyze_quality',
    command: 'analyze_quality',
    dependsOn: ['task-provision-sandbox']
  },
  {
    id: 'task-autonomous-patching',
    title: 'Autonomous Patching',
    description: 'Self-correct codebase iteratively using gathered quality signals.',
    action: 'autonomous_patching',
    command: 'autonomous_patching',
    dependsOn: ['task-analyze-quality']
  },
  {
    id: 'task-execute-code',
    title: 'Execute',
    description: 'Execute runtime workload in sandboxed environment.',
    action: 'execute_code',
    command: 'execute_code',
    dependsOn: ['task-autonomous-patching']
  },
  {
    id: 'task-sync-state',
    title: 'Sync State',
    description: 'Persist runtime output and update session scene state.',
    action: 'sync_state',
    command: 'sync_state',
    dependsOn: ['task-execute-code']
  }
];

export const ORCHESTRATION_STEP_TO_ACTION: Record<string, GveTaskAction> = {
  turn_started: 'parse_intent',
  parse_intent: 'parse_intent',
  intent_parsed: 'parse_intent',
  select_skill: 'select_skill',
  skill_selected: 'select_skill',
  plan_created: 'build_prompt',
  build_prompt: 'build_prompt',
  generate_code: 'generate_code',
  code_generated: 'generate_code',
  code_modified: 'generate_code',
  validate_code: 'validate_code',
  validation_failed: 'validate_code',
  provision_sandbox: 'provision_sandbox',
  'sandbox:creating': 'provision_sandbox',
  analyze_quality: 'analyze_quality',
  'sandbox:analyzing': 'analyze_quality',
  autonomous_patching: 'autonomous_patching',
  'sandbox:patching': 'autonomous_patching',
  execute_code: 'execute_code',
  executing: 'execute_code',
  'sandbox:executing': 'execute_code',
  execution_skipped: 'execute_code',
  sync_state: 'sync_state',
  turn_complete: 'sync_state',
  turn_error: 'sync_state'
};

export const PANEL_WIDTH_RATIO_BY_VIEW: Record<WorkspacePanelView, number> = {
  preview: 0.6,
  code: 0.6,
  files: 0.44,
};
