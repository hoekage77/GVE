/**
 * Orchestrator pipeline types — request/response shapes for the main chat turn flow.
 */

export type QualityTier = "draft" | "standard" | "high";
export type SkillId = "threejs" | "p5js" | "d3js" | "animejs" | "manim" | "auto";

export interface IterationConfig {
  maxIterations: number;
  qualityThreshold: number;
  enableAutoPatch: boolean;
}

export interface ChatTurnRequest {
  sessionId: string;
  query: string;
  quality?: QualityTier;
  skill?: SkillId;
  imageData?: string;
}

export interface ChatTurnResult {
  intent: string;
  reply: string;
  skill?: string;
  outputKind?: string;
  sceneVersion?: import("./session.js").SceneVersion;
  diagnostics?: Record<string, unknown>;
  error?: string;
}

export interface ParsedIntent {
  type: "generate" | "modify" | "conversation" | "greeting" | "help" | "image-to-code";
  confidence: number;
  skill?: SkillId;
  modifyTarget?: string;
  rawQuery: string;
}

export interface GenerateVisualInput {
  query: string;
  skill?: SkillId;
  quality?: QualityTier;
  sessionId?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface ModifyVisualInput {
  query: string;
  existingCode: string;
  skill: string;
  quality?: QualityTier;
  sessionId?: string;
}

export interface CodeGenerationResult {
  code: string;
  skill: string;
  provider: string;
  tokens?: number;
  cached?: boolean;
}

export interface QualityScore {
  overall: number;
  structure: number;
  animation: number;
  lighting: number;
  materials: number;
  complexity: number;
}

export interface IterationResult {
  iteration: number;
  code: string;
  quality: QualityScore;
  passed: boolean;
  patchGoals?: string[];
  durationMs: number;
}

export interface ThinkingStreamOptions {
  onThought?: (thought: string) => void;
  onProgress?: (stage: string, detail?: string) => void;
}
