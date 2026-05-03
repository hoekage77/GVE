import * as acorn from "acorn";

const FORBIDDEN_GLOBALS = new Set([
  "eval",
  "exec",
  "execSync",
  "spawn",
  "child_process",
  "fs",
  "os",
  "cluster"
]);

export function validateCodeSafety(code: string): { valid: boolean; reason?: string } {
  try {
    const ast = acorn.parse(code, { ecmaVersion: 2024, sourceType: "module" });
    
    let violation: string | null = null;
    
    function walk(node: any) {
      if (violation) return;
      if (!node) return;
      
      if (node.type === "Identifier" && FORBIDDEN_GLOBALS.has(node.name)) {
        violation = `Forbidden global detected: ${node.name}`;
        return;
      }
      
      if (node.type === "Identifier" && node.name === "Function") {
        violation = "Dynamically creating functions via 'Function' constructor is forbidden.";
        return;
      }

      for (const key in node) {
        if (typeof node[key] === "object" && node[key] !== null) {
          if (node.type === "MemberExpression" && key === "property" && !node.computed) {
            continue;
          }
          if ((node.type === "Property" || node.type === "MethodDefinition") && key === "key" && !node.computed) {
            continue;
          }
          walk(node[key]);
        }
      }
    }
    
    walk(ast);
    
    if (violation) {
      return { valid: false, reason: violation };
    }
    
    return { valid: true };
  } catch (error: any) {
    return { valid: false, reason: `Syntax error: ${error.message}` };
  }
}
