const skillRuntimeProfiles = {
  threejs: {
    id: "threejs",
    name: "Three.js Renderer",
    runtime: {
      adapter: "mock-threejs",
      timeoutMs: 2200,
      maxFrames: 48
    },
    dependencies: ["three"],
    bootstrapScript: [
      "console.log('Loading Three.js runtime');",
      "globalThis.skillRuntime = { kind: 'threejs' };"
    ].join("\n"),
    templates: {
      sceneBootstrap:
        "const scene = globalThis.scene; const camera = globalThis.camera; const renderer = globalThis.renderer;"
    }
  },
  p5js: {
    id: "p5js",
    name: "p5.js Sketcher",
    runtime: {
      adapter: "mock-p5js",
      timeoutMs: 1800,
      maxFrames: 60
    },
    dependencies: ["p5"],
    bootstrapScript: [
      "console.log('Loading p5.js runtime');",
      "globalThis.skillRuntime = { kind: 'p5js' };"
    ].join("\n"),
    templates: {
      sceneBootstrap: "const canvas = createCanvas(width, height);"
    }
  },
  d3js: {
    id: "d3js",
    name: "D3.js Visualizer",
    runtime: {
      adapter: "mock-d3js",
      timeoutMs: 1800,
      maxFrames: 40
    },
    dependencies: ["d3"],
    bootstrapScript: [
      "console.log('Loading D3.js runtime');",
      "globalThis.skillRuntime = { kind: 'd3js' };"
    ].join("\n"),
    templates: {
      sceneBootstrap: "const svg = d3.select(document.body).append('svg');"
    }
  },
  animejs: {
    id: "animejs",
    name: "Anime.js Animator",
    runtime: {
      adapter: "mock-animejs",
      timeoutMs: 1800,
      maxFrames: 60
    },
    dependencies: ["animejs"],
    bootstrapScript: [
      "console.log('Loading Anime.js runtime');",
      "globalThis.skillRuntime = { kind: 'animejs' };"
    ].join("\n"),
    templates: {
      sceneBootstrap: "const stage = document.getElementById('stage') || document.body;"
    }
  }
};

function cloneSkillRuntimeProfile(profile) {
  return {
    ...profile,
    dependencies: [...profile.dependencies],
    runtime: { ...profile.runtime },
    templates: { ...profile.templates }
  };
}

export function getSkillRuntimeProfile(skillId) {
  return cloneSkillRuntimeProfile(skillRuntimeProfiles[skillId] ?? skillRuntimeProfiles.threejs);
}

export function listSkillRuntimeProfiles() {
  return Object.values(skillRuntimeProfiles).map(cloneSkillRuntimeProfile);
}
