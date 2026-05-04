export interface CuratedAsset {
  id: string;
  url: string;
  note: string;
}

export const CURATED_THREEJS_ASSETS: Record<string, readonly CuratedAsset[]> = Object.freeze({
  humans: Object.freeze([
    Object.freeze({
      id: "cesium-man",
      url: "/vendor/models/CesiumMan.glb",
      note: "Neutral standing human model"
    }),
    Object.freeze({
      id: "robot-expressive",
      url: "/vendor/models/RobotExpressive.glb",
      note: "Expressive humanoid robot model"
    }),
    Object.freeze({
      id: "brainstem",
      url: "/vendor/models/BrainStem.glb",
      note: "Animated humanoid figure with skeletal animation"
    })
  ]),
  birds: Object.freeze([
    Object.freeze({
      id: "flamingo",
      url: "/vendor/models/Flamingo.glb",
      note: "Animated flamingo bird model"
    }),
    Object.freeze({
      id: "parrot",
      url: "/vendor/models/Parrot.glb",
      note: "Animated parrot bird model"
    }),
    Object.freeze({
      id: "stork",
      url: "/vendor/models/Stork.glb",
      note: "Animated stork bird model"
    })
  ]),
  animals: Object.freeze([
    Object.freeze({
      id: "fox",
      url: "/vendor/models/Fox.glb",
      note: "Animated fox quadruped model"
    }),
    Object.freeze({
      id: "horse",
      url: "/vendor/models/Horse.glb",
      note: "Animated horse model"
    })
  ]),
  vehicles: Object.freeze([
    Object.freeze({
      id: "milk-truck",
      url: "/vendor/models/CesiumMilkTruck.glb",
      note: "Detailed delivery truck model"
    }),
    Object.freeze({
      id: "buggy",
      url: "/vendor/models/Buggy.glb",
      note: "Off-road buggy vehicle model"
    })
  ]),
  objects: Object.freeze([
    Object.freeze({
      id: "damaged-helmet",
      url: "/vendor/models/DamagedHelmet.glb",
      note: "Detailed PBR helmet model with wear textures"
    })
  ])
});

export const MODEL_SUBJECT_PATTERN = /\b(human|person|man|woman|character|avatar|robot|bird|eagle|owl|parrot|flamingo|stork|animal|creature|fox|wolf|cat|dog|horse|car|truck|vehicle|helmet|buggy|brainstem)\b/i;

export function resolveModelCategories(sourceText?: string | null): string[] {
  const text = String(sourceText ?? "").toLowerCase();
  const categories = new Set<string>();

  if (/(human|person|man|woman|character|avatar|robot|brainstem|cesium)/.test(text)) {
    categories.add("humans");
  }

  if (/(bird|eagle|owl|parrot|flamingo|stork)/.test(text)) {
    categories.add("birds");
  }

  if (/(animal|creature|fox|wolf|dog|cat|horse|mammal|quadruped)/.test(text)) {
    categories.add("animals");
  }

  if (/(car|truck|vehicle|buggy|helicopter|ship|boat|bicycle|drone|aircraft)/.test(text)) {
    categories.add("vehicles");
  }

  if (/(helmet|pbr|detailed|weapon|gadget|tool|object|thing)/.test(text)) {
    categories.add("objects");
  }

  if (categories.size === 0) {
    categories.add("humans");
    categories.add("birds");
    categories.add("animals");
    categories.add("vehicles");
    categories.add("objects");
  }

  return Array.from(categories);
}

export function getModelCandidateUrls(subject: string): CuratedAsset[] {
  const text = String(subject || "").toLowerCase();

  if (/bird|eagle|owl|parrot|flamingo|stork/.test(text)) {
    return CURATED_THREEJS_ASSETS.birds as CuratedAsset[];
  }
  if (/human|person|man|woman|character|avatar|robot|brainstem|cesium/.test(text)) {
    return CURATED_THREEJS_ASSETS.humans as CuratedAsset[];
  }
  if (/animal|fox|wolf|cat|dog|horse|creature/.test(text)) {
    return CURATED_THREEJS_ASSETS.animals as CuratedAsset[];
  }
  if (/car|truck|vehicle|buggy/.test(text)) {
    return CURATED_THREEJS_ASSETS.vehicles as CuratedAsset[];
  }
  if (/helmet/.test(text)) {
    return CURATED_THREEJS_ASSETS.objects as CuratedAsset[];
  }

  return [
    ...(CURATED_THREEJS_ASSETS.humans as CuratedAsset[]),
    ...(CURATED_THREEJS_ASSETS.animals as CuratedAsset[]),
    ...(CURATED_THREEJS_ASSETS.birds as CuratedAsset[]),
    ...(CURATED_THREEJS_ASSETS.vehicles as CuratedAsset[]),
    ...(CURATED_THREEJS_ASSETS.objects as CuratedAsset[])
  ] as CuratedAsset[];
}