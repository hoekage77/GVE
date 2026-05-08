import { getPool } from "../llm/pool.js";
import { streamChatCompletion } from "../llm/streaming.js";

export async function runMultiAgentAnalysis(code: string): Promise<{
  results: Record<string, { name: string; score: number; findings: string[]; recommendations: string[] }>;
  consensus: number;
  recommendations: Array<{ action: string; priority: number; agent: string }>;
}> {
  const pool = getPool();
  const maxAttempts = pool.providers.filter((p) => p.hasApiKey).length;

  if (maxAttempts === 0) {
    throw new Error("No LLM providers configured for multi-agent analysis.");
  }

  const systemPrompt = `You are a multi-agent Code Analysis Engine. You facilitate three expert personas:
1. Architect Agent: Focuses on separation of concerns, logic grouping, and structure.
2. Animator Agent: Focuses on run-loop efficiency, render methods, animations, and math.
3. Materials Agent: Focuses on visual styling, colors, PBR, lighting, and textures.

You MUST respond with ONLY valid JSON and no markdown wrapping. The JSON must exactly match this format:
{
  "results": {
    "architect": {
      "name": "Architect Agent",
      "score": <0-100>,
      "findings": ["..."],
      "recommendations": ["..."]
    },
    "animator": {
      "name": "Animator Agent",
      "score": <0-100>,
      "findings": ["..."],
      "recommendations": ["..."]
    },
    "materials": {
      "name": "Materials Agent",
      "score": <0-100>,
      "findings": ["..."],
      "recommendations": ["..."]
    }
  },
  "consensus": <0-100, the average score>,
  "recommendations": [
    { "action": "...", "priority": 1, "agent": "<architect|animator|materials>" }
  ]
}`;

  const userPrompt = `Please analyze the following scene code:\n\n\`\`\`javascript\n${code}\n\`\`\`\n\nReturn the JSON analysis.`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const acquired = pool.acquire({ requireCodeGeneration: false });
    if (!acquired) throw new Error("Could not acquire LLM provider.");

    const { provider } = acquired;

    try {
      const result = await streamChatCompletion(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2,
      }, { mode: "instant" });

      let content = result.content || "";
      
      // Clean up potential markdown formatting (e.g. ```json ... ```)
      content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

      const parsed = JSON.parse(content);
      
      // Validate schema minimally
      if (parsed.results && parsed.consensus !== undefined && Array.isArray(parsed.recommendations)) {
        return parsed;
      }
    } catch (error) {
      console.warn(`[MultiAgentAnalyzer] Failed on provider ${provider.id}:`, error);
      // Try next provider
    }
  }

  throw new Error("Failed to complete multi-agent analysis across all pool providers.");
}
