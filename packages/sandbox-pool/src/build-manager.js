/**
 * BuildManager - handles project builds within Daytona sandboxes
 * Supports Vite, Webpack, Rollup with skill-specific configurations
 */

import path from 'path';

/**
 * BuildManager class for executing builds in sandboxes
 * @class BuildManager
 */
class BuildManager {
  /**
   * @param {object} sandbox - Daytona sandbox instance
   * @param {object} workspace - workspace.process accessor
   * @param {object} filesystem - SandboxFileSystem instance
   */
  constructor(sandbox, workspace, filesystem) {
    this.sandbox = sandbox;
    this.workspace = workspace;
    this.filesystem = filesystem;
  }

  /**
   * Determine builder for skill
   * @param {string} skillId - Skill identifier (threejs, p5js, d3js, etc)
   * @returns {string} Builder name (vite, webpack, rollup, none)
   */
  getBuilderForSkill(skillId) {
    const skillBuilders = {
      threejs: 'vite',
      babylon: 'vite',
      p5js: 'vite',
      'p5.js': 'vite',
      d3: 'rollup',
      d3js: 'rollup',
      plotly: 'webpack',
      'chart.js': 'webpack',
      chartjs: 'webpack',
      gsap: 'vite',
      animation: 'vite',
      manim: 'none', // Python-based, no JS build
      mermaid: 'vite',
    };
    return skillBuilders[skillId] || 'vite'; // Default to Vite
  }

  /**
   * Get build configuration template for skill
   * @param {string} skillId - Skill identifier
   * @returns {object} Vite/Webpack config template
   */
  getBuildConfig(skillId) {
    const builder = this.getBuilderForSkill(skillId);

    if (builder === 'vite') {
      return this.getViteConfig(skillId);
    } else if (builder === 'rollup') {
      return this.getRollupConfig(skillId);
    } else if (builder === 'webpack') {
      return this.getWebpackConfig(skillId);
    }
    return null;
  }

  /**
   * Vite configuration template
   * @param {string} skillId - Skill identifier
   * @returns {object} Vite config
   */
  getViteConfig(skillId) {
    return {
      name: 'vite.config.js',
      content: `import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'index.js'),
      name: '${skillId}',
      formats: ['iife'],
      fileName: (format) => '${skillId}-bundle.js'
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        passes: 2
      }
    },
    reportCompressedSize: true,
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        globals: {}
      }
    }
  },
  define: {
    'process.env.NODE_ENV': '\\"production\\"'
  }
});`,
    };
  }

  /**
   * Rollup configuration template
   * @param {string} skillId - Skill identifier
   * @returns {object} Rollup config
   */
  getRollupConfig(skillId) {
    return {
      name: 'rollup.config.js',
      content: `import { terser } from 'rollup-plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'index.js',
  external: [],
  plugins: [
    resolve({ browser: true, preferBuiltins: false }),
    commonjs(),
    terser({
      compress: { drop_console: false, passes: 2 },
      mangle: true
    })
  ],
  output: {
    file: 'dist/${skillId}-bundle.js',
    format: 'iife',
    name: '${skillId}'
  }
};`,
    };
  }

  /**
   * Webpack configuration template
   * @param {string} skillId - Skill identifier
   * @returns {object} Webpack config
   */
  getWebpackConfig(skillId) {
    return {
      name: 'webpack.config.js',
      content: `const TerserPlugin = require('terser-webpack-plugin');
const path = require('path');

module.exports = {
  mode: 'production',
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '${skillId}-bundle.js',
    libraryTarget: 'iife',
    library: '${skillId}'
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: { drop_console: false, passes: 2 },
          mangle: true
        }
      })
    ]
  },
  module: {
    rules: [
      {
        test: /\\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [['@babel/preset-env', { targets: 'last 2 versions' }]]
          }
        }
      }
    ]
  }
};`,
    };
  }

  /**
   * Analyze build output and extract metrics
   * @param {string} distDir - Path to dist directory in sandbox
   * @returns {Promise<object>} Build metrics { totalBytes, gzipBytes, files, largest }
   */
  async analyzeBuildOutput(distDir = 'dist') {
    try {
      // List files in dist directory
      const { stdout } = await this.workspace.process.executeCommand(
        `find "${distDir}" -type f \\( -name "*.js" -o -name "*.css" -o -name "*.wasm" \\) 2>/dev/null | head -100`,
        { shell: '/bin/bash' }
      );

      const files = stdout.trim().split('\n').filter((f) => f.length > 0);
      if (files.length === 0) {
        return { totalBytes: 0, gzipBytes: 0, files: [], largest: null, error: 'No build artifacts found' };
      }

      // Get file sizes
      let totalBytes = 0;
      const fileSizes = [];

      for (const file of files) {
        const { stdout: sizeOutput } = await this.workspace.process.executeCommand(
          `wc -c < "${file}" 2>/dev/null || echo 0`,
          { shell: '/bin/bash' }
        );
        const bytes = parseInt(sizeOutput.trim()) || 0;
        const filename = path.basename(file);

        fileSizes.push({ filename, path: file, bytes });
        totalBytes += bytes;
      }

      // Sort by size
      fileSizes.sort((a, b) => b.bytes - a.bytes);

      // Calculate gzip estimate (typically 20-30% of original for JS)
      const gzipBytes = Math.ceil(totalBytes * 0.25);

      return {
        totalBytes,
        gzipBytes,
        files: fileSizes,
        largest: fileSizes[0] || null,
        fileCount: files.length,
        metrics: {
          minified: totalBytes < 500 * 1024, // Under 500KB
          small: totalBytes < 250 * 1024, // Under 250KB
          tiny: totalBytes < 50 * 1024, // Under 50KB
        },
      };
    } catch (error) {
      return {
        totalBytes: 0,
        gzipBytes: 0,
        files: [],
        largest: null,
        error: error.message,
      };
    }
  }

  /**
   * Execute build command
   * @param {string} command - Build command (vite build, webpack, rollup -c)
   * @param {object} options - { cwd, timeout, env }
   * @returns {Promise<object>} BuildResult { success, command, stdout, stderr, duration, artifacts }
   */
  async executeBuild(command, options = {}) {
    const { cwd = '.', timeout = 60000, env = {} } = options;

    const startTime = Date.now();

    try {
      const { stdout, stderr, exitCode } = await this.workspace.process.executeCommand(command, {
        cwd,
        timeout,
        shell: '/bin/bash',
        env: { ...process.env, ...env, NODE_ENV: 'production' },
      });

      const duration = Date.now() - startTime;
      const success = exitCode === 0;

      if (success) {
        // Analyze build output
        const artifacts = await this.analyzeBuildOutput(`${cwd}/dist`);

        return {
          success: true,
          command,
          duration,
          stdout: stdout.substring(0, 2000), // Truncate long output
          stderr: stderr.substring(0, 500),
          exitCode,
          artifacts,
        };
      } else {
        return {
          success: false,
          command,
          duration,
          stdout: stdout.substring(0, 1000),
          stderr: stderr.substring(0, 1000),
          exitCode,
          artifacts: null,
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        command,
        duration,
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        artifacts: null,
      };
    }
  }

  /**
   * Full build pipeline: write config, install deps, run build, analyze
   * @param {string} skillId - Skill identifier
   * @param {object} options - { entryPoint, installDeps, timeout }
   * @returns {Promise<object>} Full BuildOutput
   */
  async build(skillId, options = {}) {
    const { entryPoint = 'index.js', installDeps = true, timeout = 60000 } = options;

    try {
      const builder = this.getBuilderForSkill(skillId);

      if (builder === 'none') {
        return {
          success: false,
          reason: 'no-build-needed',
          message: `Skill ${skillId} does not require building`,
        };
      }

      // Step 1: Write build config
      const buildConfig = this.getBuildConfig(skillId);
      if (!buildConfig) {
        return {
          success: false,
          reason: 'no-config',
          message: `No build config found for skill ${skillId}`,
        };
      }

      await this.filesystem.writeFile(buildConfig.name, buildConfig.content);

      // Step 2: Install dependencies if requested
      let installOutput = null;
      if (installDeps) {
        const deps = this.getDependencies(skillId, builder);
        if (deps && deps.length > 0) {
          const { stdout, stderr, exitCode } = await this.workspace.process.executeCommand(
            `npm install ${deps.join(' ')} 2>&1`,
            { shell: '/bin/bash', timeout: 120000 }
          );
          installOutput = { stdout, stderr, success: exitCode === 0 };
        }
      }

      // Step 3: Run build
      const buildCommand = this.getBuildCommand(builder);
      const buildResult = await this.executeBuild(buildCommand, { timeout });

      return {
        success: buildResult.success,
        builder,
        installOutput,
        buildResult,
        command: buildCommand,
        artifacts: buildResult.artifacts,
      };
    } catch (error) {
      return {
        success: false,
        reason: 'error',
        message: error.message,
      };
    }
  }

  /**
   * Get build command for builder
   * @param {string} builder - Builder name (vite, webpack, rollup)
   * @returns {string} Build command
   */
  getBuildCommand(builder) {
    const commands = {
      vite: 'npx vite build 2>&1 || echo "Vite build failed"',
      webpack: 'npx webpack 2>&1 || echo "Webpack build failed"',
      rollup: 'npx rollup -c rollup.config.js 2>&1 || echo "Rollup build failed"',
    };
    return commands[builder] || 'npm run build 2>&1';
  }

  /**
   * Get build dependencies for skill + builder
   * @param {string} skillId - Skill identifier
   * @param {string} builder - Builder name
   * @returns {Array<string>} NPM packages to install
   */
  getDependencies(skillId, builder) {
    const baseDeps = {
      vite: ['vite@latest', 'terser@latest'],
      webpack: ['webpack@latest', 'webpack-cli@latest', 'terser-webpack-plugin@latest', 'babel-loader@latest', '@babel/core@latest', '@babel/preset-env@latest'],
      rollup: ['rollup@latest', 'rollup-plugin-terser@latest', '@rollup/plugin-node-resolve@latest', '@rollup/plugin-commonjs@latest'],
    };

    const skillDeps = {
      threejs: ['three@latest'],
      babylon: ['babylonjs@latest'],
      p5js: ['p5@latest'],
      'd3.js': ['d3@latest'],
      plotly: ['plotly.js@latest'],
      'chart.js': ['chart.js@latest'],
      gsap: ['gsap@latest'],
    };

    const deps = [...(baseDeps[builder] || []), ...(skillDeps[skillId] || [])];
    return deps;
  }
}

/**
 * Factory function
 * @param {object} sandbox - Daytona sandbox instance
 * @param {object} workspace - workspace.process accessor
 * @param {object} filesystem - SandboxFileSystem instance
 * @returns {BuildManager}
 */
function createBuildManager(sandbox, workspace, filesystem) {
  return new BuildManager(sandbox, workspace, filesystem);
}

export { BuildManager, createBuildManager };
