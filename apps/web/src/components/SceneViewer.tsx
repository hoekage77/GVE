import { useEffect, useRef, useState, useCallback } from "react";
import {
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertTriangle,
  Monitor,
  ChevronRight,
  Plug2,
  Minus,
  Plus,
  Compass,
  RotateCcw,
  Wand2
} from "lucide-react";

interface SceneViewerProps {
  code: string | null;
  skill: string | null;
  onError?: (error: string) => void;
  allowDarkBackground?: boolean;
  onNaturalLanguageEdit?: (instruction: string) => Promise<{ ok: boolean; message: string }>;
  isApplyingEdit?: boolean;
}

const CDN_URLS: Record<string, string[]> = {
  threejs: [
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/examples/js/controls/OrbitControls.min.js"
  ],
  p5js: [
    "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"
  ],
  d3js: [
    "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"
  ],
  animejs: [
    "https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js"
  ]
};

function buildThreeJsBootstrap(): string {
  return `
    const scene = new THREE.Scene();
    // Use a light neutral backdrop by default for readability and product consistency.
    scene.background = new THREE.Color(0xf4f7fb);
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(2.5, 2, 3.5);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setClearColor(0xf4f7fb, 1);
    document.body.appendChild(renderer.domElement);
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#f4f7fb';

    scene.add(new THREE.AmbientLight(0x404060, 0.6));
    
    // Using an IIFE to avoid polluting the top-level script scope with light variables
    (() => {
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
      dirLight.position.set(5, 8, 5);
      scene.add(dirLight);
    })();

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    let __gveOrbitControls = null;
    let __gveOrbitFrame = null;
    let __gveOrbitEnabled = true;
    let __gveInitialCameraState = null;

    const __gveCaptureCameraState = () => {
      if (__gveInitialCameraState) {
        return;
      }
      __gveInitialCameraState = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        zoom: camera.zoom
      };
    };

    const __gveTickOrbit = () => {
      if (__gveOrbitControls && __gveOrbitEnabled) {
        __gveOrbitControls.update();
      }
      __gveOrbitFrame = requestAnimationFrame(__gveTickOrbit);
    };

    const __gveEnsureOrbitControls = () => {
      if (__gveOrbitControls || !THREE.OrbitControls) {
        return __gveOrbitControls;
      }

      __gveOrbitControls = new THREE.OrbitControls(camera, renderer.domElement);
      __gveOrbitControls.enableDamping = true;
      __gveOrbitControls.dampingFactor = 0.08;
      __gveOrbitControls.enablePan = true;
      __gveOrbitControls.minDistance = 0.75;
      __gveOrbitControls.maxDistance = 48;
      __gveOrbitControls.target.set(0, 0, 0);
      __gveOrbitControls.update();

      if (!__gveOrbitFrame) {
        __gveOrbitFrame = requestAnimationFrame(__gveTickOrbit);
      }

      return __gveOrbitControls;
    };

    window.__gveSceneControls = {
      captureCameraState: __gveCaptureCameraState,
      ensureOrbitControls: __gveEnsureOrbitControls,
      setOrbitEnabled: (enabled) => {
        __gveOrbitEnabled = Boolean(enabled);
        if (__gveOrbitControls) {
          __gveOrbitControls.enabled = __gveOrbitEnabled;
        }
        return __gveOrbitEnabled;
      },
      getOrbitEnabled: () => __gveOrbitEnabled,
      zoom: (factor) => {
        const safeFactor = Number.isFinite(factor) ? factor : 1;
        camera.position.multiplyScalar(safeFactor);
        if (__gveOrbitControls) {
          __gveOrbitControls.update();
        }
      },
      resetCamera: () => {
        if (!__gveInitialCameraState) {
          return;
        }

        camera.position.copy(__gveInitialCameraState.position);
        camera.quaternion.copy(__gveInitialCameraState.quaternion);
        camera.zoom = __gveInitialCameraState.zoom;
        camera.updateProjectionMatrix();

        if (__gveOrbitControls) {
          __gveOrbitControls.target.set(0, 0, 0);
          __gveOrbitControls.update();
        }
      },
      dispose: () => {
        if (__gveOrbitFrame) {
          cancelAnimationFrame(__gveOrbitFrame);
          __gveOrbitFrame = null;
        }
        if (__gveOrbitControls && typeof __gveOrbitControls.dispose === 'function') {
          __gveOrbitControls.dispose();
        }
      }
    };

    __gveCaptureCameraState();
  `;
}

function buildP5JsBootstrap(): string {
  return `
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#f4f7fb';
    document.body.style.display = 'flex';
    document.body.style.alignItems = 'center';
    document.body.style.justifyContent = 'center';
    document.body.style.minHeight = '100vh';
  `;
}

function buildD3JsBootstrap(): string {
  return `
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#f4f7fb';
    document.body.style.color = '#1f2937';
    document.body.style.fontFamily = "'Inter', system-ui, sans-serif";
    document.body.style.display = 'flex';
    document.body.style.alignItems = 'center';
    document.body.style.justifyContent = 'center';
    document.body.style.minHeight = '100vh';
  `;
}

function buildAnimeJsBootstrap(): string {
  return `
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.background = '#f4f7fb';
    document.body.style.color = '#1f2937';
    document.body.style.fontFamily = "'Inter', system-ui, sans-serif";

    const existingStage = document.getElementById('stage');
    const stage = existingStage || document.createElement('div');
    stage.id = 'stage';
    stage.style.width = '100vw';
    stage.style.height = '100vh';
    stage.style.position = 'relative';
    stage.style.display = 'flex';
    stage.style.alignItems = 'center';
    stage.style.justifyContent = 'center';

    if (!existingStage) {
      document.body.appendChild(stage);
    }
  `;
}

function buildThreeJsBackgroundGuard(allowDarkBackground: boolean): string {
  return `
    const __gveAllowDarkBackground = ${allowDarkBackground ? "true" : "false"};
    const __gveLightBackgroundHex = 0xf4f7fb;

    const __gveHexToRgb = (hex) => ({
      r: (hex >> 16) & 255,
      g: (hex >> 8) & 255,
      b: hex & 255
    });

    const __gveParseColor = (value) => {
      if (value == null) return null;

      if (typeof value === "number" && Number.isFinite(value)) {
        return __gveHexToRgb(value >>> 0);
      }

      if (typeof value === "string") {
        const normalized = value.trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
          const hex = normalized.slice(1);
          const expanded = hex.length === 3
            ? hex.split("").map((char) => char + char).join("")
            : hex;
          return __gveHexToRgb(Number.parseInt(expanded, 16));
        }

        const rgbMatch = normalized.match(/rgba?\(([^)]+)\)/i);
        if (rgbMatch) {
          const [r = 0, g = 0, b = 0] = rgbMatch[1]
            .split(",")
            .map((part) => Number.parseFloat(part.trim()));
          return { r, g, b };
        }

        return null;
      }

      if (typeof value === "object") {
        if (typeof value.r === "number" && typeof value.g === "number" && typeof value.b === "number") {
          const scale = value.r <= 1 && value.g <= 1 && value.b <= 1 ? 255 : 1;
          return {
            r: value.r * scale,
            g: value.g * scale,
            b: value.b * scale
          };
        }

        if (typeof value.getHex === "function") {
          try {
            return __gveHexToRgb(value.getHex() >>> 0);
          } catch {
            return null;
          }
        }
      }

      return null;
    };

    const __gveIsNearBlack = (r, g, b) => {
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return luminance <= 0.12;
    };

    const __gveApplyBackgroundGuard = () => {
      if (__gveAllowDarkBackground || typeof THREE === "undefined") {
        return;
      }

      try {
        if (typeof renderer !== "undefined" && renderer && typeof renderer.setClearColor === "function") {
          if (!renderer.__gvePatchedSetClearColor) {
            const __gveOriginalSetClearColor = renderer.setClearColor.bind(renderer);
            renderer.setClearColor = (inputColor, alpha = 1) => {
              const parsed = __gveParseColor(inputColor);
              if (parsed && __gveIsNearBlack(parsed.r, parsed.g, parsed.b)) {
                return __gveOriginalSetClearColor(__gveLightBackgroundHex, alpha);
              }
              return __gveOriginalSetClearColor(inputColor, alpha);
            };
            renderer.__gvePatchedSetClearColor = true;
          }

          renderer.setClearColor(__gveLightBackgroundHex, 1);
        }
      } catch {
        // no-op; guard should never crash scene execution
      }

      try {
        if (typeof scene !== "undefined" && scene) {
          const parsed = __gveParseColor(scene.background);
          if (!scene.background || (parsed && __gveIsNearBlack(parsed.r, parsed.g, parsed.b))) {
            scene.background = new THREE.Color(__gveLightBackgroundHex);
          }
        }
      } catch {
        // no-op; guard should never crash scene execution
      }

      try {
        document.body.style.background = "#f4f7fb";
      } catch {
        // no-op
      }
    };

    __gveApplyBackgroundGuard();
  `;
}

function buildIframeContent(code: string, skill: string, allowDarkBackground: boolean): string {
  const scripts = CDN_URLS[skill] ?? CDN_URLS.threejs;
  const scriptTags = scripts.map(url => `<script src="${url}"><\/script>`).join("\n    ");

  let bootstrap = "";
  if (skill === "threejs") bootstrap = buildThreeJsBootstrap();
  else if (skill === "p5js") bootstrap = buildP5JsBootstrap();
  else if (skill === "d3js") bootstrap = buildD3JsBootstrap();
  else if (skill === "animejs") bootstrap = buildAnimeJsBootstrap();

  const runtimeGuard = skill === "threejs" ? buildThreeJsBackgroundGuard(allowDarkBackground) : "";
  const postRunGuardCall = skill === "threejs" ? "__gveApplyBackgroundGuard();" : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #f4f7fb; overflow: hidden; color: #1f2937; }
      canvas { display: block; }
    </style>
    <script>
      // Suppress noisy Three.js warning about deprecated CDN files to keep user logs clean
      const __origWarn = console.warn;
      console.warn = function(...args) {
        if (typeof args[0] === 'string' && args[0].includes('deprecated with r150+')) return;
        __origWarn.apply(console, args);
      };
    <\/script>
    ${scriptTags}
  </head>
  <body>
    <script>
      window.onerror = function(msg, url, line, col, error) {
        window.parent.postMessage({
          type: 'scene:error',
          message: String(msg),
          line: line,
          column: col
        }, '*');
        return true;
      };

      const __gveReadContext = () => {
        return {
          scene: typeof scene !== 'undefined' ? scene : null,
          camera: typeof camera !== 'undefined' ? camera : null,
          renderer: typeof renderer !== 'undefined' ? renderer : null,
          THREE: typeof THREE !== 'undefined' ? THREE : null,
          anime: typeof anime !== 'undefined' ? anime : null,
          d3: typeof d3 !== 'undefined' ? d3 : null,
          p5: typeof p5 !== 'undefined' ? p5 : null,
          stage: document.getElementById('stage')
        };
      };

      const __gveAck = (command, ok, message, extras = {}) => {
        window.parent.postMessage({
          type: 'scene:control:ack',
          command,
          ok,
          message,
          ...extras
        }, '*');
      };

      const __gveApplyControl = (payload = {}) => {
        const command = payload.command;
        const ctx = __gveReadContext();
        const controls = window.__gveSceneControls || null;

        switch (command) {
          case 'zoom_in': {
            if (!ctx.camera || typeof ctx.camera.position?.multiplyScalar !== 'function') {
              __gveAck(command, false, 'Camera controls are unavailable for this scene.');
              return;
            }
            controls?.zoom?.(0.88);
            __gveAck(command, true, 'Zoomed in.');
            return;
          }
          case 'zoom_out': {
            if (!ctx.camera || typeof ctx.camera.position?.multiplyScalar !== 'function') {
              __gveAck(command, false, 'Camera controls are unavailable for this scene.');
              return;
            }
            controls?.zoom?.(1.14);
            __gveAck(command, true, 'Zoomed out.');
            return;
          }
          case 'reset_camera': {
            if (controls?.resetCamera) {
              controls.resetCamera();
              __gveAck(command, true, 'Camera reset.');
              return;
            }
            __gveAck(command, false, 'Camera reset is unavailable for this scene.');
            return;
          }
          case 'toggle_orbit': {
            if (!controls?.ensureOrbitControls || !controls?.setOrbitEnabled) {
              __gveAck(command, false, 'Orbit controls are unavailable for this scene.');
              return;
            }

            controls.ensureOrbitControls();
            const next = controls.setOrbitEnabled(
              typeof payload.enabled === 'boolean' ? payload.enabled : !controls.getOrbitEnabled()
            );
            __gveAck(command, true, next ? 'Orbit controls enabled.' : 'Orbit controls disabled.', {
              enabled: next
            });
            return;
          }
          case 'run_command': {
            const script = String(payload.script || '').trim();
            if (!script) {
              __gveAck(command, false, 'No command provided.');
              return;
            }

            const executor = new Function(
              'scene',
              'camera',
              'renderer',
              'THREE',
              'anime',
              'd3',
              'p5',
              'stage',
              script
            );

            executor(ctx.scene, ctx.camera, ctx.renderer, ctx.THREE, ctx.anime, ctx.d3, ctx.p5, ctx.stage);
            __gveAck(command, true, 'Command applied.');
            return;
          }
          default:
            __gveAck(command || 'unknown', false, 'Unsupported control command.');
        }
      };

      window.addEventListener('message', (event) => {
        if (!event?.data || event.data.type !== 'scene:control') {
          return;
        }

        try {
          __gveApplyControl(event.data.payload || {});
        } catch (error) {
          window.parent.postMessage({
            type: 'scene:error',
            message: error?.message || String(error)
          }, '*');
        }
      });

      try {
        ${bootstrap}
        ${runtimeGuard}
        ${code}
        ${postRunGuardCall}

        if (window.__gveSceneControls?.captureCameraState) {
          window.__gveSceneControls.captureCameraState();
        }
        if (window.__gveSceneControls?.ensureOrbitControls) {
          window.__gveSceneControls.ensureOrbitControls();
        }

        window.parent.postMessage({ type: 'scene:ready' }, '*');
      } catch (err) {
        window.parent.postMessage({
          type: 'scene:error',
          message: err.message || String(err)
        }, '*');
      }
    <\/script>
  </body>
</html>`;
}

export default function SceneViewer({
  code,
  skill,
  onError,
  allowDarkBackground = false,
  onNaturalLanguageEdit,
  isApplyingEdit = false
}: SceneViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadingTimeoutRef = useRef<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [controlFeedback, setControlFeedback] = useState<string | null>(null);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  const postControl = useCallback((command: string, payload: Record<string, unknown> = {}) => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) {
      return;
    }

    frameWindow.postMessage(
      {
        type: "scene:control",
        payload: {
          command,
          ...payload
        }
      },
      "*"
    );
  }, []);

  const clearLoadingWatchdog = useCallback(() => {
    if (loadingTimeoutRef.current != null) {
      window.clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  }, []);

  const armLoadingWatchdog = useCallback(() => {
    clearLoadingWatchdog();
    loadingTimeoutRef.current = window.setTimeout(() => {
      setIsLoading(false);
      loadingTimeoutRef.current = null;
    }, 7000);
  }, [clearLoadingWatchdog]);

  const renderScene = useCallback(() => {
    if (!code || !skill) {
      clearLoadingWatchdog();
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setRuntimeError(null);
    setControlFeedback(null);
    setOrbitEnabled(true);
    setRefreshKey(k => k + 1);

    armLoadingWatchdog();
  }, [armLoadingWatchdog, clearLoadingWatchdog, code, skill]);

  useEffect(() => {
    renderScene();
  }, [renderScene]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "scene:error") {
        const errorMsg = event.data.message ?? "Unknown scene error";
        setRuntimeError(errorMsg);
        clearLoadingWatchdog();
        setIsLoading(false);
        onError?.(errorMsg);
        return;
      }

      if (event.data?.type === "scene:ready") {
        clearLoadingWatchdog();
        setIsLoading(false);
        setControlFeedback("Preview ready.");
        return;
      }

      if (event.data?.type === "scene:control:ack") {
        const ok = Boolean(event.data.ok);
        const message = typeof event.data.message === "string" ? event.data.message : ok ? "Control applied." : "Control failed.";
        setControlFeedback(message);
        if (event.data.command === "toggle_orbit" && typeof event.data.enabled === "boolean") {
          setOrbitEnabled(event.data.enabled);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [clearLoadingWatchdog, onError]);

  useEffect(() => {
    if (!controlFeedback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setControlFeedback(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [controlFeedback]);

  useEffect(() => {
    return () => {
      clearLoadingWatchdog();
    };
  }, [clearLoadingWatchdog]);

  const toggleFullscreen = () => {
    if (!iframeRef.current) return;

    if (!isFullscreen) {
      iframeRef.current.parentElement?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
    setIsFullscreen(!isFullscreen);
  };

  const skillLabel = skill ? skill.toUpperCase() : "PREVIEW";
  const headerStatus = runtimeError
    ? "Preview encountered a runtime issue"
    : isLoading
      ? "Rendering updated scene"
      : code
        ? "Scene rendered"
        : "Waiting for generation";
  const focusLabel = code ? `${skillLabel} preview` : "No scene yet";
  const canRender = Boolean(code && skill);

  const handleApplyNaturalLanguageEdit = async () => {
    const instruction = commandText.trim();
    if (!instruction || !canRender || !onNaturalLanguageEdit || isSubmittingEdit || isApplyingEdit) {
      return;
    }

    setIsSubmittingEdit(true);
    setControlFeedback("Applying edit...");

    try {
      const result = await onNaturalLanguageEdit(instruction);
      setControlFeedback(result.message);
      if (result.ok) {
        setCommandText("");
      }
    } catch {
      setControlFeedback("Unable to apply that edit right now.");
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleZoomIn = () => {
    postControl("zoom_in");
  };

  const handleZoomOut = () => {
    postControl("zoom_out");
  };

  const handleResetCamera = () => {
    postControl("reset_camera");
  };

  const handleToggleOrbit = () => {
    postControl("toggle_orbit", { enabled: !orbitEnabled });
  };

  return (
    <div className={`scene-viewer ${isFullscreen ? "scene-viewer--fullscreen" : ""} ${!code ? "scene-viewer--empty" : ""}`}>
      <div className="scene-kimi-header">
        <div className="scene-kimi-header__top">
          <div className="scene-kimi-header__identity">
            <span className="scene-kimi-header__icon" aria-hidden="true">
              <Monitor className="h-4 w-4" />
            </span>
            <div className="scene-kimi-header__identity-copy">
              <p className="scene-kimi-header__title">dosco</p>
              <p className="scene-kimi-header__meta">
                <span className="scene-kimi-header__dot" aria-hidden="true" />
                <span>Scene Viewer</span>
                <span className="scene-kimi-header__divider" aria-hidden="true" />
                <span className="scene-kimi-header__focus">{focusLabel}</span>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </p>
            </div>
          </div>
          <div className="scene-kimi-header__actions">
            <button
              type="button"
              className="scene-kimi-header__btn"
              onClick={renderScene}
              aria-label="Refresh preview"
              disabled={!canRender}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="scene-kimi-header__btn"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              disabled={!code}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <div className="scene-kimi-header__line" />
        <p className="scene-kimi-header__status">
          <Plug2 className="h-3.5 w-3.5" aria-hidden="true" />
          {headerStatus}
          {isLoading && <span className="scene-viewer__loading-dot" />}
        </p>
      </div>

      {code ? (
        <section className="scene-viewer__player" aria-label="Preview controls">
          <div className="scene-viewer__player-row">
            <button type="button" className="scene-viewer__control" onClick={handleZoomOut} title="Zoom out">
              <Minus className="h-3.5 w-3.5" />
              <span>Zoom out</span>
            </button>
            <button type="button" className="scene-viewer__control" onClick={handleZoomIn} title="Zoom in">
              <Plus className="h-3.5 w-3.5" />
              <span>Zoom in</span>
            </button>
            <button type="button" className="scene-viewer__control" onClick={handleResetCamera} title="Reset camera">
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset camera</span>
            </button>
            <button
              type="button"
              className={`scene-viewer__control ${orbitEnabled ? "scene-viewer__control--active" : ""}`}
              onClick={handleToggleOrbit}
              title={orbitEnabled ? "Disable orbit" : "Enable orbit"}
            >
              <Compass className="h-3.5 w-3.5" />
              <span>{orbitEnabled ? "Orbit on" : "Orbit off"}</span>
            </button>
          </div>

          <div className="scene-viewer__player-row">
            <label className="scene-viewer__command-input-wrap">
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              <input
                type="text"
                className="scene-viewer__command-input"
                value={commandText}
                onChange={(event) => setCommandText(event.target.value)}
                placeholder="Describe an edit (example: add 7 more planets)"
              />
            </label>
            <button
              type="button"
              className="scene-viewer__control scene-viewer__control--primary"
              onClick={() => {
                void handleApplyNaturalLanguageEdit();
              }}
              disabled={commandText.trim().length === 0 || !onNaturalLanguageEdit || isSubmittingEdit || isApplyingEdit}
              title="Apply natural-language edit"
            >
              {isSubmittingEdit || isApplyingEdit ? "Applying..." : "Apply edit"}
            </button>
          </div>

          {controlFeedback ? <p className="scene-viewer__feedback">{controlFeedback}</p> : null}
        </section>
      ) : null}

      {runtimeError && (
        <div className="scene-viewer__error">
          <AlertTriangle className="h-4 w-4" />
          <span>{runtimeError}</span>
        </div>
      )}

      {!code ? (
        <div className="scene-viewer__placeholder">
          <div className="scene-viewer__placeholder-icon">◇</div>
          <p className="scene-viewer__placeholder-text">Scene preview will appear here</p>
          <p className="scene-viewer__placeholder-hint">Generate a visual to see it rendered in real-time</p>
        </div>
      ) : (
        <>
          <iframe
            key={refreshKey}
            ref={iframeRef}
            className="scene-viewer__iframe"
            sandbox="allow-scripts"
            srcDoc={buildIframeContent(code, skill ?? "threejs", allowDarkBackground)}
            title="Scene Preview"
            onLoad={() => {
              // Keep loader active until the embedded runtime reports ready/error.
            }}
          />

          {isLoading ? (
            <div className="scene-viewer__loading-overlay" role="status" aria-live="polite">
              <span className="scene-viewer__spinner" aria-hidden="true" />
              <p className="scene-viewer__loading-text">Loading preview...</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
