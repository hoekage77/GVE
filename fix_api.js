const fs = require('fs');
const file = 'apps/server/server/routes/api.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'broadcastEvent(sessionId, "agentState", { isAnalyzing: true });',
  ''
);

code = code.replace(
  'broadcastEvent(sessionId, "agent:analysis_complete", {',
  'broadcastEvent("agent:analysis_complete", { sessionId,'
);

code = code.replace(
  'broadcastEvent(sessionId, "agentState", { isAnalyzing: false, error: String(error) });',
  ''
);

fs.writeFileSync(file, code);
