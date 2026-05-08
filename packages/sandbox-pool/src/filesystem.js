/**
 * SandboxFileSystem - Manages file operations within Daytona sandboxes
 * Provides consistent API for multi-file project support
 */

export class SandboxFileSystem {
  constructor(sandboxId, workspace) {
    this.sandboxId = sandboxId;
    this.workspace = workspace;
    this.fileCache = new Map(); // path → { content, timestamp }
    this.dirCache = new Set(); // Set of created directories
  }

  /**
   * Write a file to the sandbox filesystem
   * @param {string} path - File path (e.g., 'index.js', 'src/utils.js')
   * @param {string} content - File content
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async writeFile(path, content) {
    if (!path || typeof content !== 'string') {
      return { success: false, error: 'Invalid path or content' };
    }

    try {
      // Extract directory from path
      const pathParts = path.split('/');
      const fileName = pathParts[pathParts.length - 1];
      const dirPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : null;

      // Create parent directories if needed
      if (dirPath && !this.dirCache.has(dirPath)) {
        const mkdirCmd = `mkdir -p "${dirPath}"`;
        await this.workspace.process.executeCommand(mkdirCmd);
        this.dirCache.add(dirPath);
      }

      // Escape content for shell command
      const escapedContent = this._escapeShellString(content);
      const writeCmd = `cat > "${path}" << 'EOF'\n${content}\nEOF`;

      await this.workspace.process.executeCommand(writeCmd);

      // Cache the file
      this.fileCache.set(path, {
        content,
        timestamp: Date.now()
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Read a file from the sandbox
   * @param {string} path - File path
   * @returns {Promise<{success: boolean, content?: string, error?: string}>}
   */
  async readFile(path) {
    if (!path) {
      return { success: false, error: 'Invalid path' };
    }

    try {
      // Check cache first
      if (this.fileCache.has(path)) {
        const cached = this.fileCache.get(path);
        if (Date.now() - cached.timestamp < 5000) { // 5s cache TTL
          return { success: true, content: cached.content };
        }
      }

      // Read from sandbox
      const readCmd = `cat "${path}" 2>/dev/null || echo ""`;
      const result = await this.workspace.process.executeCommand(readCmd);
      const content = String(result?.stdout ?? result?.result ?? result ?? '');

      // Cache it
      this.fileCache.set(path, {
        content,
        timestamp: Date.now()
      });

      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check if a file exists
   * @param {string} path - File path
   * @returns {Promise<boolean>}
   */
  async fileExists(path) {
    if (!path) return false;

    try {
      const cmd = `test -f "${path}" && echo "yes" || echo "no"`;
      const result = await this.workspace.process.executeCommand(cmd);
      return String(result?.stdout ?? result?.result ?? result).trim() === 'yes';
    } catch {
      return false;
    }
  }

  /**
   * List files in a directory
   * @param {string} path - Directory path (default: '.')
   * @returns {Promise<{success: boolean, files?: Array, error?: string}>}
   */
  async listDir(path = '.') {
    try {
      const cmd = `find "${path}" -type f -o -type d | sort`;
      const result = await this.workspace.process.executeCommand(cmd);
      const output = String(result?.stdout ?? result?.result ?? result ?? '');
      const lines = output.split('\n').filter(l => l.trim());

      return {
        success: true,
        files: lines.map(line => ({
          path: line,
          isDir: line.endsWith('/') || false
        }))
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Calculate total size of files
   * @param {Array<string>} paths - List of file paths
   * @returns {Promise<{totalBytes: number, files: Object}>}
   */
  async calculateSize(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
      return { totalBytes: 0, files: {} };
    }

    try {
      const fileInfo = {};
      let totalBytes = 0;

      for (const path of paths) {
        const cmd = `stat -f%z "${path}" 2>/dev/null || stat -c%s "${path}" 2>/dev/null || echo 0`;
        const result = await this.workspace.process.executeCommand(cmd);
        const raw = String(result?.stdout ?? result?.result ?? result ?? '0');
        const bytes = parseInt(raw, 10) || 0;
        fileInfo[path] = bytes;
        totalBytes += bytes;
      }

      return { totalBytes, files: fileInfo };
    } catch {
      return { totalBytes: 0, files: {} };
    }
  }

  /**
   * Delete a file
   * @param {string} path - File path
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteFile(path) {
    if (!path) {
      return { success: false, error: 'Invalid path' };
    }

    try {
      await this.workspace.process.executeCommand(`rm -f "${path}"`);
      this.fileCache.delete(path);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Clear all files in a directory
   * @param {string} path - Directory path
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async clearDir(path = '.') {
    try {
      await this.workspace.process.executeCommand(`rm -rf "${path}"/*`);
      this.fileCache.clear();
      this.dirCache.clear();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Write multiple files atomically
   * @param {Array<{path: string, content: string}>} files
   * @returns {Promise<{success: boolean, written: number, failed: number, errors: Object}>}
   */
  async writeMultiple(files) {
    if (!Array.isArray(files)) {
      return { success: false, written: 0, failed: 0, errors: {} };
    }

    let written = 0;
    let failed = 0;
    const errors = {};

    for (const file of files) {
      const result = await this.writeFile(file.path, file.content);
      if (result.success) {
        written++;
      } else {
        failed++;
        errors[file.path] = result.error;
      }
    }

    return {
      success: failed === 0,
      written,
      failed,
      errors
    };
  }

  /**
   * Helper: Escape shell string
   * @private
   */
  _escapeShellString(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/$/g, '\\$')
      .replace(/`/g, '\\`');
  }

  /**
   * Clear caches
   */
  clearCache() {
    this.fileCache.clear();
  }
}

/**
 * Factory function to create filesystem for a sandbox
 * @param {string} sandboxId - Sandbox workspace ID
 * @param {object} workspace - Daytona workspace object
 * @returns {SandboxFileSystem}
 */
export function createSandboxFileSystem(sandboxId, workspace) {
  return new SandboxFileSystem(sandboxId, workspace);
}
