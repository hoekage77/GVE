import { getPoolBasedProvider } from "./apps/server/server/llm/fetch.ts";

async function run() {
  console.log("Testing LLM pool...");
  const provider = getPoolBasedProvider();
  try {
    const res = await provider.generate("Say 'Hello world' and nothing else.", { mode: "instant" });
    console.log("LLM output:", res);
  } catch (err) {
    console.error("LLM Pool Error:", err);
  }
}
run();
