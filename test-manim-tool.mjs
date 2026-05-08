import { AnimationManimTool } from "./apps/server/server/tools/animation-manim-tool.js";

const tool = new AnimationManimTool();

const simpleScene = `from manim import *

class TestScene(Scene):
    def construct(self):
        circle = Circle()
        self.play(Create(circle))
        self.wait(1)
`;

async function test() {
  console.log("Testing manim via AnimationManimTool...");
  try {
    const result = await tool.renderScene({
      session_id: "test-manim-fresh-001",
      code: simpleScene,
    });
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
