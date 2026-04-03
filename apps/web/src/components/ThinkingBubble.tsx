import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";

interface ThinkingBubbleProps {
  thought?: string;
  step?: string;
  isActive: boolean;
  variant?: "full" | "avatar" | "inline";
}

const stepLabels: Record<string, string> = {
  turn_started: "Thinking",
  intent_parsed: "Understanding",
  skill_selected: "Selecting tool",
  plan_created: "Planning",
  code_generated: "Writing code",
  validate_code: "Validating",
  validation_failed: "Recovering",
  executing: "Executing",
  execution_skipped: "Skipped",
  sync_state: "Syncing",
  code_modified: "Modifying",
  turn_complete: "Done",
  turn_error: "Error"
};

export default function ThinkingBubble({ thought = "", step = "turn_started", isActive, variant = "full" }: ThinkingBubbleProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [cursorVisible, setCursorVisible] = useState(true);
  const gooMountRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const previousThoughtRef = useRef("");
  const targetTextRef = useRef("");
  const charIndexRef = useRef(0);
  const activityRef = useRef(isActive ? 1 : 0.42);

  const stepLabel = stepLabels[step] ?? step.replace(/_/g, " ");

  useEffect(() => {
    activityRef.current = isActive ? 1 : 0.42;
  }, [isActive]);

  useEffect(() => {
    const mount = gooMountRef.current;
    if (!mount) {
      return;
    }

    let disposed = false;
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: {
      render: () => void;
      dispose: () => void;
      setSize: (width: number, height: number) => void;
      setPixelRatio: (ratio: number) => void;
    } | null = null;
    let cleanupScene: (() => void) | null = null;

    const createFallbackAnimation = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }

      mount.innerHTML = "";
      mount.appendChild(canvas);

      const resize = () => {
        const size = Math.max(88, Math.min(mount.clientWidth, mount.clientHeight || mount.clientWidth));
        canvas.width = size;
        canvas.height = size;
      };

      const render = () => {
        if (disposed) {
          return;
        }

        const speed = activityRef.current;
        const t = performance.now() * 0.001 * (0.8 + speed * 0.65);
        const cx = canvas.width * 0.5;
        const cy = canvas.height * 0.5;
        const radius = canvas.width * 0.34;

        context.clearRect(0, 0, canvas.width, canvas.height);

        const bg = context.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.7);
        bg.addColorStop(0, "rgba(208, 239, 255, 0.9)");
        bg.addColorStop(1, "rgba(240, 248, 255, 0)");
        context.fillStyle = bg;
        context.fillRect(0, 0, canvas.width, canvas.height);

        const wobbleX = Math.sin(t * 1.1) * radius * 0.08;
        const wobbleY = Math.cos(t * 1.3) * radius * 0.08;

        for (let i = 0; i < 5; i += 1) {
          const layer = i / 4;
          const r = radius * (0.92 - layer * 0.12) + Math.sin(t * (1.4 + i * 0.23)) * (2.2 + i);
          const gradient = context.createRadialGradient(
            cx + wobbleX * (1 - layer * 0.4),
            cy + wobbleY * (1 - layer * 0.35),
            r * 0.18,
            cx,
            cy,
            r
          );

          gradient.addColorStop(0, `rgba(${158 - i * 8}, ${228 - i * 10}, 255, ${0.34 - i * 0.04})`);
          gradient.addColorStop(1, `rgba(${76 - i * 3}, ${170 - i * 5}, ${235 - i * 2}, ${0.24 - i * 0.03})`);

          context.beginPath();
          context.fillStyle = gradient;
          context.ellipse(
            cx + wobbleX * (0.9 - layer),
            cy + wobbleY * (0.9 - layer),
            r,
            r * (0.94 + Math.sin(t * 0.8 + i) * 0.04),
            t * 0.1 + i * 0.2,
            0,
            Math.PI * 2
          );
          context.fill();
        }

        frame = requestAnimationFrame(render);
      };

      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
      frame = requestAnimationFrame(render);

      cleanupScene = () => {
        cancelAnimationFrame(frame);
      };
    };

    const init = async () => {
      try {
        const THREE = await import("three");
        if (disposed || !gooMountRef.current) {
          return;
        }

        const scene = new THREE.Scene();
        scene.background = null;

        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.set(0, 0, 4);

        const webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
        webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        webglRenderer.toneMappingExposure = 1.08;
        webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        webglRenderer.setClearColor(0x000000, 0);

        mount.innerHTML = "";
        mount.appendChild(webglRenderer.domElement);

        const ambientLight = new THREE.AmbientLight(0x001133, 0.4);
        scene.add(ambientLight);

        const mainLight = new THREE.PointLight(0x44aaff, 2.0, 100);
        mainLight.position.set(-5, 5, 5);
        scene.add(mainLight);

        const fillLight = new THREE.PointLight(0xff4488, 0.8, 100);
        fillLight.position.set(5, -3, 2);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0xffffff, 1.2);
        rimLight.position.set(-2, 1, -2);
        scene.add(rimLight);

        const maxRipples = 12;
        const ripplePoints = Array.from({ length: maxRipples }, () => new THREE.Vector3());
        const rippleTimes = new Float32Array(maxRipples);
        const rippleStrengths = new Float32Array(maxRipples);
        const rippleSpeeds = new Float32Array(maxRipples);

        const ripples = Array.from({ length: maxRipples }, () => ({
          point: new THREE.Vector3(),
          time: -1000,
          strength: 0,
          active: false,
          speed: 1
        }));

        let currentRipple = 0;
        let nextRippleTime = 0;

        const geometry = new THREE.SphereGeometry(1.0, 196, 196);
        const material = new THREE.ShaderMaterial({
          uniforms: {
            time: { value: 0 },
            colorDeep: { value: new THREE.Color(0x001a33) },
            colorMid: { value: new THREE.Color(0x0066aa) },
            colorLight: { value: new THREE.Color(0x00aaff) },
            colorFoam: { value: new THREE.Color(0xaaddff) },
            colorAccent: { value: new THREE.Color(0x4488ff) },
            ripplePoints: { value: ripplePoints },
            rippleTimes: { value: rippleTimes },
            rippleStrengths: { value: rippleStrengths },
            rippleSpeeds: { value: rippleSpeeds }
          },
          vertexShader: `
            uniform float time;
            uniform vec3 ripplePoints[12];
            uniform float rippleTimes[12];
            uniform float rippleStrengths[12];
            uniform float rippleSpeeds[12];
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying float vElevation;
            varying float vRipple;
            varying float vBreathing;

            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
            vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

            float snoise(vec3 v) {
              const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
              const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
              vec3 i = floor(v + dot(v, C.yyy));
              vec3 x0 = v - i + dot(i, C.xxx);
              vec3 g = step(x0.yzx, x0.xyz);
              vec3 l = 1.0 - g;
              vec3 i1 = min(g.xyz, l.zxy);
              vec3 i2 = max(g.xyz, l.zxy);
              vec3 x1 = x0 - i1 + C.xxx;
              vec3 x2 = x0 - i2 + C.yyy;
              vec3 x3 = x0 - D.yyy;
              i = mod289(i);
              vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                + i.x + vec4(0.0, i1.x, i2.x, 1.0));
              float n_ = 0.142857142857;
              vec3 ns = n_ * D.wyz - D.xzx;
              vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
              vec4 x_ = floor(j * ns.z);
              vec4 y_ = floor(j - 7.0 * x_);
              vec4 x = x_ * ns.x + ns.yyyy;
              vec4 y = y_ * ns.x + ns.yyyy;
              vec4 h = 1.0 - abs(x) - abs(y);
              vec4 b0 = vec4(x.xy, y.xy);
              vec4 b1 = vec4(x.zw, y.zw);
              vec4 s0 = floor(b0) * 2.0 + 1.0;
              vec4 s1 = floor(b1) * 2.0 + 1.0;
              vec4 sh = -step(h, vec4(0.0));
              vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
              vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
              vec3 p0 = vec3(a0.xy, h.x);
              vec3 p1 = vec3(a0.zw, h.y);
              vec3 p2 = vec3(a1.xy, h.z);
              vec3 p3 = vec3(a1.zw, h.w);
              vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
              p0 *= norm.x;
              p1 *= norm.y;
              p2 *= norm.z;
              p3 *= norm.w;
              vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
              m = m * m;
              return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
            }

            float seamlessNoise(vec3 p, float t) {
              float n1 = snoise(p * 1.5 + t * 0.2);
              float n2 = snoise(p * 3.0 - t * 0.15 + n1 * 0.5);
              float n3 = snoise(p * 6.0 + t * 0.1 + n2 * 0.25);
              return n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
            }

            void main() {
              vNormal = normalize(normalMatrix * normal);

              float t = time;
              float breathPhase = t * 0.4;
              float breath1 = sin(breathPhase) * 0.5 + 0.5;
              float breath2 = sin(breathPhase * 1.618 + 1.0) * 0.5 + 0.5;
              float breath3 = sin(breathPhase * 0.7 + 2.0) * 0.5 + 0.5;
              float breathing = breath1 * 0.6 + breath2 * 0.3 + breath3 * 0.1;
              breathing = pow(breathing, 2.0) * 0.12;
              vBreathing = breathing;

              vec3 noisePos = position + vec3(sin(t * 0.1), cos(t * 0.13), sin(t * 0.08)) * 0.2;
              float organic = seamlessNoise(noisePos, t) * 0.08;
              float micro = snoise(position * 12.0 + t * 0.5) * 0.015;
              float shimmer = snoise(position * 24.0 - t * 0.8) * 0.005;

              float totalRipple = 0.0;
              for(int i = 0; i < 12; i++) {
                if(rippleStrengths[i] > 0.01) {
                  float dist = distance(position, ripplePoints[i]);
                  float age = t - rippleTimes[i];
                  float speed = rippleSpeeds[i];
                  float wavePos = dist * 8.0 - age * speed * 4.0;
                  float envelope = exp(-pow(wavePos * 0.3, 2.0)) * exp(-age * 0.8);
                  float wave = sin(wavePos) * 0.8 + sin(wavePos * 2.3) * 0.2;
                  float spread = 1.0 / (1.0 + dist * dist * 0.5);
                  totalRipple += wave * envelope * spread * rippleStrengths[i] * 0.2;
                }
              }

              vRipple = totalRipple;

              float elevation = breathing + organic + micro + shimmer + totalRipple;
              float peak = max(0.0, elevation - breathing) * 2.0;
              vElevation = elevation + peak * 0.3;

              vec3 newPosition = position + normal * elevation;
              vPosition = newPosition;

              gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
          `,
          fragmentShader: `
            uniform float time;
            uniform vec3 colorDeep;
            uniform vec3 colorMid;
            uniform vec3 colorLight;
            uniform vec3 colorFoam;
            uniform vec3 colorAccent;

            varying vec3 vNormal;
            varying vec3 vPosition;
            varying float vElevation;
            varying float vRipple;
            varying float vBreathing;

            void main() {
              vec3 viewDirection = normalize(cameraPosition - vPosition);
              float fresnel = pow(1.0 - dot(viewDirection, normalize(vNormal)), 3.0);

              float mixFactor = vElevation * 4.0 + vBreathing * 2.0;
              vec3 color = mix(colorDeep, colorMid, smoothstep(-0.05, 0.1, mixFactor));
              color = mix(color, colorLight, smoothstep(0.05, 0.2, vElevation));

              float highlight = max(0.0, vElevation - 0.15) * 3.0;
              color = mix(color, colorAccent, highlight * 0.5);

              float foam = smoothstep(0.12, 0.18, vElevation) * 0.6;
              foam += abs(vRipple) * 0.3;
              color = mix(color, colorFoam, foam * (1.0 - fresnel * 0.5));

              vec3 lightDir = normalize(vec3(-5.0, 5.0, 5.0));
              vec3 halfVector = normalize(lightDir + viewDirection);
              float specular = pow(max(dot(normalize(vNormal), halfVector), 0.0), 64.0 + vBreathing * 64.0);
              color += colorFoam * specular * (0.8 + vBreathing * 0.4);

              float subsurface = pow(1.0 - abs(dot(viewDirection, normalize(vNormal))), 2.0) * vBreathing * 0.5;
              color += colorMid * subsurface;

              float caustic = sin(vElevation * 20.0 - time * 3.0) * 0.5 + 0.5;
              caustic *= sin(vElevation * 15.0 + time * 2.0) * 0.5 + 0.5;
              color += colorLight * caustic * 0.1 * (1.0 - vElevation);

              color += colorAccent * abs(vRipple) * 0.6;
              color = mix(color, colorFoam, fresnel * 0.4);

              float alpha = 0.85 + fresnel * 0.15;
              gl_FragColor = vec4(color, alpha);
            }
          `,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.NormalBlending
        });

        const goo = new THREE.Mesh(geometry, material);
        scene.add(goo);

        const spawnRippleBurst = (now: number) => {
          const slot = currentRipple;
          currentRipple = (currentRipple + 1) % maxRipples;

          const phi = Math.acos(1 - 2 * Math.random());
          const theta = Math.random() * Math.PI * 2;
          const point = new THREE.Vector3(
            Math.sin(phi) * Math.cos(theta),
            Math.sin(phi) * Math.sin(theta),
            Math.cos(phi)
          );

          const strength = 1 + Math.random() * 0.5;
          const speed = 1 + Math.random() * 0.5;

          ripples[slot].point.copy(point);
          ripples[slot].time = now;
          ripples[slot].strength = strength;
          ripples[slot].active = true;
          ripples[slot].speed = speed;

          ripplePoints[slot].copy(point);
          rippleTimes[slot] = now;
          rippleStrengths[slot] = strength;
          rippleSpeeds[slot] = speed;
        };

        let pointerX = 0;
        let pointerY = 0;
        let smoothX = 0;
        let smoothY = 0;

        const onPointerMove = (event: PointerEvent) => {
          const rect = mount.getBoundingClientRect();
          if (!rect.width || !rect.height) {
            return;
          }

          pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointerY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        };

        const resize = () => {
          const size = Math.max(88, Math.min(mount.clientWidth, mount.clientHeight || mount.clientWidth));
          webglRenderer.setSize(size, size, false);
          camera.aspect = 1;
          camera.updateProjectionMatrix();
        };

        mount.addEventListener("pointermove", onPointerMove);
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mount);
        resize();

        renderer = {
          render: () => {
            const t = performance.now() * 0.001;
            const speed = activityRef.current;

            material.uniforms.time.value = t;

            const breathPhase = Math.sin(t * 0.4) * 0.5 + 0.5;
            const interval = 0.4 + (1 - breathPhase) * 0.6;
            if (t > nextRippleTime) {
              spawnRippleBurst(t);
              nextRippleTime = t + interval + Math.random() * 0.3;
            }

            for (let i = 0; i < maxRipples; i += 1) {
              if (!ripples[i].active) {
                continue;
              }

              const age = t - ripples[i].time;
              const normalized = Math.max(0, Math.min(1, age / 0.5));
              const smooth = normalized * normalized * (3 - 2 * normalized);
              const strength = ripples[i].strength * (1 - smooth) * Math.exp(-age * 0.7);

              rippleStrengths[i] = strength;
              if (age > 4 || strength < 0.01) {
                ripples[i].active = false;
                rippleStrengths[i] = 0;
              }
            }

            smoothX += (pointerX - smoothX) * 0.04;
            smoothY += (pointerY - smoothY) * 0.04;

            goo.rotation.y += 0.002 * speed;
            goo.rotation.x = Math.sin(t * 0.23) * 0.1 + Math.sin(t * 0.17) * 0.05;
            goo.rotation.z = Math.cos(t * 0.19) * 0.08;
            goo.position.y = Math.sin(t * 0.37) * 0.08 + Math.sin(t * 0.13) * 0.04;

            camera.position.x += ((smoothX * 0.4) - camera.position.x) * 0.02;
            camera.position.y += ((smoothY * 0.4) - camera.position.y) * 0.02;
            camera.lookAt(scene.position);

            webglRenderer.render(scene, camera);
          },
          dispose: () => {
            mount.removeEventListener("pointermove", onPointerMove);
            geometry.dispose();
            material.dispose();
            webglRenderer.dispose();
          },
          setSize: (width, height) => {
            webglRenderer.setSize(width, height, false);
          },
          setPixelRatio: (ratio) => {
            webglRenderer.setPixelRatio(ratio);
          }
        };

        cleanupScene = () => {
          renderer?.dispose();
        };
      } catch {
        createFallbackAnimation();
      }

      const renderFrame = () => {
        if (disposed) {
          return;
        }

        renderer?.render();
        frame = requestAnimationFrame(renderFrame);
      };

      frame = requestAnimationFrame(renderFrame);
    };

    void init();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      cleanupScene?.();
      mount.innerHTML = "";
    };
  }, []);

  // Typewriter animation
  useEffect(() => {
    if (thought === previousThoughtRef.current) {
      return;
    }

    previousThoughtRef.current = thought;
    targetTextRef.current = thought;
    charIndexRef.current = 0;
    setDisplayedText("");

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    let lastTimestamp = 0;
    const charDelay = 18; // ms per character

    function tick(timestamp: number) {
      if (!lastTimestamp) {
        lastTimestamp = timestamp;
      }

      const elapsed = timestamp - lastTimestamp;

      if (elapsed >= charDelay) {
        const charsToAdd = Math.min(
          Math.floor(elapsed / charDelay),
          targetTextRef.current.length - charIndexRef.current
        );

        if (charsToAdd > 0) {
          charIndexRef.current += charsToAdd;
          setDisplayedText(targetTextRef.current.slice(0, charIndexRef.current));
          lastTimestamp = timestamp;
        }
      }

      if (charIndexRef.current < targetTextRef.current.length) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        animationRef.current = null;
      }
    }

    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [thought]);

  // Cursor blink
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 530);

    return () => clearInterval(interval);
  }, [isActive]);

  if (variant === "full" && !thought && !isActive) {
    return null;
  }

  if (variant === "avatar") {
    if (!isActive) {
      return (
        <div className="thinking-avatar thinking-avatar--idle" aria-hidden="true">
          <span className="thinking-avatar__core" />
          <span className="thinking-avatar__ring" />
        </div>
      );
    }

    return (
      <div className="thinking-avatar thinking-avatar--active" aria-hidden="true">
        <div className="thinking-avatar__goo" ref={gooMountRef} />
        <span className="thinking-avatar__ring" />
      </div>
    );
  }

  if (variant === "inline") {
    const inlineText = displayedText || (isActive ? "Working through this now..." : thought);

    if (!inlineText && !isActive) {
      return null;
    }

    return (
      <div className={`thinking-inline ${isActive ? "thinking-inline--active" : "thinking-inline--done"}`}>
        <div className="thinking-inline__header">
          <Sparkles className="thinking-inline__icon" />
          <span className="thinking-inline__eyebrow">Thinking</span>
          <span className="thinking-inline__step-pill">{stepLabel}</span>
        </div>
        <p className="thinking-inline__text">
          {inlineText}
          {isActive ? (
            <span
              className={`thinking-cursor ${cursorVisible ? "thinking-cursor--visible" : "thinking-cursor--hidden"}`}
            />
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <article
      className={`thinking-bubble ${isActive ? "thinking-bubble--active" : "thinking-bubble--done"}`}
    >
      <div className="thinking-bubble__content">
        <div className="thinking-bubble__visual" aria-hidden="true">
          <div ref={gooMountRef} className="thinking-bubble__goo-canvas" />
          <div className="thinking-bubble__visual-gloss" />
        </div>

        <div className="thinking-bubble__copy">
          <div className="thinking-bubble__header">
            <Sparkles className="thinking-bubble__icon" />
            <span className="thinking-bubble__eyebrow">THINKING</span>
            <span className="thinking-bubble__step-pill">{stepLabel}</span>
          </div>
          <p className="thinking-bubble__text">
            {displayedText}
            {isActive && (
              <span
                className={`thinking-cursor ${cursorVisible ? "thinking-cursor--visible" : "thinking-cursor--hidden"}`}
              />
            )}
          </p>
        </div>
      </div>
      {isActive && (
        <div className="thinking-bubble__pulse-bar" />
      )}
    </article>
  );
}
