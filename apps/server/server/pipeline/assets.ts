export interface CuratedAsset {
  id: string;
  url: string;
  note: string;
}

export interface AssetPlan {
  manifestVersion: string;
  skill: string;
  requestedQuality: string;
  strategy: "model-first" | "hybrid" | "runtime-native";
  subjectNeedsModel: boolean;
  categories: string[];
  catalog: Record<string, readonly CuratedAsset[]>;
  curatedCandidates: CuratedAsset[];
  fallbackPolicy: {
    allowInternetFallback: boolean;
    requireFallbackWarning: boolean;
    requireInlineFallbackComment: boolean;
  };
  runtimeHelpers: string[];
}

const MODEL_SUBJECT_PATTERN = /\b(human|person|man|woman|character|avatar|bird|animal|creature|fox|wolf|cat|dog|eagle|owl|parrot|flamingo|stork)\b/i;

const CURATED_THREEJS_ASSETS: Record<string, readonly CuratedAsset[]> = Object.freeze({
  humans: Object.freeze([
    Object.freeze({
      id: "cesium-man",
      url: "https://rawcdn.githack.com/KhronosGroup/glTF-Sample-Models/master/2.0/CesiumMan/glTF-Binary/CesiumMan.glb",
      note: "Neutral standing human model"
    }),
    Object.freeze({
      id: "robot-expressive",
      url: "https://rawcdn.githack.com/mrdoob/three.js/r128/examples/models/gltf/RobotExpressive/RobotExpressive.glb",
      note: "Expressive humanoid fallback"
    })
  ]),
  birds: Object.freeze([
    Object.freeze({
      id: "flamingo",
      url: "https://rawcdn.githack.com/mrdoob/three.js/r128/examples/models/gltf/Flamingo.glb",
      note: "Animated bird model"
    }),
    Object.freeze({
      id: "parrot",
      url: "https://rawcdn.githack.com/mrdoob/three.js/r128/examples/models/gltf/Parrot.glb",
      note: "Animated bird model"
    }),
    Object.freeze({
      id: "stork",
      url: "https://rawcdn.githack.com/mrdoob/three.js/r128/examples/models/gltf/Stork.glb",
      note: "Animated bird model"
    })
  ]),
  animals: Object.freeze([
    Object.freeze({
      id: "fox",
      url: "https://rawcdn.githack.com/mrdoob/three.js/r128/examples/models/gltf/Fox.glb",
      note: "Animated quadruped model"
    })
  ])
});

function normalizeRequestedQuality(value?: string | null): "draft" | "standard" | "high" {
  const normalized = String(value ?? "standard").trim().toLowerCase();
  if (normalized === "draft" || normalized === "standard" || normalized === "high") {
    return normalized as "draft" | "standard" | "high";
  }
  return "standard";
}

function collectSourceText({ sourceText = "", parsedIntent = null }: { sourceText?: string; parsedIntent?: any } = {}): string {
  const parts: string[] = [];

  if (typeof sourceText === "string" && sourceText.trim()) {
    parts.push(sourceText);
  }

  if (typeof parsedIntent?.rawQuery === "string" && parsedIntent.rawQuery.trim()) {
    parts.push(parsedIntent.rawQuery);
  }

  if (Array.isArray(parsedIntent?.entities)) {
    for (const entity of parsedIntent.entities) {
      if (entity && typeof entity.name === "string" && entity.name.trim()) {
        parts.push(entity.name);
      }
    }
  }

  return parts.join(" ").toLowerCase();
}

export function resolveAssetCategories(sourceText?: string | null): string[] {
  const text = String(sourceText ?? "").toLowerCase();
  const categories = new Set<string>();

  if (/(human|person|man|woman|character|avatar|robot)/.test(text)) {
    categories.add("humans");
  }

  if (/(bird|eagle|owl|parrot|flamingo|stork)/.test(text)) {
    categories.add("birds");
  }

  if (/(animal|creature|fox|wolf|dog|cat|mammal)/.test(text)) {
    categories.add("animals");
  }

  if (categories.size === 0) {
    categories.add("humans");
    categories.add("birds");
    categories.add("animals");
  }

  return Array.from(categories);
}

export function resolveAssetPlan({
  selectedSkill,
  sourceText = "",
  parsedIntent = null,
  requestedQuality = "standard",
  allowInternetFallback = true
}: {
  selectedSkill?: string;
  sourceText?: string;
  parsedIntent?: any;
  requestedQuality?: string;
  allowInternetFallback?: boolean;
} = {}): AssetPlan {
  const skill = String(selectedSkill ?? "threejs");
  const quality = normalizeRequestedQuality(requestedQuality);

  if (skill !== "threejs") {
    return {
      manifestVersion: "asset-plan.v1",
      skill,
      requestedQuality: quality,
      strategy: "runtime-native",
      subjectNeedsModel: false,
      categories: [],
      catalog: {},
      curatedCandidates: [],
      fallbackPolicy: {
        allowInternetFallback: false,
        requireFallbackWarning: false,
        requireInlineFallbackComment: false
      },
      runtimeHelpers: []
    };
  }

  const normalizedSourceText = collectSourceText({ sourceText, parsedIntent });
  const categories = resolveAssetCategories(normalizedSourceText);
  const catalog = categories.reduce((accumulator, category) => {
    accumulator[category] = CURATED_THREEJS_ASSETS[category] ?? [];
    return accumulator;
  }, {} as Record<string, readonly CuratedAsset[]>);
  
  const curatedCandidates = categories.flatMap((category) => catalog[category] ?? []);
  const subjectNeedsModel = MODEL_SUBJECT_PATTERN.test(normalizedSourceText);

  return {
    manifestVersion: "asset-plan.v1",
    skill,
    requestedQuality: quality,
    strategy: subjectNeedsModel ? "model-first" : "hybrid",
    subjectNeedsModel,
    categories,
    catalog,
    curatedCandidates,
    fallbackPolicy: {
      allowInternetFallback: allowInternetFallback !== false,
      requireFallbackWarning: true,
      requireInlineFallbackComment: true
    },
    runtimeHelpers: ["createGveGltfLoader", "resolveGveModelCandidates"]
  };
}

export function buildAssetPolicyText(assetPlan?: AssetPlan | null): string {
  if (!assetPlan || assetPlan.skill !== "threejs") {
    return "Use only runtime-native assets and APIs for the selected skill.";
  }

  const qualityLabel = assetPlan.requestedQuality ?? "standard";

  if (assetPlan.strategy === "model-first") {
    return `Model-first policy (${qualityLabel}): load at least one GLTF/GLB subject model (THREE.GLTFLoader or createGveGltfLoader()) from the provided catalog when possible. Avoid box-only proxies for humans/animals/birds. If model load fails, use a procedural fallback and include an inline comment that states the fallback reason.`;
  }

  return `Hybrid asset policy (${qualityLabel}): use curated catalog assets first, then fallback to direct public GLTF/GLB URLs only when needed. Keep background and support geometry procedural for reliability.`;
}

export function buildAssetCatalogText(assetPlan?: AssetPlan | null): string {
  if (!assetPlan || assetPlan.skill !== "threejs") {
    return "N/A for non-Three.js skills.";
  }

  return JSON.stringify({
    usage: "Prefer curated candidates first. If none fit, use a direct GLTF/GLB URL fallback and comment the fallback reason.",
    manifestVersion: assetPlan.manifestVersion,
    strategy: assetPlan.strategy,
    categories: assetPlan.categories,
    assets: assetPlan.catalog,
    fallbackPolicy: assetPlan.fallbackPolicy
  });
}

export function buildQualityContractText(assetPlan?: AssetPlan | null): string {
  if (!assetPlan || assetPlan.skill !== "threejs") {
    return "N/A for non-Three.js skills.";
  }

  const profile = assetPlan.requestedQuality ?? "standard";
  const modelClause = assetPlan.subjectNeedsModel
    ? "Subject fidelity rule: represent people/animals/birds with at least one loaded GLTF/GLB model; do not build the primary subject from multiple BoxGeometry meshes."
    : "Subject fidelity rule: use smooth geometry and avoid visibly low-poly or placeholder-looking primitives in the hero subject.";

  return [
    `Quality tier: ${profile}.`,
    "Renderer rule: set tone mapping and exposure for cinematic contrast.",
    "Lighting rule: include ambient plus directional/key-fill-rim style lighting.",
    "Material rule: use MeshStandardMaterial or MeshPhysicalMaterial for hero assets.",
    "Motion rule: include an intentional animation loop with stable timing.",
    modelClause,
    "Background rule: keep light/neutral readable backgrounds unless the prompt explicitly asks for dark mode."
  ].join(" ");
}

export function getCuratedThreejsAssetCatalog(): Record<string, readonly CuratedAsset[]> {
  return CURATED_THREEJS_ASSETS;
}
