const fs = require('fs');
const file = 'apps/web/src/stores/chat/store.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('analyzeQuality as apiAnalyzeQuality')) {
  code = code.replace(
    'modifyVisual as apiModifyVisual,',
    'modifyVisual as apiModifyVisual,\n  analyzeQuality as apiAnalyzeQuality,'
  );
}

// Ensure the sendMessage method intercepts the `analyze_quality` action
const analyzeIntercept = `
          if (input === 'analyze_quality' || input === '/analyze_quality') {
            const currentSessionId = get().activeSessionId;
            if (currentSessionId) {
              get().setAgentAnalyzing(true);
              apiAnalyzeQuality(currentSessionId).catch(err => {
                get().setAgentAnalyzing(false);
                set({ sessionsError: String(err) });
              });
            }
            return;
          }
`;

if (!code.includes('analyze_quality')) {
  code = code.replace(
    'if ((!input && !hasImage) || currentState.isSending) return;',
    'if ((!input && !hasImage) || currentState.isSending) return;\n' + analyzeIntercept
  );
}

fs.writeFileSync(file, code);
