import assert from "node:assert/strict";
import { parseIntentFromQuery, isValidationPassable } from "../server/orchestrator.js";
import { rankSkillsForIntent } from "../server/skill-registry.js";

const startedAt = Date.now();
const checks = [];

function runCheck(name, fn) {
  try {
    fn();
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({
      name,
      pass: false,
      message: error?.message ?? String(error)
    });
  }
}

runCheck("parse_intent_keeps_3d_with_particles", () => {
  const parsed = parseIntentFromQuery(
    "Create a 3d scene with volumetric fog, mesh particles, and orbit controls."
  );

  assert.equal(parsed.targetDomain, "3d");
});

runCheck("parse_intent_detects_data_viz", () => {
  const parsed = parseIntentFromQuery(
    "Build a chart from a dataset with axes and bars."
  );

  assert.equal(parsed.targetDomain, "data-viz");
});

runCheck("parse_intent_prefers_animation_for_video_prompt_with_camera_cues", () => {
  const parsed = parseIntentFromQuery(
    "Create a cinematic video with a moving camera around a rotating cube."
  );

  assert.equal(parsed.targetDomain, "animation");
  assert.equal(parsed.intentType, "animate");
});

runCheck("ranking_anchors_weak_2d_to_3d", () => {
  const ranking = rankSkillsForIntent({
    intentType: "create",
    targetDomain: "2d",
    entities: [],
    constraints: [],
    confidence: 0.92,
    rawQuery: "Build a 3d terrain with mesh instances, volumetric fog, and particles."
  });

  assert.equal(ranking.selectedSkill, "threejs");
  assert.match(ranking.reason, /Domain anchored/);
});

runCheck("ranking_prefers_manim_for_video_generation", () => {
  const parsed = parseIntentFromQuery(
    "Create a cinematic video with a moving camera around a rotating cube."
  );
  const ranking = rankSkillsForIntent(parsed);

  assert.equal(ranking.selectedSkill, "manim");
});

runCheck("validation_passable_preferred_over_valid", () => {
  assert.equal(isValidationPassable({ valid: false, passable: true }), true);
});

runCheck("validation_falls_back_to_valid_when_passable_missing", () => {
  assert.equal(isValidationPassable({ valid: true }), true);
});

runCheck("validation_respects_explicit_not_passable", () => {
  assert.equal(isValidationPassable({ valid: true, passable: false }), false);
});

const passed = checks.filter((check) => check.pass).length;
const failed = checks.length - passed;

const output = {
  service: "orchestrator-routing",
  testType: "regression",
  elapsedMs: Date.now() - startedAt,
  ok: failed === 0,
  metrics: {
    totalChecks: checks.length,
    passed,
    failed
  },
  checks
};

console.log(JSON.stringify(output, null, 2));
process.exit(output.ok ? 0 : 1);
