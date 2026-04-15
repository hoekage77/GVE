/**
 * Sandbox Execution - High-level API for containerized code execution
 * 
 * This module provides the main interface for executing code in Linux sandboxes,
 * managing the full lifecycle from container creation to quality analysis.
 * It integrates with the quality analyzer and tool registry for a complete
 * agentic workflow.
 */

import {
  createSandbox,
  executeInSandbox,
  buildScenePreview,
  cleanupSessionSandbox,
  getSandboxMetrics,
  getSandboxFile,
  listSandboxFiles
} from "./sandbox-manager.js";

import {
  installToolsInSandbox,
  getRecommendedTools,
  getInstallTimeEstimate,
  validateToolCombination
} from "./tool-registry.js";

import {
  analyzeQuality,
  generatePatchGoals,
  shouldStopIteration,
  getQualityLabel
} from "./quality-analyzer.js";

import { validateCode } from "./code-validator.js";

import { SandboxPoolManager, createArtifactStorage } from "@visual-runtime/sandbox-pool";

import { PatchGenerator, applyPatches, summarizePatches } from "./patch-generator.js";
import { AgentMemory, createMemoryContext } from "./agent-memory.js";
import { getPoolBasedProvider } from "./pool-based-llm-provider.js";

// Agent framework integration
import {
  initializeAgentMemory,
  analyzeCodeWithAgents,
  generatePatchGoalsFromAgents,
  shouldContinueIterating
} from "./agent-integration.js";

/**
 * Sanitize error messages for client display
 * Removes sensitive info (container IDs, file paths, npm registry URLs)
 * while logging full details server-side for debugging
 * @param {Error|string} error - Error object or message
 * @param {string} [category] - Error category (docker, npm, validation, execution)
 * @returns {{userMessage: string, logMessage: string}}
 */
function sanitizeError(error, category = "general") {
  const fullMessage = error instanceof Error ? error.message : String(error);
  
  // Log full error server-side (not sent to client)
  console.error(`[Sanitized Error] Category: ${category}`);
  console.error(`[Sanitized Error] Full details:`, fullMessage);

  // Detect error type and create user-friendly message
  if (fullMessage.includes("EROFS") || fullMessage.includes("read-only")) {
    return {
      userMessage: "Sandbox environment is temporarily unavailable. Your code has been saved and can be re-run.",
      logMessage: fullMessage
    };
  }

  if (fullMessage.includes("npm") || fullMessage.includes("install")) {
    return {
      userMessage: "Failed to install required dependencies. Try again in a moment.",
      logMessage: fullMessage
    };
  }

  if (fullMessage.includes("docker") || fullMessage.includes("container") || fullMessage.includes("docker exec")) {
    return {
      userMessage: "Sandbox execution failed. Your code is safe and available for review.",
      logMessage: fullMessage
    };
  }

  if (fullMessage.includes("timeout") || fullMessage.includes("timed out")) {
    return {
      userMessage: "Execution took too long. The code may have infinite loops or hang.",
      logMessage: fullMessage
    };
  }

  if (fullMessage.includes("memory") || fullMessage.includes("out of memory")) {
    return {
      userMessage: "Ran out of memory. Try simplifying the visualization.",
      logMessage: fullMessage
    };
  }

  if (fullMessage.includes("SecurityError") || fullMessage.includes("blocked")) {
    return {
      userMessage: "Code contains potentially dangerous operations.",
      logMessage: fullMessage
    };
  }

  if (fullMessage.includes("SyntaxError") || fullMessage.includes("ParseError")) {
    // For syntax errors, try to extract just the relevant line
    const lines = fullMessage.split('\n');
    const syntaxLine = lines.find(l => l.includes('line') || l.includes('near'));
    return {
      userMessage: `Syntax error: ${syntaxLine ? syntaxLine.trim() : 'Invalid code'}`,
      logMessage: fullMessage
    };
  }

  // Generic fallback (redact potentially sensitive patterns)
  let redacted = fullMessage
    // Remove container IDs (hex strings)
    .replace(/[0-9a-f]{12}[0-9a-f]*/gi, '[container-id]')
    // Remove file paths
    .replace(/\/home\/[^\s]*/g, '[path]')
    .replace(/\/usr\/[^\s]*/g, '[path]')
    .replace(/\/var\/[^\s]*/g, '[path]')
    // Remove URLs
    .replace(/https?:\/\/[^\s]*/g, '[url]')
    // Remove long hex strings
    .replace(/[0-9a-f]{64,}/g, '[hash]');

  return {
    userMessage: "An error occurred. Please try again.",
    logMessage: fullMessage
  };
}

// Execution configuration
const DEFAULT_ITERATION_CONFIG = {
  maxIterations: 3,
  qualityThreshold: 75,
  enableAutoPatch: true,
  timeoutPerIterationMs: 60000,
  preferredSandbox: "docker" // or "kubernetes" for production
};

// Active execution sessions
const executionSessions = new Map();

/**
 * @typedef {Object} GeneratedProjectFile
 * @property {string} path - File path (e.g., 'index.js', 'src/utils.js')
 * @property {string} content - File content
 * @property {string} [language] - Language hint (javascript, json, css, etc.)
 */

/**
 * @typedef {Object} BuildOutput
 * @property {string} command - Build command executed
 * @property {number} exitCode - Command exit code (0 = success)
 * @property {string} stdout - Build output (stdout)
 * @property {string} stderr - Build errors (stderr)
 * @property {Array<{path: string, size: number}>} [artifacts] - Built artifacts (dist files)
 */

/**
 * @typedef {Object} GeneratedProject
 * @property {Array<GeneratedProjectFile>} files - Source files
 * @property {string} entryPoint - Main file to execute (e.g., 'index.js')
 * @property {string} [buildCommand] - Optional build command (e.g., 'vite build')
 * @property {Object} [config] - Project metadata (version, description, etc.)
 * @property {BuildOutput} [buildOutput] - Result of last build (if built)
 */

/**
 * @typedef {Object} ExecutionRequest
 * @property {string} sessionId
 * @property {string|GeneratedProject} code - Code string or multi-file project
 * @property {string} skill
 * @property {string} prompt - Original user prompt
 * @property {string[]} [tools] - Additional tools to install
 * @property {Object} [config] - Iteration configuration
 */

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success
 * @property {string} sessionId
 * @property {number} finalIteration
 * @property {number} finalScore
 * @property {string} stopReason
 * @property {Array<IterationResult>} iterations
 * @property {string} previewUrl
 * @property {string[]} artifacts
 */

/**
 * @typedef {Object} IterationResult
 * @property {number} iterationNumber
 * @property {string} code
 * @property {QualitySignals} quality
 * @property {number} score
 * @property {Array} patchGoals
 * @property {number} durationMs
 * @property {boolean} isFinal
 */

/**
 * Execute code with full quality iteration loop
 * @param {ExecutionRequest} request
 * @param {Function} [onProgress] - Callback for iteration progress
 * @returns {Promise<ExecutionResult>}
 */
export async function executeWithQualityLoop(request, onProgress) {
  const {
    sessionId,
    code: initialCode,
    skill,
    prompt,
    tools = [],
    config = {}
  } = request;

  const iterationConfig = { ...DEFAULT_ITERATION_CONFIG, ...config };
  const iterations = [];
  let currentCode = initialCode;
  let finalPreviewUrl = null;
  let finalArtifacts = [];

  // Initialize artifact storage
  const artifactStorage = createArtifactStorage({
    backend: 'filesystem',
    basePath: process.env.ARTIFACTS_PATH || './artifacts'
  });
  await artifactStorage.initialize();
  
  const projectId = sessionId; // Use session ID as project ID

  // Initialize agent memory and patch generator (Phase 2 & 1)
  const agentMemory = new AgentMemory(sessionId, skill);
  const frameworkMemory = initializeAgentMemory(sessionId, skill);
  const llmProvider = getPoolBasedProvider();
  const patchGenerator = new PatchGenerator(llmProvider, {
    maxPatchRetries: 2,
    patchTimeoutMs: 30000
  });

  // Create sandbox
  onProgress?.({ type: "sandbox:creating", sessionId });

  let sandbox;
  try {
    const recommendedTools = getRecommendedTools(skill);
    const allTools = [...new Set([...recommendedTools, ...tools])];

    sandbox = await createSandbox({
      sessionId,
      tools: allTools,
      timeoutMs: iterationConfig.timeoutPerIterationMs
    });
  } catch (error) {
    const { userMessage, logMessage } = sanitizeError(error, 'sandbox-creation');
    return {
      success: false,
      sessionId,
      error: userMessage,
      iterations: []
    };
  }

  onProgress?.({ type: "sandbox:ready", sessionId, containerId: sandbox.containerId });

  // Iteration loop
  for (let iterationNumber = 1; iterationNumber <= iterationConfig.maxIterations; iterationNumber++) {
    const iterationStart = Date.now();

    onProgress?.({
      type: "iteration:started",
      sessionId,
      iteration: iterationNumber,
      maxIterations: iterationConfig.maxIterations
    });

    // Step 1: Static validation
    onProgress?.({ type: "iteration:validating", sessionId, iteration: iterationNumber });

    const staticValidation = await validateCode(currentCode, skill);
    if (!staticValidation.valid) {
      // Static validation failed - need to fix before execution
      const iterationResult = {
        iterationNumber,
        code: currentCode,
        quality: {
          static: {
            score: 0,
            syntaxValid: false,
            complexity: 0,
            nestingDepth: 0,
            securityIssues: [],
            apiComplianceIssues: staticValidation.errors || ["Syntax validation failed"]
          },
          runtime: null,
          visual: null,
          semantic: null,
          composite: 0
        },
        score: 0,
        patchGoals: staticValidation.errors?.map(e => ({
          id: `syntax-${e}`,
          category: "Static",
          severity: "critical",
          description: e
        })) || [{ id: "syntax-error", category: "Static", severity: "critical", description: "Syntax validation failed" }],
        durationMs: Date.now() - iterationStart,
        isFinal: false
      };

      iterations.push(iterationResult);

      // Save iteration to artifact storage
      try {
        await artifactStorage.saveIteration(
          projectId,
          iterationResult,
          null,
          { sessionId, skillId: skill?.id, reason: 'validation-failed' }
        );
      } catch (error) {
        console.warn(`[ARTIFACTS] Failed to save failed iteration: ${error.message}`);
      }

      onProgress?.({
        type: "iteration:complete",
        sessionId,
        iteration: iterationResult
      });

      // If auto-patch is enabled, we would regenerate code here
      // For now, stop with error
      return {
        success: false,
        sessionId,
        finalIteration: iterationNumber,
        finalScore: 0,
        stopReason: "unrecoverable",
        iterations,
        previewUrl: null,
        artifacts: [],
        error: "Static validation failed"
      };
    }

    // Step 2: Execute in sandbox
    onProgress?.({ type: "iteration:executing", sessionId, iteration: iterationNumber });

    let executionResult;
    try {
      executionResult = await executeInSandbox({
        sessionId,
        code: currentCode,
        skill,
        timeoutMs: iterationConfig.timeoutPerIterationMs
      });
    } catch (error) {
      const { userMessage, logMessage } = sanitizeError(error, 'execution');
      executionResult = {
        success: false,
        logs: [],
        error: userMessage,
        durationMs: 0
      };
    }

    // Step 3: Build preview (if execution succeeded)
    let previewResult = null;
    if (executionResult.success) {
      try {
        previewResult = await buildScenePreview({
          sessionId,
          code: currentCode,
          skill
        });
      } catch (error) {
        console.error("Failed to build preview:", error);
      }
    }

    // Step 4: Quality analysis
    onProgress?.({ type: "iteration:scoring", sessionId, iteration: iterationNumber });

    const qualitySignals = analyzeQuality({
      code: currentCode,
      skill,
      prompt,
      executionResult: {
        logs: executionResult.logs,
        error: executionResult.error,
        durationMs: executionResult.durationMs
      }
    });

    // Step 4B: ✨ Multi-Agent Analysis
    onProgress?.({
      type: "iteration:agents",
      sessionId,
      iteration: iterationNumber,
      analyzing: true
    });

    const agentAnalysis = await analyzeCodeWithAgents(currentCode, prompt, {
      skill,
      quality: qualitySignals.composite,
      iteration: iterationNumber,
      maxIterations: iterationConfig.maxIterations
    });

    const agentPatchGoals = generatePatchGoalsFromAgents(agentAnalysis, currentCode);

    if (agentPatchGoals.length > 0) {
      console.log(
        `[QualityLoop] Agents analyzed (${agentAnalysis.agents} agents, ${agentAnalysis.durationMs}ms): ` +
        `${agentAnalysis.recommendations?.length ?? 0} recommendations, ` +
        `+${agentAnalysis.totalPotentialImprovement ?? 0} points potential`
      );
    }

    onProgress?.({
      type: "iteration:agents",
      sessionId,
      iteration: iterationNumber,
      analyzing: false,
      recommendations: agentAnalysis.recommendations?.length ?? 0,
      potentialImprovement: agentAnalysis.totalPotentialImprovement
    });

    // Step 5: Generate patch goals (standard + agents)
    const patchGoals = generatePatchGoals(qualitySignals, iterationConfig.qualityThreshold);
    const allPatchGoals = [...patchGoals, ...agentPatchGoals];

    // Create iteration result
    const iterationResult = {
      iterationNumber,
      code: currentCode,
      quality: qualitySignals,
      score: qualitySignals.composite,
      patchGoals,
      durationMs: Date.now() - iterationStart,
      isFinal: false
    };

    iterations.push(iterationResult);

    // Save iteration to artifact storage
    try {
      await artifactStorage.saveIteration(
        projectId,
        iterationResult,
        executionResult?.buildArtifacts,
        { sessionId, skillId: skill?.id, previewUrl: previewResult?.previewUrl }
      );
    } catch (error) {
      console.warn(`[ARTIFACTS] Failed to save iteration ${iterationResult.iterationNumber}: ${error.message}`);
    }

    onProgress?.({
      type: "iteration:complete",
      sessionId,
      iteration: iterationResult
    });

    // Check stop conditions (enhanced with agent insights)
    const agentDecision = shouldContinueIterating(
      qualitySignals.composite,
      iterationNumber,
      iterationConfig.maxIterations,
      iterationConfig.qualityThreshold,
      agentAnalysis.totalPotentialImprovement ?? 0
    );

    const shouldStop = !agentDecision.shouldContinue;
    const reason = agentDecision.reason;

    if (shouldStop) {
      iterationResult.isFinal = true;
      finalPreviewUrl = previewResult?.previewUrl || null;
      finalArtifacts = previewResult?.artifacts || [];

      // Record final agent insights
      if (agentAnalysis.success) {
        frameworkMemory.recordIteration({
          iteration: iterationNumber,
          quality: qualitySignals.composite,
          agents: agentAnalysis.results,
          recommendations: agentAnalysis.recommendations,
          durationMs: agentAnalysis.durationMs,
          isFinal: true
        });
      }

      // Cleanup sandbox
      await cleanupSessionSandbox(sessionId);

      return {
        success: qualitySignals.composite >= iterationConfig.qualityThreshold,
        sessionId,
        finalIteration: iterationNumber,
        finalScore: qualitySignals.composite,
        stopReason: reason,
        iterations,
        previewUrl: finalPreviewUrl,
        artifacts: finalArtifacts
      };
    }

    // Prepare for next iteration (if auto-patch enabled)
    if (iterationConfig.enableAutoPatch && allPatchGoals.length > 0) {
      onProgress?.({
        type: "iteration:patching",
        sessionId,
        iteration: iterationNumber,
        patchGoals: allPatchGoals
      });

      try {
        // PHASE 1: Generate LLM patches from quality goals
        console.log(
          `[QualityLoop] Generating patches for ${patchGoals.length} quality issues + ${agentPatchGoals.length} agent recommendations (iteration ${iterationNumber})`
        );

        // Build project structure if needed
        let projectForPatching = null;
        if (typeof initialCode === 'object' && initialCode.files) {
          projectForPatching = initialCode; // Already multi-file
        } else {
          // Single-file code, convert to project structure
          projectForPatching = {
            files: [{ path: 'index.js', content: currentCode, language: 'javascript' }],
            entryPoint: 'index.js',
            config: { description: prompt }
          };
        }

        // Add memory context to patch goals for LLM awareness
        const enrichedPatchGoals = patchGoals.map(goal => ({
          ...goal,
          affectedFile: goal.affectedFile || 'index.js'
        }));

        // Generate patches using LLM
        const patches = await patchGenerator.generatePatches(
          currentCode,
          projectForPatching,
          enrichedPatchGoals,
          agentMemory,
          {
            currentScore: qualitySignals.composite,
            skill,
            prompt,
            previousAttempts: agentMemory.attemptedPatches.slice(-3)
          }
        );

        if (patches.length > 0) {
          // Log patches for user
          console.log(`[QualityLoop] Generated ${patches.length} patches`);
          const patchSummary = summarizePatches(patches);
          patchSummary.forEach((summary, i) => {
            console.log(`  ${i + 1}. ${summary.file}: ${summary.change} ${summary.impact} (risk: ${summary.risk})`);
          });

          // Apply patches to code/project
          if (typeof initialCode === 'object' && initialCode.files) {
            // Multi-file project
            const patchedProject = applyPatches(projectForPatching, patches);
            currentCode = patchedProject.files
              .find(f => f.path === patchedProject.entryPoint)?.content || currentCode;
            // Note: in full implementation, would update entire projectForPatching
          } else {
            // Single-file code
            const singleFilePatch = patches.find(p => p.filePath === 'index.js');
            if (singleFilePatch) {
              currentCode = singleFilePatch.patchedCode;
            }
          }

          // Record patch outcomes for agent memory
          for (const patch of patches) {
            agentMemory.recordPatchOutcome(
              enrichedPatchGoals.find(g => g.affectedFile === patch.filePath)?.category || 'structure',
              patch.explanation,
              true, // Assume successful for now
              patch.expectedScoreImpact
            );
          }

          // Emit event for frontend
          onProgress?.({
            type: 'iteration:patch_applied',
            sessionId,
            iteration: iterationNumber,
            patchCount: patches.length,
            patches: patchSummary,
            estimatedImprovement: patches.reduce((sum, p) => sum + p.expectedScoreImpact, 0)
          });
        } else {
          console.warn(`[QualityLoop] No patches could be generated for iteration ${iterationNumber}`);
          agentMemory.recordFailedApproach(`Could not generate patches for ${patchGoals.map(g => g.category).join(', ')}`);
        }
      } catch (err) {
        console.error(`[QualityLoop] Patch generation failed: ${err.message}`);

        // Record failure for agent memory
        agentMemory.recordFailedApproach(`Patch generation error: ${err.message}`);

        // Emit error event but continue iteration
        onProgress?.({
          type: 'iteration:patch_failed',
          sessionId,
          iteration: iterationNumber,
          error: err.message,
          warning: 'Continuing quality loop without patches'
        });
      }

      // Record this iteration in agent memory
      agentMemory.recordIteration(
        iterationNumber,
        currentCode,
        qualitySignals.composite,
        patchGoals.map(g => g.description),
        iterations[iterations.length - 1].patchesApplied || [],
        Date.now() - iterationStart
      );
    }
  }

  // Max iterations reached
  const finalIteration = iterations[iterations.length - 1];
  if (finalIteration) {
    finalIteration.isFinal = true;
  }

  // Cleanup sandbox
  await cleanupSessionSandbox(sessionId);

  return {
    success: finalIteration?.score >= iterationConfig.qualityThreshold,
    sessionId,
    finalIteration: iterations.length,
    finalScore: finalIteration?.score || 0,
    stopReason: "budget_exhausted",
    iterations,
    previewUrl: finalPreviewUrl,
    artifacts: finalArtifacts
  };
}

/**
 * Quick execution without iteration loop
 * @param {ExecutionRequest} request
 * @returns {Promise<{success: boolean, result: Object}>}
 */
export async function executeOnce(request) {
  const { sessionId, code, skill, tools = [] } = request;

  try {
    // Create sandbox
    const sandbox = await createSandbox({ sessionId, tools });

    // Execute
    const result = await executeInSandbox({ sessionId, code, skill });

    // Cleanup
    await cleanupSessionSandbox(sessionId);

    return {
      success: result.success,
      result
    };
  } catch (error) {
    const { userMessage } = sanitizeError(error, 'quick-execution');
    return {
      success: false,
      error: userMessage
    };
  }
}

/**
 * Get execution session status
 * @param {string} sessionId
 * @returns {Object|null}
 */
export function getExecutionStatus(sessionId) {
  return executionSessions.get(sessionId) || null;
}

/**
 * Abort running execution
 * @param {string} sessionId
 */
export async function abortExecution(sessionId) {
  const session = executionSessions.get(sessionId);
  if (session) {
    session.aborted = true;
    await cleanupSessionSandbox(sessionId);
    executionSessions.delete(sessionId);
  }
}

/**
 * Get sandbox files for a session
 * @param {string} sessionId
 * @returns {Promise<{files: string[], workspacePath: string}>}
 */
export async function getSandboxWorkspaceFiles(sessionId) {
  try {
    const files = await listSandboxFiles(sessionId);
    return { files, workspacePath: `/workspace/${sessionId}` };
  } catch (error) {
    return { files: [], workspacePath: null, error: sanitizeError(error, 'file-listing').userMessage };
  }
}

/**
 * Get a specific file from sandbox
 * @param {string} sessionId
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function getSandboxFileContent(sessionId, filePath) {
  return getSandboxFile(sessionId, filePath);
}

/**
 * Get execution configuration with overrides
 * @param {Object} overrides
 * @returns {Object}
 */
export function getExecutionConfig(overrides = {}) {
  return {
    ...DEFAULT_ITERATION_CONFIG,
    ...overrides
  };
}

/**
 * Validate execution request
 * @param {ExecutionRequest} request
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateExecutionRequest(request) {
  const errors = [];

  if (!request.sessionId) {
    errors.push("sessionId is required");
  }

  if (!request.code || request.code.trim().length === 0) {
    errors.push("code is required");
  }

  if (!request.skill) {
    errors.push("skill is required");
  }

  if (!request.prompt) {
    errors.push("prompt is required for quality analysis");
  }

  // Validate tool combination
  if (request.tools && request.tools.length > 0) {
    const validation = validateToolCombination(request.tools);
    if (!validation.valid) {
      errors.push(...validation.conflicts);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Estimate execution time
 * @param {ExecutionRequest} request
 * @returns {{minMs: number, maxMs: number, estimatedMs: number}}
 */
export function estimateExecutionTime(request) {
  const { tools = [], config = {} } = request;
  const maxIterations = config.maxIterations || DEFAULT_ITERATION_CONFIG.maxIterations;

  // Base time per iteration
  const baseTimePerIteration = 5000; // 5s for validation + execution + analysis

  // Tool installation time
  const toolInstallTime = getInstallTimeEstimate(tools);

  // Sandbox creation time
  const sandboxCreationTime = 3000;

  // Per iteration code generation time (if auto-patching)
  const generationTimePerIteration = 8000;

  const minTime = sandboxCreationTime + toolInstallTime + baseTimePerIteration;
  const maxTime = minTime + (baseTimePerIteration + generationTimePerIteration) * (maxIterations - 1);
  const estimated = minTime + (maxTime - minTime) / 2;

  return {
    minMs: minTime,
    maxMs: maxTime,
    estimatedMs: estimated
  };
}

/**
 * Format execution result for client
 * @param {ExecutionResult} result
 * @returns {Object}
 */
export function formatExecutionResult(result) {
  return {
    success: result.success,
    sessionId: result.sessionId,
    finalIteration: result.finalIteration,
    finalScore: result.finalScore,
    qualityLabel: getQualityLabel(result.finalScore),
    stopReason: result.stopReason,
    previewUrl: result.previewUrl,
    artifacts: result.artifacts,
    iterations: result.iterations.map(iter => ({
      iterationNumber: iter.iterationNumber,
      score: iter.score,
      quality: {
        static: iter.quality.static?.score,
        runtime: iter.quality.runtime?.score,
        visual: iter.quality.visual?.score,
        semantic: iter.quality.semantic?.score,
        composite: iter.quality.composite
      },
      patchGoals: iter.patchGoals?.map(g => ({
        category: g.category,
        severity: g.severity,
        description: g.description
      })),
      durationMs: iter.durationMs,
      isFinal: iter.isFinal
    }))
  };
}

/**
 * Get artifact history for a project/session
 * @param {string} projectId - Project identifier
 * @param {object} config - Configuration for artifact storage
 * @returns {Promise<object>} Project history with versions
 */
export async function getProjectArtifactHistory(projectId, config = {}) {
  try {
    const artifactStorage = createArtifactStorage({
      backend: 'filesystem',
      basePath: config.basePath || process.env.ARTIFACTS_PATH || './artifacts'
    });

    const history = await artifactStorage.getProjectHistory(projectId);
    return history || { projectId, versions: [], latest: null };
  } catch (error) {
    console.error(`[API] Error getting project history: ${error.message}`);
    return { projectId, versions: [], latest: null, error: sanitizeError(error, 'version-listing').userMessage };
  }
}

/**
 * Get specific artifact by ID
 * @param {string} artifactId - Artifact identifier
 * @param {object} config - Configuration for artifact storage
 * @returns {Promise<object>} Artifact data with code, metrics, etc
 */
export async function getArtifact(artifactId, config = {}) {
  try {
    const artifactStorage = createArtifactStorage({
      backend: 'filesystem',
      basePath: config.basePath || process.env.ARTIFACTS_PATH || './artifacts'
    });

    const artifact = await artifactStorage.loadArtifact(artifactId);
    if (!artifact) {
      return { error: `Artifact not found: ${artifactId}`, artifactId };
    }

    return artifact;
  } catch (error) {
    console.error(`[API] Error getting artifact: ${error.message}`);
    return { error: sanitizeError(error, 'artifact-save').userMessage, artifactId };
  }
}

/**
 * Get all available projects
 * @param {object} config - Configuration for artifact storage
 * @returns {Promise<Array>} List of project IDs
 */
export async function listProjects(config = {}) {
  try {
    const artifactStorage = createArtifactStorage({
      backend: 'filesystem',
      basePath: config.basePath || process.env.ARTIFACTS_PATH || './artifacts'
    });

    const projects = await artifactStorage.listProjects();
    return projects;
  } catch (error) {
    console.warn(`[API] Error listing projects: ${error.message}`);
    return [];
  }
}

/**
 * Get deduplication statistics
 * @returns {object} Dedup stats { cacheSize, indexCacheSize }
 */
export function getArtifactStats() {
  const artifactStorage = createArtifactStorage({
    backend: 'filesystem',
    basePath: process.env.ARTIFACTS_PATH || './artifacts'
  });

  return artifactStorage.getDeduplicationStats();
}

/**
 * Get system health status
 * @returns {Promise<{healthy: boolean, sandboxAvailable: boolean, dockerAvailable: boolean}>}
 */
export async function getSystemHealth() {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Check Docker
    await execAsync("docker version");

    return {
      healthy: true,
      sandboxAvailable: true,
      dockerAvailable: true
    };
  } catch (error) {
    return {
      healthy: false,
      sandboxAvailable: false,
      dockerAvailable: false,
      error: sanitizeError(error, 'health-check').userMessage
    };
  }
}
