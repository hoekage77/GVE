const fs = require('fs');
const file = 'apps/server/server/routes/api.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /broadcastEvent\(sessionId,\s*"agentState",\s*{ isAnalyzing: true }\);/g,
  'broadcastEvent("agentState", { sessionId, isAnalyzing: true });'
);

code = code.replace(
  /broadcastEvent\(sessionId,\s*"agentState",\s*{ isAnalyzing: false, error: String\(error\) }\);/g,
  'broadcastEvent("agentState", { sessionId, isAnalyzing: false, error: String(error) });'
);

code = code.replace(
  /broadcastEvent\(sessionId,\s*"agent:analysis_complete",\s*{/g,
  'broadcastEvent("agent:analysis_complete", { sessionId,'
);

fs.writeFileSync(file, code);
