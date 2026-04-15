/**
 * Tool Registry - tracks installed tools per sandbox + caching
 */

export class ToolRegistry {
  constructor() {
    // sandboxId → { status: 'installing'|'ready'|'failed', tools: [...], installedAt: number }
    this.sandboxState = new Map();
    
    // Track global statistics
    this.stats = {
      totalInstalls: 0,
      totalCached: 0,
      totalFailed: 0
    };
  }
  
  /**
   * Check if tools are already installed in this sandbox
   * @param {string} sandboxId
   * @param {Array} tools - [{ name: 'three', version: 'latest' }, ...]
   * @returns {boolean}
   */
  isInstalled(sandboxId, tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
      return true; // No tools needed
    }
    
    const state = this.sandboxState.get(sandboxId);
    if (!state || state.status !== 'ready') {
      return false;
    }
    
    return tools.every(tool => 
      state.tools.some(t => 
        t.name === tool.name && t.version === tool.version
      )
    );
  }
  
  /**
   * Mark tools as installed in sandbox
   * @param {string} sandboxId
   * @param {Array} tools
   */
  markInstalled(sandboxId, tools) {
    if (!Array.isArray(tools)) {
      tools = [];
    }
    
    this.sandboxState.set(sandboxId, {
      status: 'ready',
      tools: tools,
      installedAt: Date.now()
    });
    this.stats.totalInstalls++;
  }
  
  /**
   * Mark installation as failed
   * @param {string} sandboxId
   * @param {Error} error
   */
  markFailed(sandboxId, error) {
    this.sandboxState.set(sandboxId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      failedAt: Date.now()
    });
    this.stats.totalFailed++;
  }
  
  /**
   * Record cache hit (tool was already installed)
   */
  recordCacheHit() {
    this.stats.totalCached++;
  }
  
  /**
   * Get installation metrics
   * @returns {object}
   */
  getMetrics() {
    const totalAttempts = this.stats.totalInstalls + this.stats.totalCached;
    const cacheHitRate = totalAttempts > 0
      ? (this.stats.totalCached / totalAttempts) * 100
      : 0;
    
    return {
      totalInstalls: this.stats.totalInstalls,
      totalCached: this.stats.totalCached,
      totalFailed: this.stats.totalFailed,
      totalAttempts: totalAttempts,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100
    };
  }
  
  /**
   * Clear state for a sandbox (e.g., on eviction)
   * @param {string} sandboxId
   */
  clearSandbox(sandboxId) {
    this.sandboxState.delete(sandboxId);
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();
