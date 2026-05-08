/**
 * Client Skill Runner — Browser-based code validation for JS skills.
 *
 * Executes generated code in an isolated iframe using the real browser
 * rendering engine (WebGL/Canvas), captures metrics, and returns results
 * in the same format as the backend sandbox runner-script.js.
 *
 * This is "edge rendering" — validation happens in the user's browser
 * (the ultimate edge) instead of round-tripping to a backend sandbox.
 */

export interface ClientValidationRequest {
  skillId: string;
  code: string;
  timeoutMs?: number;
  maxFrames?: number;
  sessionId?: string;
  /**
   * Optional callback invoked when validation completes.
   * Use this to send results back to the server via WebSocket
   * or any other transport. If not provided, results are only
   * returned via the Promise.
   */
  onResult?: (result: ClientValidationResult) => void;
}

export interface ClientValidationResult {
  success: boolean;
  status: "completed" | "error" | "timeout";
  skillId: string;
  durationMs: number;
  renderCount: number;
  frameCount: number;
  logs: { level: string; message: string; timestamp: string }[];
  summary: { childCount: number; types: string[] };
  error: string | null;
  frameBudgetReached?: boolean;
  sessionId?: string;
}

const VENDOR_URLS: Record<string, string[]> = {
  threejs: ["/vendor/three/three.module.min.js"],
  p5js: ["/vendor/p5/p5.min.js"],
  d3js: ["/vendor/d3/d3.min.js"],
  animejs: ["/vendor/animejs/anime.min.js"]
};

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_FRAMES = 48;

/**
 * Run skill code in a browser iframe and capture validation metrics.
 */
export async function runClientValidation(
  request: ClientValidationRequest
): Promise<ClientValidationResult> {
  const { skillId, code, timeoutMs = DEFAULT_TIMEOUT_MS, maxFrames = DEFAULT_MAX_FRAMES, sessionId, onResult } = request;
  const startedAt = performance.now();

  // Create invisible iframe
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;visibility:hidden;";
  iframe.sandbox = "allow-scripts allow-same-origin";
  iframe.allow = "accelerometer; gyroscope; magnetometer; gamepad";
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument!;
    const win = iframe.contentWindow!;

    // Build iframe HTML with vendor scripts
    const vendorUrls = VENDOR_URLS[skillId] ?? [];
    const vendorScripts = vendorUrls
      .map((url) => `<script src="${url}" crossorigin="anonymous"><\/script>`)
      .join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>body{margin:0;overflow:hidden;background:#0a0a0a;}</style>
</head>
<body>
  <canvas id="canvas" style="display:none;"></canvas>
  <div id="stage" style="display:none;"></div>
  ${vendorScripts}
  <script>
    (function() {
      const logs = [];
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
      };

      function captureLog(level, args) {
        logs.push({
          level,
          message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
          timestamp: new Date().toISOString()
        });
      }

      console.log = (...args) => { captureLog('log', args); originalConsole.log.apply(console, args); };
      console.warn = (...args) => { captureLog('warn', args); originalConsole.warn.apply(console, args); };
      console.error = (...args) => { captureLog('error', args); originalConsole.error.apply(console, args); };
      console.info = (...args) => { captureLog('info', args); originalConsole.info.apply(console, args); };

      const frameQueue = [];
      let renderCount = 0;
      let frameCount = 0;

      // Patch requestAnimationFrame for deterministic frame pumping
      const origRaf = window.requestAnimationFrame;
      window.requestAnimationFrame = function(callback) {
        frameQueue.push(callback);
        return frameQueue.length;
      };

      // Patch setTimeout for animation-like callbacks
      const origSetTimeout = window.setTimeout;
      window.setTimeout = function(callback, delay) {
        if (typeof callback === 'function' && delay < 50) {
          frameQueue.push(callback);
          return frameQueue.length;
        }
        return origSetTimeout.apply(window, arguments);
      };

      // Patch performance.now for consistent timing
      const timeBase = performance.now();
      window.performance = { now: () => performance.now() - timeBase };

      // Wait for vendor scripts to load, then execute
      window.addEventListener('load', function() {
        // Give vendor scripts a moment to initialize
        setTimeout(function() {
          try {
            // Skill-specific setup
            if (${JSON.stringify(skillId)} === 'threejs' && window.THREE) {
              const scene = new THREE.Scene();
              const camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 1000);
              const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('canvas') });
              camera.position.set(2.5, 2, 3.5);
              camera.lookAt(0, 0, 0);
              renderer.setPixelRatio(1);
              renderer.setSize(1280, 720);

              // Monkey-patch render to count calls and capture scene
              const origRender = renderer.render.bind(renderer);
              renderer.render = function(s, c) {
                renderCount++;
                window.__lastScene = s;
                return origRender(s, c);
              };

              window.THREE = window.THREE || {};
              window.scene = scene;
              window.camera = camera;
              window.renderer = renderer;
            }

            if (${JSON.stringify(skillId)} === 'p5js' && window.p5) {
              // p5js setup is handled by the code itself
            }

            if (${JSON.stringify(skillId)} === 'd3js' && window.d3) {
              window.d3 = window.d3;
            }

            if (${JSON.stringify(skillId)} === 'animejs' && window.anime) {
              window.anime = window.anime;
            }

            // Execute user code
            const __userScript = document.createElement('script');
            __userScript.textContent = ${JSON.stringify(code)};
            document.head.appendChild(__userScript);

            // Pump frames
            let pumped = 0;
            const maxPump = ${maxFrames};
            const pumpDeadline = ${timeoutMs};
            const pumpStart = performance.now();

            while (frameQueue.length > 0 && pumped < maxPump) {
              if (performance.now() - pumpStart > pumpDeadline) break;
              const cb = frameQueue.shift();
              try { cb(frameCount); } catch(e) { console.error(e); }
              pumped++;
              frameCount++;
            }

            // Build scene summary
            let summary = { childCount: 0, types: [] };
            if (window.__lastScene && window.__lastScene.children) {
              summary = {
                childCount: window.__lastScene.children.length,
                types: window.__lastScene.children.slice(0, 8).map(c => c?.type || c?.constructor?.name || 'unknown')
              };
            } else if (window.scene && window.scene.children) {
              summary = {
                childCount: window.scene.children.length,
                types: window.scene.children.slice(0, 8).map(c => c?.type || c?.constructor?.name || 'unknown')
              };
            }

            const timedOut = performance.now() - pumpStart > pumpDeadline;
            const budgetReached = pumped >= maxPump;

            window.parent.postMessage({
              type: 'client:validation_result',
              payload: {
                success: true,
                status: timedOut ? 'timeout' : 'completed',
                skillId: ${JSON.stringify(skillId)},
                durationMs: Math.round(performance.now() - ${startedAt}),
                renderCount,
                frameCount,
                logs,
                summary,
                error: null,
                frameBudgetReached: budgetReached
              }
            }, '*');
          } catch (err) {
            window.parent.postMessage({
              type: 'client:validation_result',
              payload: {
                success: false,
                status: 'error',
                skillId: ${JSON.stringify(skillId)},
                durationMs: Math.round(performance.now() - ${startedAt}),
                renderCount,
                frameCount,
                logs,
                summary: { childCount: 0, types: [] },
                error: err?.message || String(err)
              }
            }, '*');
          }
        }, 100);
      });
    })();
  <\/script>
</body>
</html>`;

    doc.open();
    doc.write(html);
    doc.close();

    // Wait for result or timeout
    return new Promise<ClientValidationResult>((resolve) => {
      const resolveWithResult = (result: ClientValidationResult) => {
        const enriched = { ...result, sessionId };
        onResult?.(enriched);
        resolve(enriched);
      };

      const timeoutId = setTimeout(() => {
        resolveWithResult({
          success: false,
          status: "timeout",
          skillId,
          durationMs: Math.round(performance.now() - startedAt),
          renderCount: 0,
          frameCount: 0,
          logs: [{ level: "error", message: "Client validation timed out", timestamp: new Date().toISOString() }],
          summary: { childCount: 0, types: [] },
          error: "Client validation timed out"
        });
      }, timeoutMs + 500);

      const handler = (event: MessageEvent) => {
        if (event.data?.type === "client:validation_result") {
          clearTimeout(timeoutId);
          window.removeEventListener("message", handler);
          resolveWithResult(event.data.payload as ClientValidationResult);
        }
      };

      window.addEventListener("message", handler);
    });
  } finally {
    // Cleanup iframe after a brief delay to let postMessage complete
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, timeoutMs + 1000);
  }
}