const fs = require('fs');
const file = 'apps/server/server/routes/api.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('import { runMultiAgentAnalysis }')) {
  code = code.replace(
    'import { executeChatTurn } from "./chat.js";',
    'import { executeChatTurn } from "./chat.js";\nimport { runMultiAgentAnalysis } from "../agents/analyzer.js";'
  );
}

const newRoute = `
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
  broadcastEvent("agentState", { sessionId, isAnalyzing: true });

  try {
    const analysisResult = await runMultiAgentAnalysis(sessionState.currentScene.code);

    // Broadcast the completion
    broadcastEvent("agent:analysis_complete", { 
      sessionId,
      results: analysisResult.results,
      consensus: analysisResult.consensus,
      recommendations: analysisResult.recommendations
    });

    res.json({ success: true, consensus: analysisResult.consensus });
  } catch (error) {
    broadcastEvent("agentState", { sessionId, isAnalyzing: false, error: String(error) });
    res.status(500).json({ error: "INTERNAL_ERROR", message: String(error) });
  }
});
`;

code = code.replace(/apiRouter\.post\("\/api\/v1\/sessions\/:sessionId\/analyze", requireSessionOwnership, async \(req, res\) => \{[\s\S]*?\}\);/, newRoute.trim());

fs.writeFileSync(file, code);
