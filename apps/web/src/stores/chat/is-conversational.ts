/**
 * Lightweight client-side heuristic to detect conversational messages.
 *
 * Mirrors the backend intent classifier's isConversationQuery logic so the
 * frontend can skip the pipeline progress UI optimistically for chat messages
 * without waiting for the server round-trip.
 */

const GREETING_RE = /^(hi|hey|hello|yo|sup|hiya|good\s+(morning|afternoon|evening))\b/;
const CAPABILITY_RE = /(what can (you|u) do|what do you do|how can you help|help me|what can i do here|what should i ask)/;
const SMALL_TALK_RE = /(thanks|thank you|cool|nice|okay|ok|got it|sounds good|hey there|hello there)/;
const QUESTION_RE = /^(what|why|how|who|where|when|can|could|would|should|do|does|did|is|are|tell me|help|what's|whats)\b/;
const ACTION_RE = /\b(create|make|build|generate|design|draw|sketch|render|animate|modify|change|update|edit|revise|refine|polish|enhance|improve|upgrade|tweak|adjust|add|explain|describe|walkthrough|show|preview)\b/;
const VISUAL_TOPIC_RE = /\b(scene|visual|image|video|animation|3d|2d|canvas|diagram|chart|graph|data|cube|sphere|particle|color|rotation|spin|orbit|layout|lighting|material|shader|threejs|p5js|d3js|anime|animejs|manim|motion|timeline|tween|easing|equation|formula|latex|math|mermaid|wave|waves)\b/;

function hasActionIntent(normalized: string): boolean {
  return ACTION_RE.test(normalized);
}

function hasVisualTopicIntent(normalized: string): boolean {
  return VISUAL_TOPIC_RE.test(normalized);
}

/**
 * Returns true if the message looks conversational (greeting, question, small talk)
 * and should NOT trigger the full 7-stage pipeline UI.
 */
export function isConversationalMessage(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return true;

  // Greetings, capability questions, and small talk are always conversational.
  if (GREETING_RE.test(normalized)) return true;
  if (CAPABILITY_RE.test(normalized)) return true;
  if (SMALL_TALK_RE.test(normalized)) return true;

  // Questions without action verbs are conversational.
  if (QUESTION_RE.test(normalized) && !hasActionIntent(normalized)) return true;

  // No action verb and no visual topic = conversational.
  if (!hasActionIntent(normalized) && !hasVisualTopicIntent(normalized)) return true;

  return false;
}
