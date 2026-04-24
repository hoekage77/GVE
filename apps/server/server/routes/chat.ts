// Compatibility facade for chat route helpers.
export {
  executeChatTurn,
  normalizeRequestedTurnMode,
  normalizeTurnPreferences
} from "./chat/turn-execution.js";
export { normalizeSceneCommand, executeSceneCommandMutation } from "./chat/scene-commands.js";
export { buildAgentActivity } from "./chat/agent-activity.js";
export { buildTurnLifecyclePayload } from "./chat/turn-summary.js";
