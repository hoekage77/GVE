/**
 * Artifact Storage - Persistent storage for project artifacts and iterations
 * Supports filesystem and S3 backends with deduplication
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generate content hash for deduplication
 * @param {any} content - Content to hash
 * @returns {string} SHA256 hash
 */
function generateContentHash(content) {
  const hashable = typeof content === 'string' ? content : JSON.stringify(content);
  return crypto.createHash('sha256').update(hashable).digest('hex').substring(0, 16);
}

/**
 * ArtifactStorage - Manages artifact persistence and versioning
 * Implements both filesystem and cloud storage backends
 */
class ArtifactStorage {
  /**
   * @param {object} config - Configuration
   * @param {string} config.backend - 'filesystem' or 's3'
   * @param {string} config.basePath - Base directory for filesystem backend
   * @param {object} config.s3Client - AWS S3 client (for s3 backend)
   * @param {string} config.s3Bucket - S3 bucket name
   */
  constructor(config = {}) {
    this.backend = config.backend || 'filesystem';
    this.basePath = config.basePath || './artifacts';
    this.s3Client = config.s3Client || null;
    this.s3Bucket = config.s3Bucket || 'artifacts';
    this.deduplicationCache = new Map(); // hash → artifactId
    this.indexCache = new Map(); // projectId → { versions: [...], latest: ... }
  }

  /**
   * Initialize storage backend (create directories, etc)
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.backend === 'filesystem') {
      try {
        await fs.mkdir(this.basePath, { recursive: true });
        await fs.mkdir(path.join(this.basePath, 'projects'), { recursive: true });
        await fs.mkdir(path.join(this.basePath, 'dedup'), { recursive: true });
      } catch (error) {
        console.error(`[ARTIFACTS] Failed to initialize filesystem: ${error.message}`);
      }
    }
  }

  /**
   * Save project artifact from quality iteration
   * @param {string} projectId - Project/session identifier
   * @param {object} iteration - Iteration data { iterationNumber, code, score, quality, ... }
   * @param {object} buildArtifacts - Build output { totalBytes, files, ... }
   * @param {object} metadata - Additional metadata { timestamp, sessionId, skillId, ... }
   * @returns {Promise<object>} { artifactId, isDuplicate, hash, size, path }
   */
  async saveIteration(projectId, iteration, buildArtifacts = null, metadata = {}) {
    try {
      const artifactId = this._generateArtifactId(projectId, iteration.iterationNumber);
      const hash = generateContentHash(iteration.code);

      // Check deduplication cache
      const cachedArtifactId = this.deduplicationCache.get(hash);
      if (cachedArtifactId) {
        console.log(`[ARTIFACTS] Deduplicating: ${artifactId} → ${cachedArtifactId}`);
        return {
          artifactId,
          isDuplicate: true,
          hash,
          deduplicatedTo: cachedArtifactId,
          size: 0
        };
      }

      // Prepare artifact data
      const artifactData = {
        artifactId,
        projectId,
        iterationNumber: iteration.iterationNumber,
        timestamp: new Date().toISOString(),
        code: iteration.code,
        score: iteration.score,
        quality: iteration.quality,
        patchGoals: iteration.patchGoals,
        durationMs: iteration.durationMs,
        buildArtifacts,
        metadata,
        hash
      };

      // Save based on backend
      let size = 0;
      let storagePath = null;

      if (this.backend === 'filesystem') {
        const result = await this._saveFilesystem(projectId, artifactId, artifactData);
        size = result.size;
        storagePath = result.path;
      } else if (this.backend === 's3') {
        const result = await this._saveS3(projectId, artifactId, artifactData);
        size = result.size;
        storagePath = result.path;
      }

      // Update dedup cache
      this.deduplicationCache.set(hash, artifactId);

      // Update project index
      this._updateProjectIndex(projectId, artifactId, iteration);

      console.log(`[ARTIFACTS] Saved iteration ${iteration.iterationNumber} for ${projectId}: ${artifactId} (${size} bytes)`);

      return {
        artifactId,
        isDuplicate: false,
        hash,
        size,
        path: storagePath
      };
    } catch (error) {
      console.error(`[ARTIFACTS] Error saving iteration: ${error.message}`);
      return {
        artifactId: null,
        error: error.message,
        isDuplicate: false
      };
    }
  }

  /**
   * Retrieve artifact by ID
   * @param {string} artifactId - Artifact identifier
   * @returns {Promise<object>} Artifact data
   */
  async loadArtifact(artifactId) {
    try {
      if (this.backend === 'filesystem') {
        return await this._loadFilesystem(artifactId);
      } else if (this.backend === 's3') {
        return await this._loadS3(artifactId);
      }
    } catch (error) {
      console.error(`[ARTIFACTS] Error loading artifact: ${error.message}`);
      return null;
    }
  }

  /**
   * Get project history
   * @param {string} projectId - Project identifier
   * @returns {Promise<object>} { projectId, versions: [...], latest: { ... } }
   */
  async getProjectHistory(projectId) {
    try {
      // Try cache first
      if (this.indexCache.has(projectId)) {
        return this.indexCache.get(projectId);
      }

      // Load from storage
      let history;
      if (this.backend === 'filesystem') {
        history = await this._loadProjectIndexFilesystem(projectId);
      } else if (this.backend === 's3') {
        history = await this._loadProjectIndexS3(projectId);
      }

      if (history) {
        this.indexCache.set(projectId, history);
      }

      return history;
    } catch (error) {
      console.error(`[ARTIFACTS] Error loading project history: ${error.message}`);
      return { projectId, versions: [], latest: null };
    }
  }

  /**
   * Get all project IDs
   * @returns {Promise<Array<string>>} List of project IDs
   */
  async listProjects() {
    try {
      if (this.backend === 'filesystem') {
        const projectsDir = path.join(this.basePath, 'projects');
        const entries = await fs.readdir(projectsDir);
        return entries.filter(e => !e.startsWith('.')).sort().reverse();
      }
      // S3 backend would list bucket prefixes
      return [];
    } catch (error) {
      console.warn(`[ARTIFACTS] Error listing projects: ${error.message}`);
      return [];
    }
  }

  /**
   * Get deduplication statistics
   * @returns {object} { cacheSize, duplicatesDetected }
   */
  getDeduplicationStats() {
    return {
      cacheSize: this.deduplicationCache.size,
      indexCacheSize: this.indexCache.size
    };
  }

  /**
   * Clear caches (e.g., for testing or cache invalidation)
   */
  clearCache() {
    this.deduplicationCache.clear();
    this.indexCache.clear();
  }

  // ============ FILESYSTEM BACKEND ============

  /**
   * Save artifact to filesystem
   * @private
   */
  async _saveFilesystem(projectId, artifactId, data) {
    const projectDir = path.join(this.basePath, 'projects', projectId);
    await fs.mkdir(projectDir, { recursive: true });

    const artifactFile = path.join(projectDir, `${artifactId}.json`);
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(artifactFile, content, 'utf-8');

    return {
      size: content.length,
      path: artifactFile
    };
  }

  /**
   * Load artifact from filesystem
   * @private
   */
  async _loadFilesystem(artifactId) {
    // Parse artifactId to get projectId
    const projectId = this._extractProjectId(artifactId);
    const projectDir = path.join(this.basePath, 'projects', projectId);
    const artifactFile = path.join(projectDir, `${artifactId}.json`);

    try {
      const content = await fs.readFile(artifactFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
  }

  /**
   * Load project index from filesystem
   * @private
   */
  async _loadProjectIndexFilesystem(projectId) {
    const projectDir = path.join(this.basePath, 'projects', projectId);
    const indexFile = path.join(projectDir, '_index.json');

    try {
      const content = await fs.readFile(indexFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { projectId, versions: [], latest: null };
    }
  }

  /**
   * Update project index file
   * @private
   */
  async _updateProjectIndexFilesystem(projectId, artifactId, iteration) {
    const projectDir = path.join(this.basePath, 'projects', projectId);
    
    // Ensure project directory exists
    try {
      await fs.mkdir(projectDir, { recursive: true });
    } catch (error) {
      console.warn(`[ARTIFACTS] Failed to create project directory: ${error.message}`);
    }

    const indexFile = path.join(projectDir, '_index.json');

    try {
      let index = { projectId, versions: [], latest: null };

      // Try to load existing index
      try {
        const content = await fs.readFile(indexFile, 'utf-8');
        index = JSON.parse(content);
      } catch {
        // New project
      }

      // Add version
      index.versions.push({
        artifactId,
        iterationNumber: iteration.iterationNumber,
        score: iteration.score,
        timestamp: new Date().toISOString(),
        hash: generateContentHash(iteration.code)
      });

      // Update latest
      index.latest = {
        artifactId,
        score: iteration.score,
        iterationNumber: iteration.iterationNumber
      };

      // Write index
      await fs.writeFile(indexFile, JSON.stringify(index, null, 2), 'utf-8');
    } catch (error) {
      console.warn(`[ARTIFACTS] Failed to update project index: ${error.message}`);
    }
  }

  // ============ S3 BACKEND (stub) ============

  /**
   * Save artifact to S3
   * @private
   */
  async _saveS3(projectId, artifactId, data) {
    // TODO: Implement S3 support
    // For now, fall back to filesystem
    return this._saveFilesystem(projectId, artifactId, data);
  }

  /**
   * Load artifact from S3
   * @private
   */
  async _loadS3(artifactId) {
    // TODO: Implement S3 support
    throw new Error('S3 backend not yet implemented');
  }

  /**
   * Load project index from S3
   * @private
   */
  async _loadProjectIndexS3(projectId) {
    // TODO: Implement S3 support
    return { projectId, versions: [], latest: null };
  }

  // ============ HELPERS ============

  /**
   * Generate artifact ID
   * @private
   */
  _generateArtifactId(projectId, iterationNumber) {
    const timestamp = Date.now();
    return `${projectId}-v${iterationNumber}-${timestamp}`;
  }

  /**
   * Extract project ID from artifact ID
   * @private
   */
  _extractProjectId(artifactId) {
    // Format: projectId-vN-timestamp
    const parts = artifactId.split('-v');
    return parts[0];
  }

  /**
   * Update in-memory project index
   * @private
   */
  _updateProjectIndex(projectId, artifactId, iteration) {
    if (!this.indexCache.has(projectId)) {
      this.indexCache.set(projectId, {
        projectId,
        versions: [],
        latest: null
      });
    }

    const index = this.indexCache.get(projectId);
    index.versions.push({
      artifactId,
      iterationNumber: iteration.iterationNumber,
      score: iteration.score,
      timestamp: new Date().toISOString(),
      hash: generateContentHash(iteration.code)
    });

    index.latest = {
      artifactId,
      score: iteration.score,
      iterationNumber: iteration.iterationNumber
    };

    // Also update filesystem if using that backend
    if (this.backend === 'filesystem') {
      this._updateProjectIndexFilesystem(projectId, artifactId, iteration).catch(err => {
        console.warn(`[ARTIFACTS] Failed to persist index: ${err.message}`);
      });
    }
  }
}

/**
 * Create artifact storage instance
 * @param {object} config - Configuration
 * @returns {ArtifactStorage}
 */
export function createArtifactStorage(config = {}) {
  return new ArtifactStorage(config);
}

export { ArtifactStorage };
