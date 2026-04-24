// Compatibility wrapper: legacy imports should resolve to modular pipeline.
import { parseIntentFromQuery } from "./pipeline/intent-classifier.js";
import { isValidationPassable } from "./pipeline/graph.js";
import {
  executeTask,
  generateFromImage,
  generatePostTurnNarration,
  generateThinkingAnalysis,
  generateVisual,
  modifyVisual,
  planTasks,
  resolveChatTurn
} from "./pipeline/index.js";

export { parseIntentFromQuery, isValidationPassable };
export {
  executeTask,
  generateFromImage,
  generatePostTurnNarration,
  generateThinkingAnalysis,
  generateVisual,
  modifyVisual,
  planTasks,
  resolveChatTurn
};
