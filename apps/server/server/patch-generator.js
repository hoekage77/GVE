/**
 * Patch Generator - LLM-powered code modifications for quality loop
 *
 * This module synthesizes code patches from quality analysis reports using LLM.
 * It integrates with the quality loop to iteratively improve generated code.
 *
 * Features:
 * - LLM-based patch generation from quality goals
 * - Multi-file project support
 * - Safety validation before applying patches
 * - Rollback capability on failure
 * - Agent memory context integration
 */

import { createHash } from 'crypto';

/**
 * @typedef {Object} PatchGoal
 * @property {string} category - 'structure' | 'performance' | 'visual' | 'api' | 'safety'
 * @property {string} issue - Human-readable problem description
 * @property {string} suggestion - Proposed fix
 * @property {number} severity - 0-1 (impact on quality score)
 * @property {string} [affectedFile] - Which file to patch (optional, will be inferred)
 */

/**
 * @typedef {Object} GeneratedPatch
 * @property {string} filePath - Path to patched file
 * @property {string} originalCode - Original content
 * @property {string} patchedCode - Modified content
 * @property {string} explanation - Why this change was made
 * @property {number} expectedScoreImpact - Estimated quality improvement (0-30)
 * @property {number} riskLevel - 0-1 (likelihood of breaking something)
 */

export class PatchGenerator {
  /**
   * Create a new patch generator
   * @param {Object} llmProvider - LLM provider instance
   * @param {Object} [options] - Configuration options
   */
  constructor(llmProvider, options = {}) {
    this.llm = llmProvider;
    this.maxPatchRetries = options.maxPatchRetries || 2;
    this.patchTimeoutMs = options.patchTimeoutMs || 30000;
    this.minConfidenceScore = options.minConfidenceScore || 0.7;
    this.patchCache = new Map(); // Cache to avoid regenerating same patches
  }

  /**
   * Generate patches from quality analysis results
   * @param {string} originalCode - Single-file code or entry point of project
   * @param {Object} project - Multi-file project structure
   * @param {Array<PatchGoal>} patchGoals - Issues to fix
   * @param {Object} agentMemory - Context from previous iterations
   * @param {Object} [context] - Additional execution context
   * @returns {Promise<GeneratedPatch[]>}
   */
  async generatePatches(
    originalCode,
    project,
    patchGoals,
    agentMemory,
    context = {}
  ) {
    if (!patchGoals || patchGoals.length === 0) {
      return [];
    }

    // Group goals by file
    const goalsByFile = this._groupGoalsByFile(patchGoals, project);

    const patches = [];
    const failedFiles = [];

    // Generate patches for each affected file
    for (const [filePath, goals] of Object.entries(goalsByFile)) {
      try {
        const fileContent = this._getFileContent(filePath, project, originalCode);

        // Check cache first
        const cacheKey = this._buildCacheKey(filePath, fileContent, goals);
        if (this.patchCache.has(cacheKey)) {
          patches.push(this.patchCache.get(cacheKey));
          continue;
        }

        const patch = await this._generateFilePatch(
          filePath,
          fileContent,
          goals,
          agentMemory,
          project,
          context
        );

        if (patch) {
          // Validate patch safety
          if (this._validatePatch(patch, project)) {
            patches.push(patch);
            this.patchCache.set(cacheKey, patch);
          }
        }
      } catch (err) {
        console.error(
          `[PatchGenerator] Failed to patch ${filePath}: ${err.message}`
        );
        failedFiles.push(filePath);
      }
    }

    if (failedFiles.length > 0) {
      console.warn(
        `[PatchGenerator] Failed to generate patches for: ${failedFiles.join(', ')}`
      );
    }

    return patches;
  }

  /**
   * Generate patch for a single file with retry logic
   * @private
   */
  async _generateFilePatch(
    filePath,
    fileContent,
    goals,
    agentMemory,
    project,
    context
  ) {
    for (let attempt = 0; attempt <= this.maxPatchRetries; attempt++) {
      try {
        const prompt = this._buildPatchPrompt(
          filePath,
          fileContent,
          goals,
          agentMemory,
          project,
          context,
          attempt
        );

        const response = await Promise.race([
          this.llm.generate({
            prompt,
            model: process.env.MOONSHOT_MODEL || 'kimi-k2.5',
            maxTokens: 2000,
            temperature: 0.6 // Lower temp for consistency
          }),
          this._withTimeout(this.patchTimeoutMs)
        ]);

        const patchedCode = this._extractCode(response.text);

        // Validate syntax
        if (!this._isValidJavaScript(patchedCode)) {
          if (attempt < this.maxPatchRetries) {
            console.warn(`[PatchGenerator] Invalid syntax on attempt ${attempt + 1}, retrying...`);
            continue;
          }
          throw new Error('Generated code has invalid syntax');
        }

        return {
          filePath,
          originalCode: fileContent,
          patchedCode,
          explanation: this._extractExplanation(response.text),
          expectedScoreImpact: this._estimateImpact(goals),
          riskLevel: this._estimateRisk(fileContent, patchedCode)
        };
      } catch (err) {
        if (attempt === this.maxPatchRetries) {
          throw err;
        }
        console.warn(
          `[PatchGenerator] Attempt ${attempt + 1} failed: ${err.message}, retrying...`
        );
      }
    }

    return null;
  }

  /**
   * Build LLM prompt for patch generation
   * @private
   */
  _buildPatchPrompt(
    filePath,
    fileContent,
    goals,
    agentMemory,
    project,
    context,
    attempt
  ) {
    const lines = fileContent.split('\n');
    const lineCount = lines.length;
    const estimatedScore = context?.currentScore || 50;

    let prompt = `You are an expert JavaScript/TypeScript code enhancer for 3D visualization.

Your task: Fix the quality issues below to improve the code from score ${estimatedScore}/100.

File: ${filePath}
Lines: ${lineCount}

Quality Issues to Fix:
${goals
  .map((g, i) => `${i + 1}. [${g.category}] ${g.issue}\n   Fix: ${g.suggestion}`)
  .join('\n')}`;

    // Add memory context if available
    if (agentMemory?.previousAttempts && agentMemory.previousAttempts.length > 0) {
      const successfulFixes = agentMemory.previousAttempts
        .filter(a => a.successful)
        .map(a => a.description);

      if (successfulFixes.length > 0) {
        prompt += `\n\nPreviously successful approaches:
${successfulFixes.map(f => `- ${f}`).join('\n')}`;
      }
    }

    // Add context about what to preserve
    prompt += `\n\nImportant:
1. Fix ONLY the issues listed above
2. Preserve all imports, exports, and function signatures
3. Keep THREE.js/p5.js setup code intact
4. Maintain animation smoothness
5. Don't remove any core functionality
6. Output ONLY valid JavaScript/TypeScript

Current code:
\`\`\`javascript
${fileContent}
\`\`\`

Provide the complete patched file (start with \`\`\`javascript, end with \`\`\`).
After code, add: "EXPLANATION: [one sentence describing changes]"`;

    // Add retry guidance
    if (attempt > 0) {
      prompt += `\n\nNote: This is attempt ${attempt + 1}. Previous attempt had issues, so be extra careful with syntax and logic.`;
    }

    return prompt;
  }

  /**
   * Extract code from LLM response
   * @private
   */
  _extractCode(text) {
    const match = text.match(
      /```(?:javascript|typescript|js|ts)?\n([\s\S]*?)\n```/
    );
    if (match) {
      return match[1].trim();
    }

    // Fallback: return everything if no code block found
    const lines = text.split('\n');
    const codeLines = [];
    let inCode = false;

    for (const line of lines) {
      if (line.includes('```')) {
        inCode = !inCode;
      } else if (inCode) {
        codeLines.push(line);
      }
    }

    return codeLines.join('\n').trim() || text;
  }

  /**
   * Extract explanation from LLM response
   * @private
   */
  _extractExplanation(text) {
    const match = text.match(/EXPLANATION:\s*(.+?)(?:\n|$)/i);
    if (match) {
      return match[1].trim();
    }

    // Fallback: find text after last code block
    const parts = text.split('```');
    if (parts.length > 1) {
      return parts[parts.length - 1].trim().substring(0, 100);
    }

    return 'Patch applied for quality improvement';
  }

  /**
   * Group patch goals by file
   * @private
   */
  _groupGoalsByFile(goals, project) {
    const grouped = {};

    for (const goal of goals) {
      let file = goal.affectedFile;

      // If file not specified, try to infer from category
      if (!file) {
        if (goal.category === 'visual') {
          file = 'materials.js'; // Common file name
        } else if (goal.category === 'animation') {
          file = 'animations.js';
        } else {
          file = project?.entryPoint || 'index.js';
        }
      }

      if (!grouped[file]) {
        grouped[file] = [];
      }
      grouped[file].push(goal);
    }

    return grouped;
  }

  /**
   * Get file content from project or fallback to original code
   * @private
   */
  _getFileContent(filePath, project, originalCode) {
    if (project && project.files) {
      const file = project.files.find(f => f.path === filePath);
      if (file) {
        return file.content;
      }
    }

    // Fallback to original code if single-file
    return originalCode;
  }

  /**
   * Estimate quality score improvement from patch goals
   * @private
   */
  _estimateImpact(goals) {
    if (!goals || goals.length === 0) return 0;

    const totalSeverity = goals.reduce((sum, g) => sum + (g.severity || 0.5), 0);
    // Max 30 point improvement, scales with severity
    return Math.min(totalSeverity * 10, 30);
  }

  /**
   * Estimate risk level of patch (0-1, higher = riskier)
   * @private
   */
  _estimateRisk(originalCode, patchedCode) {
    const originalLines = originalCode.split('\n').length;
    const patchedLines = patchedCode.split('\n').length;

    // Large changes are riskier
    const lineDiff = Math.abs(patchedLines - originalLines);
    const changeRatio = lineDiff / Math.max(originalLines, 1);

    // Changes > 50% of file are risky
    let risk = Math.min(changeRatio * 2, 1.0);

    // Detect structural changes (adding/removing imports, functions)
    const originalImports = (originalCode.match(/^import /gm) || []).length;
    const patchedImports = (patchedCode.match(/^import /gm) || []).length;
    if (originalImports !== patchedImports) {
      risk = Math.min(risk + 0.2, 1.0);
    }

    return risk;
  }

  /**
   * Validate patch safety
   * @private
   */
  _validatePatch(patch, project) {
    // Check for dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/i,
      /Function\s*\(/i,
      /process\.exit/i,
      /require\s*\(\s*['"`].*user.*/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(patch.patchedCode)) {
        console.warn(
          `[PatchGenerator] Patch blocked: contains dangerous pattern ${pattern}`
        );
        return false;
      }
    }

    // Check that exports are preserved
    const hasOriginalExport = /^export|^module\.exports/m.test(
      patch.originalCode
    );
    const hasNewExport = /^export|^module\.exports/m.test(patch.patchedCode);

    if (hasOriginalExport && !hasNewExport) {
      console.warn('[PatchGenerator] Patch blocked: removes exports');
      return false;
    }

    return true;
  }

  /**
   * Check if code is valid JavaScript
   * @private
   */
  _isValidJavaScript(code) {
    try {
      new Function(code);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build cache key for patch
   * @private
   */
  _buildCacheKey(filePath, content, goals) {
    const hash = createHash('sha256')
      .update(content)
      .update(JSON.stringify(goals))
      .digest('hex');
    return `${filePath}:${hash}`;
  }

  /**
   * Timeout utility
   * @private
   */
  _withTimeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Patch generation timeout')), ms)
    );
  }

  /**
   * Clear patch cache
   */
  clearCache() {
    this.patchCache.clear();
  }
}

/**
 * Apply patches to project files
 * @param {Object} project - Multi-file project
 * @param {GeneratedPatch[]} patches - Patches to apply
 * @returns {Object} - New project with patches applied
 */
export function applyPatches(project, patches) {
  if (!patches || patches.length === 0) {
    return project;
  }

  const updatedFiles = project.files.map(file => {
    const patch = patches.find(p => p.filePath === file.path);
    return patch
      ? { ...file, content: patch.patchedCode }
      : file;
  });

  return {
    ...project,
    files: updatedFiles
  };
}

/**
 * Rollback patches on failure (restore original project)
 * @param {Object} originalProject - Original project before patches
 * @returns {Object}
 */
export function rollbackPatches(originalProject) {
  return originalProject;
}

/**
 * Extract patch summary for logging
 * @param {GeneratedPatch[]} patches
 * @returns {Array<Object>}
 */
export function summarizePatches(patches) {
  return patches.map(p => ({
    file: p.filePath,
    change: p.explanation,
    impact: `+${Math.round(p.expectedScoreImpact)} pts`,
    risk: p.riskLevel > 0.7 ? 'HIGH' : p.riskLevel > 0.4 ? 'MEDIUM' : 'LOW'
  }));
}
