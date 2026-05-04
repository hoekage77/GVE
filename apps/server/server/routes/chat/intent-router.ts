/**
 * Intent Router — classifies user messages and routes to the appropriate
 * LLM provider: DeepSeek V4 Pro for explanations/reasoning, Kimi 2.6 for
 * code generation and scene creation.
 */

export type TurnIntent =
  | "explain"      // concepts, theory, "why", "how does", "what is"
  | "generate"     // create, build, make, visualize, animate
  | "modify"       // change, update, edit, tweak
  | "debug"        // fix, error, broken, not working
  | "chat";        // general conversation, greetings, misc

const INTENT_PATTERNS: Record<TurnIntent, RegExp[]> = {
  explain: [
    /\b(explain|why|how\s+does|what\s+is|concept|theory|meaning|understand|describe|tell\s+me\s+about)\b/i,
    /\b(difference\s+between|compare|contrast|pros\s+and\s+cons)\b/i,
    /\b(mechanism|principle|fundamental|basics?|intro)\b/i,
  ],
  generate: [
    /\b(create|build|make|generate|visualize|animate|render|draw|design|scene|3d|model|simulation)\b/i,
    /\b(show\s+me|make\s+a|create\s+a|build\s+a)\b/i,
    /\b(animation|visualization|interactive|chart|graph|diagram|plot)\b/i,
  ],
  modify: [
    /\b(change|update|modify|edit|tweak|adjust|refactor|improve|enhance|optimize)\b/i,
    /\b(add|remove|delete|insert|replace|swap|rename)\b/i,
    /\b(make\s+it|can\s+you\s+make|should\s+be|instead\s+of)\b/i,
  ],
  debug: [
    /\b(fix|debug|error|broken|not\s+working|fails?|crash|exception|bug|issue|problem)\b/i,
    /\b(what's\s+wrong|why\s+doesn't|doesn't\s+work|won't|can't)\b/i,
    /\b(stack\s+trace|logs?|traceback|error\s+message)\b/i,
  ],
  chat: [
    /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|howdy)\b/i,
    /\b(thanks?|thank\s+you|appreciate|grateful)\b/i,
    /\b(bye|goodbye|see\s+ya|later|farewell)\b/i,
  ],
};

/**
 * Score each intent and return the best match along with confidence.
 */
export function classifyIntent(content: string): {
  intent: TurnIntent;
  confidence: number;
  scores: Record<TurnIntent, number>;
} {
  const normalized = String(content ?? "").trim().toLowerCase();
  if (!normalized) {
    return { intent: "chat", confidence: 1, scores: { explain: 0, generate: 0, modify: 0, debug: 0, chat: 1 } };
  }

  const scores: Record<TurnIntent, number> = {
    explain: 0,
    generate: 0,
    modify: 0,
    debug: 0,
    chat: 0,
  };

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [TurnIntent, RegExp[]][]) {
    for (const pattern of patterns) {
      const matches = normalized.match(pattern);
      if (matches) {
        // Weight early matches more heavily
        const positionWeight = 1 + Math.max(0, 1 - matches.index! / normalized.length);
        scores[intent] += matches.length * positionWeight;
      }
    }
  }

  // Boost "generate" if message contains scene-related terms even without explicit verbs
  if (/\b(three\.?js|p5\.?js|manim|d3|canvas|webgl|shader|three|babylon|scene)\b/i.test(normalized)) {
    scores.generate += 2;
  }

  // Boost "explain" if message ends with a question mark and has no scene terms
  if (normalized.endsWith("?") && scores.generate < 1) {
    scores.explain += 1.5;
  }

  const entries = Object.entries(scores) as [TurnIntent, number][];
  entries.sort((a, b) => b[1] - a[1]);

  const top = entries[0];
  if (!top) {
    return { intent: "chat", confidence: 1, scores };
  }

  const [topIntent, topScore] = top;
  const second = entries[1];
  const secondScore = second ? second[1] : 0;

  // Confidence: how much the winner dominates
  const total = entries.reduce((sum, [, s]) => sum + s, 0) || 1;
  const confidence = total > 0 ? topScore / total : 0;

  // If top two are close and one is "chat", prefer the more specific intent
  if (topIntent === "chat" && second && secondScore > 0 && topScore - secondScore < 0.5) {
    return { intent: second[0], confidence: 0.6, scores };
  }

  // Default to explain if nothing matches but it's a question
  if (topScore === 0 && normalized.endsWith("?")) {
    return { intent: "explain", confidence: 0.5, scores };
  }

  return { intent: topIntent, confidence, scores };
}

/**
 * Map a classified intent to an LLM provider filter.
 */
export function intentToProviderFilter(intent: TurnIntent): {
  requireReasoning?: boolean;
  requireCodeGeneration?: boolean;
  requireThinking?: boolean;
  preferredProviderId?: string;
} {
  switch (intent) {
    case "explain":
      return {
        requireReasoning: true,
        preferredProviderId: "deepseek-v4-pro",
      };
    case "generate":
      return {
        requireCodeGeneration: true,
        preferredProviderId: "fireworks-kimi",
      };
    case "modify":
      return {
        requireCodeGeneration: true,
        requireThinking: true,
        preferredProviderId: "fireworks-kimi",
      };
    case "debug":
      return {
        requireCodeGeneration: true,
        requireThinking: true,
      };
    default:
      return {
        requireThinking: true,
      };
  }
}
