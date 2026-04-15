/**
 * ActionBlocks: Structured actions within messages
 * Supports inline task lists, execution steps, thoughts, and insights
 */

export type ActionBlockType = 'task' | 'insight' | 'execution' | 'thought';
export type ActionBlockIcon = 'lightbulb' | 'checkbox' | 'terminal' | 'brain';
export type ActionBlockStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Individual step within an action block
 * Used for execution steps, thought details, task substeps
 */
export interface ActionStep {
  id: string;
  label: string;
  status: ActionBlockStatus;
  timestamp: string;
  detail?: string;
  technicalDetail?: string;
}

/**
 * Action block: A structured unit of work shown inline in messages
 * Can be collapsed/expanded with nested steps
 */
export interface ActionBlock {
  id: string;
  type: ActionBlockType;
  icon: ActionBlockIcon;
  label: string;
  detail?: string;
  status: ActionBlockStatus;
  expandable: boolean;
  expanded?: boolean;
  steps?: ActionStep[];
  progress?: {
    completed: number;
    total: number;
  };
  meta?: {
    duration?: number;
    taskIndex?: number;
  };
}

/**
 * Group of related action blocks
 * Displayed together in a message
 */
export interface ActionBlockGroup {
  id: string;
  messageId: string;
  blocks: ActionBlock[];
}

/**
 * Task checkpoint for the reference panel
 * Represents a milestone in the current turn
 */
export interface TaskCheckpoint {
  id: string;
  label: string;
  description?: string;
  completed: boolean;
  index: number;
  linkedActionBlockId?: string;
  timestamp?: string;
}

/**
 * Current turn context
 * Groups all action blocks and checkpoints for the active generation
 */
export interface TurnContext {
  messageId: string;
  actionBlocks: ActionBlock[];
  checkpoints: TaskCheckpoint[];
  status: ActionBlockStatus;
  startedAt: string;
  completedAt?: string;
}

/**
 * Helper to get icon emoji for action block type
 */
export const ACTION_BLOCK_ICONS: Record<ActionBlockIcon, string> = {
  lightbulb: '💡',
  checkbox: '✓',
  terminal: '⚙️',
  brain: '🧠'
};

/**
 * Helper to get color for status
 */
export const STATUS_COLORS: Record<ActionBlockStatus, string> = {
  pending: '#94a3b8',
  running: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444'
};

/**
 * Helper to determine icon based on status
 */
export const STATUS_ICONS: Record<ActionBlockStatus, string> = {
  pending: '○',
  running: '⟳',
  completed: '✓',
  failed: '✗'
};
