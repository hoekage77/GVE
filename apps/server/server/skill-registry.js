const skills = [
  {
    id: "threejs",
    name: "Three.js Renderer",
    version: "0.160.0",
    description: "3D scene generation with lighting, materials, and camera controls.",
    domainFocus: ["3d", "animation"],
    capabilities: ["primitive", "material", "lighting", "animation", "camera"],
    executionReliability: 0.94,
    warmPoolAvailability: 0.82,
    safeDefault: true
  },
  {
    id: "p5js",
    name: "p5.js Sketcher",
    version: "1.9.0",
    description: "Expressive 2D motion, sketches, particles, and interactive visuals.",
    domainFocus: ["2d", "animation"],
    capabilities: ["canvas", "drawing", "interaction", "animation", "particles"],
    executionReliability: 0.91,
    warmPoolAvailability: 0.76,
    safeDefault: true
  },
  {
    id: "d3js",
    name: "D3.js Visualizer",
    version: "7.9.0",
    description: "Data-driven charts, diagrams, and structured visual layouts.",
    domainFocus: ["data-viz", "diagram"],
    capabilities: ["scales", "axes", "layout", "binding", "transition"],
    executionReliability: 0.89,
    warmPoolAvailability: 0.72,
    safeDefault: true
  },
  {
    id: "animejs",
    name: "Anime.js Animator",
    version: "3.2.2",
    description: "High-fidelity DOM/SVG motion graphics with timelines and easing choreography.",
    domainFocus: ["animation", "2d", "motion-graphics"],
    capabilities: ["timeline", "easing", "stagger", "svg", "interaction", "animation"],
    executionReliability: 0.9,
    warmPoolAvailability: 0.74,
    safeDefault: true
  }
];

const safeDefaultByDomain = {
  "3d": "threejs",
  "2d": "p5js",
  "data-viz": "d3js",
  diagram: "d3js",
  animation: "animejs"
};

function normalizeIntent(parsedIntent) {
  return {
    intentType: parsedIntent?.intentType ?? "create",
    targetDomain: parsedIntent?.targetDomain ?? "3d",
    entities: Array.isArray(parsedIntent?.entities) ? parsedIntent.entities : [],
    constraints: Array.isArray(parsedIntent?.constraints) ? parsedIntent.constraints : [],
    confidence: typeof parsedIntent?.confidence === "number" ? parsedIntent.confidence : 0.5,
    rawQuery: parsedIntent?.rawQuery ?? ""
  };
}

function getSkills() {
  return skills.map((skill) => ({ ...skill }));
}

function getSkillById(skillId) {
  return skills.find((skill) => skill.id === skillId) ?? null;
}

function safeDefaultForDomain(targetDomain) {
  return safeDefaultByDomain[targetDomain] ?? "threejs";
}

function hasStrong3dSignals(rawQuery) {
  const normalized = String(rawQuery ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(threejs|three\.js|3d|orbit(?:al)?\s+controls?|mesh|geometry|material|shader|volumetric|fog|lighting|emissive|camera|instanc(?:e|ed|ing)|terrain|pbr|catmullrom|vertex)\b/.test(
    normalized
  );
}

function hasStrong2dSignals(rawQuery) {
  const normalized = String(rawQuery ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(2d|canvas|p5(?:js)?|sprite|pixel(?:\s+art)?|sketch)\b/.test(normalized);
}

function hasStrongDataVizSignals(rawQuery) {
  const normalized = String(rawQuery ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(data(?:set)?|chart|graph|scatter|histogram|plot|axis|axes|bar\s+chart|line\s+chart)\b/.test(normalized);
}

function resolveAnchoredTargetDomain(intent) {
  const targetDomain = intent?.targetDomain ?? "3d";
  const rawQuery = intent?.rawQuery ?? "";

  const strong3d = hasStrong3dSignals(rawQuery);
  if (!strong3d) {
    return targetDomain;
  }

  if (targetDomain === "3d") {
    return targetDomain;
  }

  const strong2d = hasStrong2dSignals(rawQuery);
  const strongDataViz = hasStrongDataVizSignals(rawQuery);

  if (targetDomain === "2d" && !strong2d) {
    return "3d";
  }

  if ((targetDomain === "data-viz" || targetDomain === "diagram") && !strongDataViz) {
    return "3d";
  }

  return targetDomain;
}

function domainMatch(skill, intent) {
  if (skill.domainFocus.includes(intent.targetDomain)) {
    return 1;
  }

  if (intent.targetDomain === "animation" && skill.domainFocus.includes("animation")) {
    return 0.9;
  }

  if (intent.targetDomain === "query") {
    return 0.55;
  }

  return 0.2;
}

function capabilityCoverage(skill, intent) {
  const keywordSets = {
    object: ["primitive", "drawing", "layout"],
    color: ["material", "drawing", "binding"],
    material: ["material"],
    animation: ["animation", "transition"],
    camera: ["camera"],
    chart: ["scales", "axes"],
    graph: ["layout", "binding"],
    diagram: ["layout", "binding"],
    data: ["binding", "scales"],
    interaction: ["interaction", "binding"],
    particle: ["particles", "animation"],
    motion: ["timeline", "animation", "stagger"],
    tween: ["timeline", "easing"],
    timeline: ["timeline", "animation"],
    easing: ["easing", "animation"],
    svg: ["svg", "timeline"],
    dom: ["interaction", "timeline"]
  };

  if (intent.entities.length === 0 && intent.constraints.length === 0) {
    return 0.55;
  }

  const signals = [];
  for (const entity of intent.entities) {
    const mappedCapabilities = keywordSets[entity.kind] ?? [];
    signals.push(mappedCapabilities.some((capability) => skill.capabilities.includes(capability)) ? 1 : 0);
  }

  for (const constraint of intent.constraints) {
    const value = String(constraint.value ?? constraint.name ?? "").toLowerCase();
    if (/(realtime|interactive|rendering)/.test(value)) {
      signals.push(skill.capabilities.includes("animation") || skill.capabilities.includes("interaction") ? 1 : 0.5);
    }
  }

  if (signals.length === 0) {
    return 0.5;
  }

  return signals.reduce((total, value) => total + value, 0) / signals.length;
}

function constraintFit(skill, intent) {
  let score = 0.5;

  if (intent.constraints.some((constraint) => /realtime|interactive/.test(String(constraint.value ?? constraint.name ?? "").toLowerCase()))) {
    score += skill.id === "threejs" || skill.id === "p5js" || skill.id === "animejs" ? 0.35 : 0.1;
  }

  if (intent.intentType === "animate") {
    score += skill.capabilities.includes("animation") ? 0.25 : 0;
  }

  if (intent.targetDomain === "diagram" || intent.targetDomain === "data-viz") {
    score += skill.id === "d3js" ? 0.3 : 0.05;
  }

  return Math.min(1, score);
}

function scoreSkill(skill, parsedIntent) {
  const intent = normalizeIntent(parsedIntent);
  return (
    0.45 * domainMatch(skill, intent) +
    0.25 * capabilityCoverage(skill, intent) +
    0.15 * constraintFit(skill, intent) +
    0.1 * skill.executionReliability +
    0.05 * skill.warmPoolAvailability
  );
}

function tieBreak(left, right) {
  const reliabilityDelta = right.skill.executionReliability - left.skill.executionReliability;
  if (Math.abs(reliabilityDelta) > 0.0001) {
    return reliabilityDelta;
  }

  const warmPoolDelta = right.skill.warmPoolAvailability - left.skill.warmPoolAvailability;
  if (Math.abs(warmPoolDelta) > 0.0001) {
    return warmPoolDelta;
  }

  return String(left.skill ?? "").localeCompare(String(right.skill ?? ""));
}

export function rankSkillsForIntent(parsedIntent) {
  const normalizedIntent = normalizeIntent(parsedIntent);
  const anchoredTargetDomain = resolveAnchoredTargetDomain(normalizedIntent);
  const intentForRanking = anchoredTargetDomain === normalizedIntent.targetDomain
    ? normalizedIntent
    : {
        ...normalizedIntent,
        targetDomain: anchoredTargetDomain
      };

  const ranked = skills
    .map((skill) => ({
      skill: skill.id,
      score: Number(scoreSkill(skill, intentForRanking).toFixed(4)),
      skillMeta: skill
    }))
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (Math.abs(scoreDelta) > 0.02) {
        return scoreDelta;
      }

      return tieBreak(left, right);
    });

  const top = ranked[0] ?? null;
  const fallbackRequired = !top || top.score < 0.6;
  const selectedSkill = fallbackRequired
    ? safeDefaultForDomain(intentForRanking.targetDomain)
    : top.skill;

  const anchoringNote = anchoredTargetDomain !== normalizedIntent.targetDomain
    ? ` Domain anchored from ${normalizedIntent.targetDomain} to ${anchoredTargetDomain} due to strong 3D cues.`
    : "";

  const reason = fallbackRequired
    ? `Top score below threshold; using safe default ${selectedSkill}.${anchoringNote}`
    : `Selected ${selectedSkill} from deterministic weighted ranking.${anchoringNote}`;

  return {
    selectedSkill,
    ranked: ranked.map(({ skill, score }) => ({ skill, score })),
    fallbackRequired,
    reason
  };
}

export function selectSkillForIntent(parsedIntent, requestedSkill = "auto") {
  const normalizedIntent = normalizeIntent(parsedIntent);
  const ranking = rankSkillsForIntent(normalizedIntent);

  if (requestedSkill && requestedSkill !== "auto") {
    const requestedExists = skills.some((skill) => skill.id === requestedSkill);
    return {
      selectedSkill: requestedExists ? requestedSkill : ranking.selectedSkill,
      ranked: ranking.ranked,
      fallbackRequired: !requestedExists || ranking.fallbackRequired,
      reason: requestedExists
        ? `Requested skill ${requestedSkill} honored.`
        : ranking.reason
    };
  }

  return ranking;
}

export function getSkillCatalog() {
  return getSkills();
}
