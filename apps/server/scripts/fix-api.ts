import fs from "node:fs";
import path from "node:path";

const apiPath = path.join(process.cwd(), "server/routes/api.ts");
let content = fs.readFileSync(apiPath, "utf8");

content = content.replace(/buildSceneUpdatePayload\(([^),]+)\)/g, "buildSceneUpdatePayload($1.sessionId)");
content = content.replace(/buildCodeUpdatePayload\(([^),]+),/g, "buildCodeUpdatePayload($1.sessionId,");

fs.writeFileSync(apiPath, content);
console.log("Fixed api.ts");
