import {
  CURATED_THREEJS_ASSETS,
  MODEL_SUBJECT_PATTERN,
  resolveModelCategories,
  getModelCandidateUrls,
  type CuratedAsset,
} from "@visual-runtime/shared";

export type { CuratedAsset };

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
  return resolveModelCategories(sourceText);
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
    return `Model-first policy (${qualityLabel}): load at least one GLTF/GLB subject model (THREE.GLTFLoader or createGveGltfLoader()) from the provided catalog. Do NOT construct humans, animals, vehicles, or detailed objects from BoxGeometry/CylinderGeometry primitives. If model load fails, use a procedural fallback and include an inline comment stating the fallback reason.`;
  }

  return `Hybrid asset policy (${qualityLabel}): use curated catalog assets first, then fallback to direct GLTF/GLB URLs only when needed. Keep non-subject geometry procedural.`;
}

export function buildAssetCatalogText(assetPlan?: AssetPlan | null): string {
  if (!assetPlan || assetPlan.skill !== "threejs") {
    return "N/A for non-Three.js skills.";
  }

  return JSON.stringify({
    usage: "Prefer curated candidates first. If none fit, find another GLTF/GLB URL and comment the fallback reason.",
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
    ? "Subject fidelity rule: represent people/animals/birds/vehicles with at least one loaded GLTF/GLB model via GLTFLoader; do NOT build the primary subject from BoxGeometry/CylinderGeometry primitives."
    : "Subject fidelity rule: use smooth geometry and avoid visibly low-poly or placeholder-looking primitives in the hero subject.";

  return [
    `Quality tier: ${profile}.`,
    "Renderer rule: set tone mapping and exposure for cinematic contrast.",
    "Lighting rule: include ambient plus directional/key-fill-rim style lighting with shadows.",
    "Material rule: use MeshStandardMaterial or MeshPhysicalMaterial for hero assets.",
    "Motion rule: include an intentional animation loop with stable timing and OrbitControls update.",
    modelClause,
    "Background rule: keep light/neutral readable backgrounds unless the prompt explicitly asks for dark mode.",
    "Env map rule: for high quality, load the environment map texture to provide realistic PBR reflections."
  ].join(" ");
}

export function getCuratedThreejsAssetCatalog(): Record<string, readonly CuratedAsset[]> {
  return CURATED_THREEJS_ASSETS as Record<string, readonly CuratedAsset[]>;
}