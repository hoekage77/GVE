const fs = require('fs');
const file = 'packages/shared/src/index.ts';
let code = fs.readFileSync(file, 'utf8');

const analyzeCode = `
export async function analyzeQuality(sessionId: string): Promise<{ success: boolean; consensus: number }> {
  return await requestJson<{ success: boolean; consensus: number }>(\`/api/v1/sessions/\${sessionId}/analyze\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Quality analysis request failed");
}
`;

code = code.replace(
  'export async function modifyVisual(input: ModifyRequest): Promise<ModifyResponse> {',
  analyzeCode + '\nexport async function modifyVisual(input: ModifyRequest): Promise<ModifyResponse> {'
);

fs.writeFileSync(file, code);
