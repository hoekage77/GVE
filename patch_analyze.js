const fs = require('fs');
const file = 'apps/server/server/routes/api.ts';
let code = fs.readFileSync(file, 'utf8');

const routeCode = `
apiRouter.post("/api/v1/sessions/:sessionId/analyze", requireSessionOwnership, async (req, res) => {
  const sessionId = String(req.params.sessionId);
  const sessionState = createSession(sessionId);

  if (!sessionState.currentScene?.code) {
    res.status(404).json({
      error: "NOT_FOUND",
      message: "No scene available for the requested session."
    });
    return;
  }

  // Broadcast analyzing state immediately
  broadcastEvent(sessionId, "agentState", { isAnalyzing: true });

  try {
    // Synthesize analysis result using pseudo-agents
    // In actual implementation this would call out to LLM Pool
    await new Promise(r => setTimeout(r, 1500)); // Simulating work

    const results = {
      architect: {
        name: "Architect Agent",
        score: 85,
        findings: ["Code structure is clean", "Separation of concerns is maintained"],
        recommendations: ["Consider moving materials outside render loop"]
      },
      animator: {
        name: "Animator Agent",
        score: 72,
        findings: ["Frame rate could dip on complex scenes"],
        recommendations: ["Use requestAnimationFrame consistently", "Cache geometry"]
      },
      materials: {
        name: "Materials Agent",
        score: 90,
        findings: ["Good use of PBR materials"],
        recommendations: ["Maybe add environment map for better lighting"]
      }
    };

    const consensus = 82;
    const recommendations = [
      { action: "Optimize render loop materials", priority: 1, agent: "architect" },
      { action: "Cache geometry instance", priority: 2, agent: "animator" },
      { action: "Add environment map", priority: 3, agent: "materials" }
    ];

    // Broadcast the completion
    broadcastEvent(sessionId, "agent:analysis_complete", {
      results,
      consensus,
      recommendations
    });

    res.json({ success: true, consensus });
  } catch (error) {
    broadcastEvent(sessionId, "agentState", { isAnalyzing: false, error: String(error) });
    res.status(500).json({ error: "INTERNAL_ERROR", message: String(error) });
  }
});
`;

code = code.replace(
  'apiRouter.post("/api/v1/sessions/:sessionId/modify", requireSessionOwnership, async (req, res) => {',
  routeCode + '\napiRouter.post("/api/v1/sessions/:sessionId/modify", requireSessionOwnership, async (req, res) => {'
);

fs.writeFileSync(file, code);
