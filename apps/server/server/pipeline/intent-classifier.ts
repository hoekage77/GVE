export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function isGreetingQuery(normalizedQuery: string): boolean {
  return /^(hi|hey|hello|yo|sup|hiya|good\s+(morning|afternoon|evening))\b/.test(normalizedQuery);
}

export function isCapabilityQuery(normalizedQuery: string): boolean {
  return /(what can (you|u) do|what do you do|how can you help|help me|what can i do here|what should i ask)/.test(
    normalizedQuery
  );
}

export function isSmallTalkQuery(normalizedQuery: string): boolean {
  return /(thanks|thank you|cool|nice|okay|ok|got it|sounds good|hey there|hello there)/.test(normalizedQuery);
}

export function hasActionIntent(normalizedQuery: string): boolean {
  return /\b(create|make|build|generate|design|draw|sketch|render|animate|modify|change|update|edit|revise|refine|polish|enhance|improve|upgrade|tweak|adjust|add|explain|describe|walkthrough|show|preview)\b/.test(
    normalizedQuery
  );
}

export function hasVisualTopicIntent(normalizedQuery: string): boolean {
  return /\b(scene|visual|image|video|animation|3d|2d|canvas|diagram|chart|graph|data|cube|sphere|particle|color|rotation|spin|orbit|layout|lighting|material|shader|threejs|p5js|d3js|anime|animejs|manim|motion|timeline|tween|easing|equation|formula|latex|math|mermaid|wave|waves|scalar|interference|frequency|resonance|field|fields)\b/.test(
    normalizedQuery
  );
}

export function hasRefinementIntent(normalizedQuery: string): boolean {
  if (/(\bmodify\b|\bchange\b|\bupdate\b|\bedit\b|\brefine\b|\bpolish\b|\benhance\b|\bimprove\b|\bupgrade\b|\btweak\b|\badjust\b|more\s+detail|high\s*quality|premium|cinematic|look\s+better)/.test(normalizedQuery)) {
    return true;
  }

  return /\bmake\b/.test(normalizedQuery) && /(better|cleaner|sharper|richer|deeper|premium)/.test(normalizedQuery);
}

export function hasExplicitEditInstruction(normalizedQuery: string): boolean {
  if (/(\bmodify\b|\bchange\b|\bupdate\b|\bedit\b|\brefine\b|\bpolish\b|\benhance\b|\bimprove\b|\bupgrade\b|\btweak\b|\badjust\b|\brevise\b|\brework\b)/.test(normalizedQuery)) {
    return true;
  }

  if (!/\bmake\b/.test(normalizedQuery)) {
    return false;
  }

  const referencesCurrentScene = /\b(it|this|that|current|existing|same)\b/.test(normalizedQuery);
  const refinementQualifier = /(better|cleaner|sharper|richer|deeper|premium|cinematic|high\s*quality)/.test(normalizedQuery);
  return referencesCurrentScene && refinementQualifier;
}

export function isQuestionQuery(normalizedQuery: string): boolean {
  return /^(what|why|how|who|where|when|can|could|would|should|do|does|did|is|are|tell me|help|what's|whats)\b/.test(
    normalizedQuery
  );
}

export function isConversationQuery(normalizedQuery: string): boolean {
  if (isGreetingQuery(normalizedQuery) || isCapabilityQuery(normalizedQuery) || isSmallTalkQuery(normalizedQuery)) {
    return true;
  }

  if (isQuestionQuery(normalizedQuery) && !hasActionIntent(normalizedQuery)) {
    return true;
  }

  return !hasActionIntent(normalizedQuery) && !hasVisualTopicIntent(normalizedQuery);
}

export function buildConversationHelpText(sessionState: any, query: string, parsedIntent: any): string[] {
  const hasScene = Boolean(sessionState?.currentScene?.sceneId);
  const sceneLabel = hasScene ? `current scene ${sessionState.currentScene.sceneId}` : "no scene yet";
  const queryLabel = query.trim() ? `for “${query.trim()}”` : "for now";

  if (parsedIntent.isGreeting) {
    return [
      `Hi. I can generate a new visual, modify the current one, or explain ${sceneLabel}.`,
      `Try asking me to make something, change a detail, or explain what you already have ${queryLabel}.`,
      hasScene ? `If you want, I can continue from ${sceneLabel} right away.` : "If you do not have a scene yet, I can start one from scratch."
    ];
  }

  if (parsedIntent.isCapabilityQuestion) {
    return [
      "I am a visual generation agent. I can write code to render scenes in 3D (Three.js), 2D (p5.js), animate SVGs/DOM (Anime.js), or generate math animations (Manim).",
      "Tell me what you'd like to see, and I'll generate the JavaScript or Python to build it.",
      hasScene ? `We currently have a scene active. I can edit it if you like.` : "Try something like 'create a glowing cube' or 'animate a bouncing ball'."
    ];
  }

  return [
    `I didn't quite catch a visual instruction in your message.`,
    `I can create a new scene, modify ${sceneLabel}, or explain how the code works.`,
    `How would you like to proceed?`
  ];
}

export function parseIntentFromQuery(query: string): any {
  const normalized = normalizeQuery(query);
  const greeting = isGreetingQuery(normalized);
  const capabilityQuestion = isCapabilityQuery(normalized);
  const smallTalk = isSmallTalkQuery(normalized);
  const conversationQuery = isConversationQuery(normalized);

  let intentType = "create";
  if (/(explain|describe|walkthrough)/.test(normalized)) intentType = "explain";
  if (/(modify|change|update|edit|refine|polish|enhance|improve|upgrade|tweak|adjust)/.test(normalized) || hasRefinementIntent(normalized)) {
    intentType = "modify";
  }
  if (/(create|make|build|generate|design|draw|sketch|render|animation|video)/.test(normalized)) intentType = "create";
  if (/(animate|animation|rotation|spin|orbit|timeline|video|manim)/.test(normalized)) intentType = "animate";
  if (conversationQuery) intentType = "chat";

  const hasStrong3dSignal = /\b(threejs|three\.js|3d|orbit(?:al)?\s+controls?|mesh|geometry|material|shader|volumetric|fog|lighting|emissive|camera|instanc(?:e|ed|ing)|terrain|pbr|catmullrom|vertex)\b/.test(
    normalized
  );
  const hasStrongDataSignal = /\b(data(?:set)?|chart|graph|scatter|histogram|plot|axis|axes|bar\s+chart|line\s+chart)\b/.test(
    normalized
  );
  const hasDiagramSignal = /\b(diagram|flow|sequence|class diagram|mermaid)\b/.test(normalized);
  const hasStrong2dSignal = /\b(2d|canvas|p5(?:js)?|sprite|pixel(?:\s+art)?|sketch|manim|equation|latex|formula|math\s+animation)\b/.test(normalized);
  const hasWeak2dSignal = /\bparticles?\b/.test(normalized);
  const hasAnimationVideoSignal = /\b(video|mp4|timeline|motion|cinematic|storyboard|manim)\b/.test(normalized);

  let targetDomain = "3d";
  if (hasStrongDataSignal) targetDomain = "data-viz";
  if (hasDiagramSignal) targetDomain = "diagram";
  if (hasStrong2dSignal || (hasWeak2dSignal && !hasStrong3dSignal)) targetDomain = "2d";
  if (hasAnimationVideoSignal && !hasStrongDataSignal && !hasDiagramSignal) targetDomain = "animation";
  if (hasStrong3dSignal && !hasStrongDataSignal && !hasDiagramSignal && !hasAnimationVideoSignal) targetDomain = "3d";

  const entities: any[] = [];
  if (/cube/.test(normalized)) entities.push({ kind: "object", name: "cube" });
  if (/sphere|planet|sun/.test(normalized)) entities.push({ kind: "object", name: "sphere" });
  if (/blue|red|green|yellow/.test(normalized)) {
    const color = ["blue", "red", "green", "yellow"].find((c) => normalized.includes(c));
    entities.push({ kind: "color", name: color });
  }
  if (/metallic|pbr/.test(normalized)) entities.push({ kind: "material", name: "metallic" });
  if (/rotate|rotation|spin|orbit/.test(normalized)) entities.push({ kind: "animation", name: "rotation" });
  if (/equation|latex|formula|proof|theorem/.test(normalized)) entities.push({ kind: "equation", name: "math" });
  if (/video|mp4|cinematic|manim/.test(normalized)) entities.push({ kind: "video", name: "render" });

  const constraints: any[] = [];
  if (/real-time|realtime|interactive/.test(normalized)) {
    constraints.push({ name: "rendering", value: "realtime" });
  }
  if (/video|mp4|cinematic|manim|60\s?fps|1080p/.test(normalized)) {
    constraints.push({ name: "output", value: "video" });
  }

  let confidence = query.length > 20 ? 0.9 : 0.72;
  if (hasActionIntent(normalized)) {
    confidence += 0.16;
  }
  if (hasVisualTopicIntent(normalized)) {
    confidence += 0.1;
  }
  if (hasRefinementIntent(normalized)) {
    confidence += 0.05;
  }
  if (isQuestionQuery(normalized) && !hasActionIntent(normalized)) {
    confidence -= 0.18;
  }
  confidence = Math.min(0.99, Math.max(0.05, confidence));
  const ambiguous = confidence < 0.7;
  const conversationalConfidence = conversationQuery ? 0.96 : confidence;
  const conversationalAmbiguous = conversationQuery ? false : ambiguous;

  // Provider routing: DeepSeek V4 Pro for reasoning/explanation, Fireworks Kimi 2.6 for code
  const recommendedProvider =
    intentType === "explain" || intentType === "chat"
      ? "deepseek-v4-pro"
      : intentType === "modify" || intentType === "create" || intentType === "animate"
        ? "fireworks-kimi"
        : null;

  return {
    rawQuery: query,
    intentType,
    targetDomain,
    entities,
    constraints,
    confidence: conversationalConfidence,
    ambiguous: conversationalAmbiguous,
    isGreeting: greeting,
    isCapabilityQuestion: capabilityQuestion,
    isSmallTalk: smallTalk,
    isConversation: conversationQuery,
    recommendedProvider,
    clarificationPrompt: conversationalAmbiguous
      ? "I can generate a new scene, modify the current one, or explain the existing result. Which should I do?"
      : null
  };
}

export function applySessionAwareIntentOverrides(parsedIntent: any, query: string, sessionState: any): any {
  if (!parsedIntent || !query || !sessionState?.currentScene?.code) {
    return parsedIntent;
  }

  const normalized = normalizeQuery(query);
  if (!hasExplicitEditInstruction(normalized)) {
    return parsedIntent;
  }

  return {
    ...parsedIntent,
    intentType: "modify",
    ambiguous: false,
    isConversation: false,
    clarificationPrompt: null
  };
}
