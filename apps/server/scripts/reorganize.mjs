import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '../server');

const moveMap = {
  "llm-provider.ts": "llm/provider.ts",
  "llm-pool.ts": "llm/pool.ts",
  "pool-based-llm-provider.ts": "llm/fetch.ts",
  "skill-loader.ts": "skills/loader.ts",
  "skill-registry.ts": "skills/registry.ts",
  "sandbox-manager.ts": "sandbox/manager.ts",
  "dedicated-sandbox-manager.ts": "sandbox/dedicated-manager.ts",
  "skill-runtime.ts": "sandbox/skill-runtime.ts",
  "sandbox-execution.ts": "sandbox/execution.ts",
  "code-validator.ts": "quality/validator.ts",
  "quality-analyzer.ts": "quality/analyzer.ts",
  "patch-generator.ts": "quality/patcher.ts",
  "mode-decision-engine.ts": "quality/mode-engine.ts",
  "agent-runner.ts": "agents/runner.ts",
  "agent-tools.ts": "agents/tools.ts",
  "agent-memory.ts": "agents/memory.ts",
  "agent-integration.ts": "agents/integration.ts",
  "tool-registry.ts": "agents/tool-registry.ts",
  "session-state.ts": "state/session.ts",
  "file-store.ts": "state/file-store.ts",
  "token-usage.ts": "state/token-usage.ts",
  "thought-generator.ts": "pipeline/thoughts.ts",
  "asset-resolver.ts": "pipeline/assets.ts",
  "prompt-manager.ts": "pipeline/prompts.ts",
  "media-artifacts.ts": "routes/media.ts",
  "multi-agent-framework.ts": "agents/multi-agent-framework.ts"
};

// 1. Gather all files in server directory
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file === 'dist' || file === '__tests__' || file === '_archived') continue;
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = getAllFiles(SERVER_DIR);

// 2. Build mapping
const absMoveMap = new Map(); // oldAbsPath -> newAbsPath
for (const [oldRel, newRel] of Object.entries(moveMap)) {
  absMoveMap.set(path.join(SERVER_DIR, oldRel), path.join(SERVER_DIR, newRel));
}

// Ensure all current files are in the map, mapped to themselves if not moved
const fileLocations = new Map(); // oldAbsPath -> newAbsPath
for (const file of allFiles) {
  if (absMoveMap.has(file)) {
    fileLocations.set(file, absMoveMap.get(file));
  } else {
    fileLocations.set(file, file);
  }
}

// 3. Process files
const memoryFiles = new Map(); // newAbsPath -> content

for (const [oldPath, newPath] of fileLocations.entries()) {
  let content = fs.readFileSync(oldPath, 'utf8');

  // Regex to find imports: import ... from "..." or import("...") or require("...")
  // We need to carefully replace the string inside the quotes
  const importRegex = /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g;
  
  content = content.replace(importRegex, (match, p1, p2, p3) => {
    const importStr = p1 || p2 || p3;
    
    // Only process local imports starting with .
    if (!importStr.startsWith('.')) return match;
    
    // Resolve the old absolute path of the imported file
    // Handle the .js extension mapping back to .ts for resolution
    let importedFileTs = importStr;
    if (importedFileTs.endsWith('.js')) {
      importedFileTs = importedFileTs.slice(0, -3) + '.ts';
    } else if (importedFileTs === '.' || importedFileTs === './' || importedFileTs === '..' || importedFileTs === '../') {
      importedFileTs = path.join(importedFileTs, 'index.ts');
    }
    
    const oldImportedAbsPath = path.resolve(path.dirname(oldPath), importedFileTs);
    
    // Find where this file is moving to
    let newImportedAbsPath = fileLocations.get(oldImportedAbsPath);
    
    if (!newImportedAbsPath) {
      // It might be a directory import resolved via index.ts which we missed, or it's fine as is
      if (fs.existsSync(oldImportedAbsPath)) {
        newImportedAbsPath = oldImportedAbsPath;
      } else {
        // Leave it alone if we can't resolve it
        return match;
      }
    }
    
    // Compute new relative path
    let newRelPath = path.relative(path.dirname(newPath), newImportedAbsPath);
    if (!newRelPath.startsWith('.')) {
      newRelPath = './' + newRelPath;
    }
    
    // Put the .js extension back
    if (newRelPath.endsWith('.ts')) {
      newRelPath = newRelPath.slice(0, -3) + '.js';
    }
    
    // Replace the exact string inside the quotes
    return match.replace(importStr, newRelPath);
  });
  
  memoryFiles.set(newPath, content);
}

// 4. Write files and cleanup
for (const [newPath, content] of memoryFiles.entries()) {
  const dir = path.dirname(newPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(newPath, content, 'utf8');
}

// 5. Delete old files that were moved
for (const [oldPath, newPath] of fileLocations.entries()) {
  if (oldPath !== newPath && fs.existsSync(oldPath)) {
    fs.unlinkSync(oldPath);
  }
}

console.log("Reorganization complete.");
