import { Link } from '@tanstack/react-router';
import { GalleryVerticalEnd, Sparkles, Box, BarChart3, Atom, Zap, ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import { LoginForm } from '../components/login-form';
import '../styles/auth-landing.css';
/* ── Animated showcase cards ── */

function OrbitingCube() {
  return (
    <div className="showcase-card-scene" aria-hidden>
      <div className="cube-wrap">
        <div className="cube-face cube-front" />
        <div className="cube-face cube-back" />
        <div className="cube-face cube-left" />
        <div className="cube-face cube-right" />
        <div className="cube-face cube-top" />
        <div className="cube-face cube-bottom" />
      </div>
      <div className="cube-shadow" />
    </div>
  );
}

function ParticleField() {
  return (
    <div className="showcase-card-scene" aria-hidden>
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className="particle"
          style={{
            '--dx': `${(Math.random() - 0.5) * 120}px`,
            '--dy': `${(Math.random() - 0.5) * 100}px`,
            '--delay': `${Math.random() * 3}s`,
            '--dur': `${2.5 + Math.random() * 2}s`,
            '--size': `${2 + Math.random() * 3}px`,
            left: `${20 + Math.random() * 60}%`,
            top: `${20 + Math.random() * 60}%`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function DataBars() {
  return (
    <div className="showcase-card-scene showcase-bars" aria-hidden>
      {[65, 85, 45, 72, 55, 90, 38].map((h, i) => (
        <div
          key={i}
          className="data-bar"
          style={{
            '--target-h': `${h}%`,
            '--delay': `${i * 0.12}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

function PhysicsOrbit() {
  return (
    <div className="showcase-card-scene" aria-hidden>
      <div className="orbit-ring orbit-ring-1">
        <div className="orbit-dot" />
      </div>
      <div className="orbit-ring orbit-ring-2">
        <div className="orbit-dot orbit-dot-2" />
      </div>
      <div className="orbit-ring orbit-ring-3">
        <div className="orbit-dot orbit-dot-3" />
      </div>
      <div className="orbit-center" />
    </div>
  );
}

const CAPABILITIES = [
  {
    icon: Box,
    title: '3D Scenes',
    desc: 'Three.js powered real-time 3D environments with orbit controls and lighting.',
    Scene: OrbitingCube,
    gradient: 'from-blue-500/20 to-cyan-500/20',
    iconColor: '#38bdf8',
  },
  {
    icon: Sparkles,
    title: 'Particle Systems',
    desc: 'Generative particle effects, trails, and dynamic visual compositions.',
    Scene: ParticleField,
    gradient: 'from-violet-500/20 to-fuchsia-500/20',
    iconColor: '#a78bfa',
  },
  {
    icon: BarChart3,
    title: 'Data Visualization',
    desc: 'Animated charts, graphs, and D3.js-driven interactive data stories.',
    Scene: DataBars,
    gradient: 'from-emerald-500/20 to-teal-500/20',
    iconColor: '#34d399',
  },
  {
    icon: Atom,
    title: 'Physics & Simulation',
    desc: 'Orbital mechanics, wave functions, and real-time physics simulations.',
    Scene: PhysicsOrbit,
    gradient: 'from-amber-500/20 to-orange-500/20',
    iconColor: '#fbbf24',
  },
];

export default function AuthPage() {
  useEffect(() => {
    document.title = 'GenVis | Generative Visual Engine';
  }, []);

  return (
    <div className="auth-landing">
      {/* Background layers */}
      <img
        src="/wireframe_landscape.jpg"
        alt=""
        className="auth-bg-image"
      />
      <div className="auth-bg-vignette" />
      <div className="auth-bg-grid" />

      {/* Content */}
      <div className="auth-content">
        {/* ── Left: Hero + Showcase ── */}
        <div className="auth-hero">
          {/* Logo */}
          <Link to="/" className="auth-logo" aria-label="GenVis home">
            <span className="auth-logo-icon">
              <GalleryVerticalEnd className="h-4 w-4" />
            </span>
            <span className="auth-logo-text">GenVis</span>
          </Link>

          {/* Hero text */}
          <div className="auth-hero-text">
            <h1 className="auth-headline">
              Describe it.
              <br />
              <span className="auth-headline-accent">Watch it come alive.</span>
            </h1>
            <p className="auth-subline">
              GenVis turns natural language into real-time 3D scenes, data visualizations,
              particle systems, and interactive simulations — all in your browser.
            </p>
          </div>

          {/* Capability showcase */}
          <div className="auth-showcase">
            {CAPABILITIES.map(({ icon: Icon, title, desc, Scene, gradient, iconColor }) => (
              <div key={title} className={`showcase-card bg-gradient-to-br ${gradient}`}>
                <Scene />
                <div className="showcase-card-content">
                  <div className="showcase-card-header">
                    <Icon className="h-4 w-4 shrink-0" style={{ color: iconColor }} />
                    <span className="showcase-card-title">{title}</span>
                  </div>
                  <p className="showcase-card-desc">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom tagline (desktop only) */}
          <div className="auth-footer-tag">
            <Zap className="h-3.5 w-3.5 text-auth-accent" />
            <span>Powered by Three.js, p5.js, D3.js, and Anime.js</span>
          </div>
        </div>

        {/* ── Right: Login Form ── */}
        <div className="auth-form-panel">
          <div className="auth-form-inner">
            <Link to="/" className="auth-form-logo" aria-label="GenVis home">
              <span className="auth-logo-icon">
                <GalleryVerticalEnd className="h-4 w-4" />
              </span>
              <span className="auth-logo-text">GenVis</span>
            </Link>
            <LoginForm />
            <p className="auth-legal">
              By continuing, you agree to GenVis's Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
