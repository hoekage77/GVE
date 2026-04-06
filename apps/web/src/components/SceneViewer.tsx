import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Minus, RotateCcw, Compass, CheckCircle2, AlertCircle, Sparkles, Pause, Play, Gamepad2, Lock, Unlock, Keyboard, Grid3X3 } from "lucide-react";
import { cn } from "../lib/utils";

interface SceneViewerProps {
  code: string | null;
  skill: string | null;
  onError?: (error: string) => void;
}

// CDN imports for different skills
const SKILL_CDNS: Record<string, string[]> = {
  threejs: [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'
  ],
  p5js: [
    'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js'
  ],
  d3js: [
    'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js'
  ],
  animejs: [
    'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js'
  ]
};

const SCENE_GRID_STORAGE_KEY = "terranet.scene.grid.enabled";

function getInitialGridEnabled(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  const stored = window.localStorage.getItem(SCENE_GRID_STORAGE_KEY);
  if (stored === null) {
    return true;
  }

  return stored === "1";
}

function buildSceneHTML(code: string, skill: string): string {
  const cdns = SKILL_CDNS[skill] || [];
  const cdnScripts = cdns.map(url => `<script src="${url}"></script>`).join('\n');
  const userCodeSource = JSON.stringify(code ?? "");

  // Skill-specific initialization
  const skillInit: Record<string, string> = {
    threejs: `
      // Three.js Scene Setup
      const __container = document.getElementById('scene-container');
      const __scene = new THREE.Scene();
      const __camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      const __renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      __renderer.setSize(window.innerWidth, window.innerHeight);
      __renderer.setPixelRatio(window.devicePixelRatio);
      __renderer.setClearColor(0xf6f9fd, 0);
      __container.appendChild(__renderer.domElement);

      const __controlsCtor = window.OrbitControls || (window.THREE && window.THREE.OrbitControls) || null;
      if (!window.OrbitControls && __controlsCtor) {
        window.OrbitControls = __controlsCtor;
      }

      // Compatibility shims for generated code across Three.js versions.
      if (window.THREE && typeof window.THREE.CapsuleGeometry !== 'function') {
        window.THREE.CapsuleGeometry = function(radius = 0.5, length = 1, capSegments = 8, radialSegments = 16) {
          const __capsuleGroup = new THREE.Group();
          const __cylinder = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments, 1, true));
          const __capTop = new THREE.Mesh(new THREE.SphereGeometry(radius, radialSegments, capSegments, 0, Math.PI * 2, 0, Math.PI / 2));
          const __capBottom = new THREE.Mesh(new THREE.SphereGeometry(radius, radialSegments, capSegments, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
          __capTop.position.y = length / 2;
          __capBottom.position.y = -length / 2;
          __capsuleGroup.add(__cylinder, __capTop, __capBottom);
          __capsuleGroup.updateMatrixWorld(true);
          const __fallbackGeometry = new THREE.CylinderGeometry(radius, radius, length + radius * 2, radialSegments, 1, false);
          return __fallbackGeometry;
        };
      }

      if (window.THREE && window.THREE.MeshPhysicalMaterial) {
        const __OriginalPhysicalMaterial = window.THREE.MeshPhysicalMaterial;
        if (!__OriginalPhysicalMaterial.__terranetPatched) {
          const __physicalProbe = new __OriginalPhysicalMaterial();

          const __sanitizePhysicalParameters = function(parameters = {}) {
            const __safeParameters = {};

            for (const [__key, __value] of Object.entries(parameters || {})) {
              if (__key in __physicalProbe || __key in __OriginalPhysicalMaterial.prototype) {
                __safeParameters[__key] = __value;
              }
            }

            return __safeParameters;
          };

          const __PatchedPhysicalMaterial = function(parameters = {}) {
            return new __OriginalPhysicalMaterial(__sanitizePhysicalParameters(parameters));
          };

          __PatchedPhysicalMaterial.prototype = __OriginalPhysicalMaterial.prototype;
          __PatchedPhysicalMaterial.prototype.constructor = __PatchedPhysicalMaterial;
          __PatchedPhysicalMaterial.__terranetPatched = true;
          __PatchedPhysicalMaterial.__original = __OriginalPhysicalMaterial;

          window.THREE.MeshPhysicalMaterial = __PatchedPhysicalMaterial;
        }
      }
      
      // Add basic lighting
      const __ambientLight = new THREE.AmbientLight(0x404040, 0.6);
      __scene.add(__ambientLight);
      const __directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      __directionalLight.position.set(5, 10, 7);
      __scene.add(__directionalLight);
      
      // Camera position
      __camera.position.z = 5;

      const __defaultCameraPosition = __camera.position.clone();
      const __controls = __controlsCtor ? new __controlsCtor(__camera, __renderer.domElement) : null;
      if (__controls) {
        __controls.enableDamping = true;
      }

      const __gridHelper = new THREE.GridHelper(24, 24, 0xcbd5e1, 0xe2e8f0);
      __gridHelper.visible = false;
      __scene.add(__gridHelper);

      window.scene = __scene;
      window.camera = __camera;
      window.renderer = __renderer;
      window.controls = __controls;
      window.container = __container;
      window.__terranetGridHelper = __gridHelper;
      
      // Handle resize
      window.addEventListener('resize', () => {
        __camera.aspect = window.innerWidth / window.innerHeight;
        __camera.updateProjectionMatrix();
        __renderer.setSize(window.innerWidth, window.innerHeight);
      });

      window.__terranetSceneControl = {
        zoomIn() {
          __camera.position.multiplyScalar(0.9);
          __camera.updateProjectionMatrix();
        },
        zoomOut() {
          __camera.position.multiplyScalar(1.1);
          __camera.updateProjectionMatrix();
        },
        resetCamera() {
          __camera.position.copy(__defaultCameraPosition);
          if (__controls && typeof __controls.reset === 'function') {
            __controls.reset();
          }
          __camera.updateProjectionMatrix();
        },
        toggleOrbit() {
          if (__controls) {
            __controls.enabled = !__controls.enabled;
            return __controls.enabled;
          }
          return false;
        },
        setGridVisible(visible) {
          if (__gridHelper) {
            __gridHelper.visible = Boolean(visible);
            return __gridHelper.visible;
          }
          return false;
        }
      };
    `,
    p5js: `
      // p5.js will auto-initialize with setup() and draw()
    `,
    d3js: `
      // D3.js container ready
      const container = d3.select('#scene-container');
    `,
    animejs: `
      // Anime.js ready
    `
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terranet Scene</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      overflow: hidden; 
      background-color: #f6f9fd;
      background-image:
        linear-gradient(rgba(148, 163, 184, 0.18) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.18) 1px, transparent 1px);
      background-size: 42px 42px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #scene-container { 
      width: 100vw; 
      height: 100vh; 
      background: radial-gradient(circle at 25% 20%, rgba(255, 255, 255, 0.45), rgba(241, 245, 249, 0.3));
    }
    #error-display {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 1rem;
      border-radius: 0.5rem;
      font-family: monospace;
      font-size: 0.875rem;
      max-width: 80%;
      display: none;
    }
  </style>
  ${cdnScripts}
</head>
<body>
  <div id="scene-container"></div>
  <div id="error-display"></div>
  <script>
    window.addEventListener('error', function(e) {
      const errorDisplay = document.getElementById('error-display');
      errorDisplay.textContent = 'Error: ' + e.message;
      errorDisplay.style.display = 'block';
      parent.postMessage({ type: 'scene:error', error: e.message }, '*');
    });

    window.addEventListener('unhandledrejection', function(e) {
      const reason = e.reason && e.reason.message ? e.reason.message : String(e.reason || 'Unhandled promise rejection');
      const errorDisplay = document.getElementById('error-display');
      errorDisplay.textContent = 'Error: ' + reason;
      errorDisplay.style.display = 'block';
      parent.postMessage({ type: 'scene:error', error: reason }, '*');
    });

    function __postToParent(type, payload) {
      try {
        parent.postMessage({ type, ...(payload || {}) }, '*');
      } catch (_error) {
        // Ignore cross-origin serialization errors.
      }
    }

    function __normalizeUniformVector(value, size) {
      if (value === null || value === undefined) {
        return value;
      }

      if (ArrayBuffer.isView(value)) {
        return value;
      }

      if (Array.isArray(value)) {
        return new Float32Array(value);
      }

      if (typeof value === 'object') {
        if (typeof value.toArray === 'function') {
          try {
            const arrayValue = value.toArray();
            if (ArrayBuffer.isView(arrayValue)) {
              return arrayValue;
            }
            if (Array.isArray(arrayValue)) {
              return new Float32Array(arrayValue);
            }
          } catch (_error) {
            // Fall through to component extraction.
          }
        }

        if (size === 2 && typeof value.x === 'number' && typeof value.y === 'number') {
          return new Float32Array([value.x, value.y]);
        }

        if (size === 3) {
          if (typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number') {
            return new Float32Array([value.x, value.y, value.z]);
          }
          if (typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number') {
            return new Float32Array([value.r, value.g, value.b]);
          }
        }

        if (size === 4) {
          if (typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number' && typeof value.w === 'number') {
            return new Float32Array([value.x, value.y, value.z, value.w]);
          }
          if (typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number' && typeof value.a === 'number') {
            return new Float32Array([value.r, value.g, value.b, value.a]);
          }
        }
      }

      return value;
    }

    function __patchUniformVectorMethod(targetPrototype, methodName, size) {
      if (!targetPrototype || typeof targetPrototype[methodName] !== 'function') {
        return;
      }

      const originalMethod = targetPrototype[methodName];
      if (originalMethod.__terranetPatched) {
        return;
      }

      const wrappedMethod = function(location, value) {
        const normalizedValue = __normalizeUniformVector(value, size);
        return originalMethod.call(this, location, normalizedValue);
      };

      wrappedMethod.__terranetPatched = true;
      targetPrototype[methodName] = wrappedMethod;
    }

    function __patchWebGLUniformVectors() {
      if (window.__terranetUniformPatchApplied) {
        return;
      }

      window.__terranetUniformPatchApplied = true;

      const gl1Proto = window.WebGLRenderingContext && window.WebGLRenderingContext.prototype;
      const gl2Proto = window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype;
      const targets = [gl1Proto, gl2Proto];

      for (const target of targets) {
        __patchUniformVectorMethod(target, 'uniform2fv', 2);
        __patchUniformVectorMethod(target, 'uniform3fv', 3);
        __patchUniformVectorMethod(target, 'uniform4fv', 4);
      }
    }

    __patchWebGLUniformVectors();

    const __nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    let __scenePaused = false;
    let __gameModeEnabled = false;
    let __awaitingPointerLock = false;

    window.requestAnimationFrame = function(callback) {
      return __nativeRequestAnimationFrame(function frameProxy(time) {
        if (!__scenePaused) {
          callback(time);
          return;
        }

        const waitUntilPlay = function(nextTime) {
          if (__scenePaused) {
            __nativeRequestAnimationFrame(waitUntilPlay);
            return;
          }
          callback(nextTime);
        };

        __nativeRequestAnimationFrame(waitUntilPlay);
      });
    };

    function __getInteractiveTarget() {
      if (window.renderer && window.renderer.domElement) {
        return window.renderer.domElement;
      }

      return document.getElementById('scene-container') || document.body;
    }

    function __focusInteractiveTarget() {
      const target = __getInteractiveTarget();
      if (!target) {
        return;
      }

      if (typeof target.tabIndex === 'number' && target.tabIndex < 0) {
        target.tabIndex = 0;
      }

      if (typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    }

    function __requestPointerLock() {
      const target = __getInteractiveTarget();
      if (!target || typeof target.requestPointerLock !== 'function') {
        return false;
      }

      try {
        target.requestPointerLock();
        return true;
      } catch (_error) {
        return false;
      }
    }

    function __exitPointerLock() {
      if (typeof document.exitPointerLock === 'function') {
        document.exitPointerLock();
      }
    }

    function __setGameMode(enabled) {
      __gameModeEnabled = Boolean(enabled);
      __focusInteractiveTarget();
      __postToParent('scene:game_mode', { enabled: __gameModeEnabled });
      __postToParent('scene:gamepad', {
        connected: typeof navigator.getGamepads === 'function'
          ? Array.from(navigator.getGamepads() || []).some(Boolean)
          : false
      });
    }

    const __blockedKeys = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
    window.addEventListener('keydown', function(event) {
      if (!__gameModeEnabled) {
        return;
      }

      if (__blockedKeys.has(event.key)) {
        event.preventDefault();
      }

      __postToParent('scene:key', {
        state: 'down',
        key: event.key,
        code: event.code
      });
    }, { capture: true });

    window.addEventListener('keyup', function(event) {
      if (!__gameModeEnabled) {
        return;
      }

      __postToParent('scene:key', {
        state: 'up',
        key: event.key,
        code: event.code
      });
    }, { capture: true });

    document.addEventListener('pointerlockchange', function() {
      if (document.pointerLockElement) {
        __awaitingPointerLock = false;
        __postToParent('scene:pointer_lock_hint', { message: null });
      }

      __postToParent('scene:pointer_lock', {
        locked: Boolean(document.pointerLockElement)
      });
    });

    document.addEventListener('pointerlockerror', function() {
      __postToParent('scene:pointer_lock_hint', {
        message: 'Click inside the scene canvas and try lock again.'
      });
    });

    document.addEventListener('click', function(event) {
      if (!__awaitingPointerLock) {
        return;
      }

      const target = __getInteractiveTarget();
      if (!target) {
        return;
      }

      const clickedNode = event.target;
      if (!(clickedNode instanceof Node)) {
        return;
      }

      if (!target.contains(clickedNode) && clickedNode !== target) {
        return;
      }

      const locked = __requestPointerLock();
      if (locked) {
        __awaitingPointerLock = false;
        __postToParent('scene:pointer_lock_hint', { message: null });
      }
    }, { capture: true });

    window.addEventListener('gamepadconnected', function() {
      __postToParent('scene:gamepad', { connected: true });
    });

    window.addEventListener('gamepaddisconnected', function() {
      const connected = typeof navigator.getGamepads === 'function'
        ? Array.from(navigator.getGamepads() || []).some(Boolean)
        : false;
      __postToParent('scene:gamepad', { connected });
    });

    window.addEventListener('message', function(event) {
      if (!event.data || event.data.type !== 'scene:control') {
        return;
      }

      const payload = event.data.payload || {};
      const command = payload.command;
      const sceneControl = window.__terranetSceneControl;

      if (command === 'zoom_in' && sceneControl && typeof sceneControl.zoomIn === 'function') {
        sceneControl.zoomIn();
      }

      if (command === 'zoom_out' && sceneControl && typeof sceneControl.zoomOut === 'function') {
        sceneControl.zoomOut();
      }

      if (command === 'reset_camera' && sceneControl && typeof sceneControl.resetCamera === 'function') {
        sceneControl.resetCamera();
      }

      if (command === 'toggle_orbit' && sceneControl && typeof sceneControl.toggleOrbit === 'function') {
        const enabled = sceneControl.toggleOrbit();
        parent.postMessage({ type: 'scene:orbit', enabled }, '*');
      }

      if (command === 'set_grid' && sceneControl && typeof sceneControl.setGridVisible === 'function') {
        const enabled = sceneControl.setGridVisible(Boolean(payload.enabled));
        parent.postMessage({ type: 'scene:grid', enabled }, '*');
      }

      if (command === 'pause') {
        __scenePaused = true;
        parent.postMessage({ type: 'scene:playback', paused: true }, '*');
      }

      if (command === 'play') {
        __scenePaused = false;
        parent.postMessage({ type: 'scene:playback', paused: false }, '*');
      }

      if (command === 'enable_game_mode') {
        __setGameMode(true);
      }

      if (command === 'disable_game_mode') {
        __setGameMode(false);
        __exitPointerLock();
        __awaitingPointerLock = false;
      }

      if (command === 'request_pointer_lock') {
        __focusInteractiveTarget();
        __awaitingPointerLock = true;
        __postToParent('scene:pointer_lock_hint', {
          message: 'Click inside the scene to confirm mouse lock.'
        });
      }

      if (command === 'exit_pointer_lock') {
        __exitPointerLock();
      }

      if (command === 'focus_input') {
        __focusInteractiveTarget();
      }
    });
    
    try {
      ${skillInit[skill] || ''}
      const __userCodeSource = ${userCodeSource};
      const __executeGeneratedCode = new Function(__userCodeSource);
      __executeGeneratedCode.call(window);
    } catch (err) {
      const errorDisplay = document.getElementById('error-display');
      errorDisplay.textContent = 'Error: ' + err.message;
      errorDisplay.style.display = 'block';
      parent.postMessage({ type: 'scene:error', error: err.message }, '*');
    }
  </script>
</body>
</html>`;
}

export default function SceneViewer({ code, skill, onError }: SceneViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [orbitEnabled, setOrbitEnabled] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isGameModeEnabled, setIsGameModeEnabled] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [isGamepadConnected, setIsGamepadConnected] = useState(false);
  const [isGridEnabled, setIsGridEnabled] = useState(getInitialGridEnabled);
  const [pointerLockHint, setPointerLockHint] = useState<string | null>(null);

  const skillLabel = skill?.toUpperCase() ?? "SCENE";

  // Listen for errors from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'scene:error') {
        const error = event.data.error;
        setRuntimeError(error);
        onError?.(error);
      }

      if (event.data?.type === 'scene:orbit') {
        setOrbitEnabled(Boolean(event.data.enabled));
      }

      if (event.data?.type === 'scene:playback') {
        setIsPlaying(!Boolean(event.data.paused));
      }

      if (event.data?.type === 'scene:game_mode') {
        setIsGameModeEnabled(Boolean(event.data.enabled));
      }

      if (event.data?.type === 'scene:pointer_lock') {
        setIsPointerLocked(Boolean(event.data.locked));
      }

      if (event.data?.type === 'scene:pointer_lock_hint') {
        const message = typeof event.data.message === 'string' ? event.data.message : null;
        setPointerLockHint(message);
      }

      if (event.data?.type === 'scene:gamepad') {
        setIsGamepadConnected(Boolean(event.data.connected));
      }

      if (event.data?.type === 'scene:grid') {
        setIsGridEnabled(Boolean(event.data.enabled));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onError]);

  // Render scene when code/skill changes
  useEffect(() => {
    if (!code || !skill || !iframeRef.current) {
      setIsRendered(false);
      setRuntimeError(null);
      return;
    }

    setIsLoading(true);
    setRuntimeError(null);
    setIsRendered(false);
    setIsPlaying(true);
    setIsGameModeEnabled(false);
    setIsPointerLocked(false);
    setIsGamepadConnected(false);
    setPointerLockHint(null);

    const html = buildSceneHTML(code, skill);
    const iframe = iframeRef.current;
    iframe.srcdoc = html;

    // Simulate loading time
    const timer = setTimeout(() => {
      setIsLoading(false);
      setIsRendered(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, [code, skill]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SCENE_GRID_STORAGE_KEY, isGridEnabled ? "1" : "0");
  }, [isGridEnabled]);

  const postControl = useCallback((command: string, payload: Record<string, unknown> = {}) => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;

    frameWindow.postMessage(
      { type: "scene:control", payload: { command, ...payload } },
      "*"
    );
  }, []);

  const handleZoomIn = () => postControl("zoom_in");
  const handleZoomOut = () => postControl("zoom_out");
  const handleResetCamera = () => postControl("reset_camera");
  const handleToggleOrbit = () => {
    postControl("toggle_orbit");
  };

  const handleTogglePlayback = () => {
    postControl(isPlaying ? "pause" : "play");
    setIsPlaying((previous) => !previous);
  };

  const handleToggleGrid = () => {
    const nextEnabled = !isGridEnabled;
    setIsGridEnabled(nextEnabled);
    postControl("set_grid", { enabled: nextEnabled });
  };

  const handleToggleGameMode = () => {
    const nextEnabled = !isGameModeEnabled;
    iframeRef.current?.focus({ preventScroll: true });
    postControl(nextEnabled ? "enable_game_mode" : "disable_game_mode");
    if (nextEnabled) {
      postControl("focus_input");
      setPointerLockHint("Click inside the scene, then press mouse lock.");
    }
    setIsGameModeEnabled(nextEnabled);
    if (!nextEnabled) {
      setIsPointerLocked(false);
      setPointerLockHint(null);
    }
  };

  const handlePointerLockToggle = () => {
    iframeRef.current?.focus({ preventScroll: true });
    if (!isGameModeEnabled) {
      postControl("enable_game_mode");
      setIsGameModeEnabled(true);
    }

    postControl(isPointerLocked ? "exit_pointer_lock" : "request_pointer_lock");

    if (!isPointerLocked) {
      setPointerLockHint("Click inside the scene to confirm mouse lock.");
    } else {
      setPointerLockHint(null);
    }
  };

  const handleFocusInput = () => {
    iframeRef.current?.focus({ preventScroll: true });
    postControl("focus_input");
  };

  const is3D = skill === 'threejs';

  useEffect(() => {
    if (!is3D || !isRendered) {
      return;
    }

    postControl("set_grid", { enabled: isGridEnabled });
  }, [is3D, isRendered, isGridEnabled, postControl]);

  return (
    <div className="scene-viewer-card">
      {/* Body */}
      <div className="scene-viewer-body">
        {runtimeError ? (
          <div className="scene-viewer-error">
            <AlertCircle className="h-6 w-6" />
            <p>{runtimeError}</p>
          </div>
        ) : !code ? (
          <div className="scene-viewer-placeholder">
            <Sparkles className="h-10 w-10" />
            <p>Generate a scene to see the preview</p>
          </div>
        ) : (
          <>
            {/* Iframe Container */}
            <div className="scene-viewer-canvas">
              <iframe
                ref={iframeRef}
                className="scene-iframe"
                sandbox="allow-scripts allow-pointer-lock"
                tabIndex={0}
                title="Scene preview"
              />

              {isLoading && (
                <div className="scene-loading-overlay">
                  <div className="scene-loading-spinner" />
                  <p>Rendering scene...</p>
                </div>
              )}
            </div>

            {/* Control Bar */}
            <div className="scene-controls">
              <div className="scene-controls-group">
                {is3D && (
                  <>
                    <button
                      type="button"
                      className="scene-control-btn"
                      onClick={handleZoomOut}
                      title="Zoom out"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="scene-control-btn"
                      onClick={handleZoomIn}
                      title="Zoom in"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="scene-control-btn"
                      onClick={handleResetCamera}
                      title="Reset camera"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={cn("scene-control-btn", !isPlaying && "active")}
                      onClick={handleTogglePlayback}
                      title={isPlaying ? "Pause animation" : "Play animation"}
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      className={cn("scene-control-btn", orbitEnabled && "active")}
                      onClick={handleToggleOrbit}
                      title={orbitEnabled ? "Disable orbit" : "Enable orbit"}
                    >
                      <Compass className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={cn("scene-control-btn", isGridEnabled && "active")}
                      onClick={handleToggleGrid}
                      title={isGridEnabled ? "Hide 3D grid" : "Show 3D grid"}
                    >
                      <Grid3X3 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={cn("scene-control-btn", isGameModeEnabled && "active")}
                      onClick={handleToggleGameMode}
                      title={isGameModeEnabled ? "Disable game mode" : "Enable game mode"}
                    >
                      <Gamepad2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className={cn("scene-control-btn", isPointerLocked && "active")}
                      onClick={handlePointerLockToggle}
                      title={isPointerLocked ? "Unlock mouse" : "Lock mouse to scene"}
                    >
                      {isPointerLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      className="scene-control-btn"
                      onClick={handleFocusInput}
                      title="Focus scene input"
                    >
                      <Keyboard className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>

              <div className="scene-render-status">
                {isRendered ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Scene rendered</span>
                  </>
                ) : isLoading ? (
                  <>
                    <div className="scene-status-pulse" />
                    <span>Rendering...</span>
                  </>
                ) : null}
              </div>
            </div>

            {is3D && isGameModeEnabled && (
              <div className="scene-game-hints" role="status" aria-live="polite">
                <span>
                  Input: WASD or Arrow keys, mouse look, Space jump, Shift sprint, Esc unlock.
                </span>
                <span>
                  Mouse lock: {isPointerLocked ? "Captured" : pointerLockHint ?? "Press lock, then click inside scene"}
                </span>
                <span>
                  Gamepad: {isGamepadConnected ? "Connected" : "Not connected"}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
