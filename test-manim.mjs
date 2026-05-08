import { executeSkillRuntime } from "./apps/server/server/sandbox/skill-runtime.js";

async function test() {
  console.log("Testing simple command in Daytona sandbox...");
  try {
    const result = await executeSkillRuntime({
      skillId: "manim",
      code: `from manim import *\nclass T(Scene):\n    def construct(self):\n        self.play(Create(Circle()))\n`,
      timeoutMs: 60_000,
      sessionId: "test-simple-session",
    });
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
