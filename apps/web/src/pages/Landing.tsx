import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles, Code2, Orbit, GalleryVerticalEnd, ArrowRight, Rocket, ShieldCheck } from 'lucide-react';
import '../styles/landing.css';

export default function LandingPage() {
  useEffect(() => {
    document.body.classList.add('landing-page-active');
    return () => {
      document.body.classList.remove('landing-page-active');
    };
  }, []);

  return (
    <div className="landing">
      <div className="landing-aura" aria-hidden="true" />

      <header className="landing-nav">
        <div className="landing-logo">
          <Sparkles className="h-5 w-5" />
          <span>Terranet</span>
        </div>
        <nav className="landing-nav-links">
          <a href="#platform">Platform</a>
          <a href="#proof">Proof</a>
          <Link to="/auth">Sign In</Link>
          <Link to="/auth" className="landing-nav-cta">
            Start Free
          </Link>
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-kicker">Generative Visual Engine</p>
            <h1>Build living visuals at conversation speed.</h1>
            <p className="landing-hero-description">
              Terranet turns rough ideas into production-ready visuals, animation flows, and scene revisions in one chat-first workspace.
            </p>
            <div className="landing-hero-actions">
              <Link to="/auth" className="landing-cta-primary">
                Launch Workspace <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#proof" className="landing-cta-secondary">See examples</a>
            </div>
            <ul className="landing-hero-metrics">
              <li>
                <strong>3x</strong>
                <span>faster visual iteration</span>
              </li>
              <li>
                <strong>7-step</strong>
                <span>orchestration pipeline</span>
              </li>
              <li>
                <strong>Live</strong>
                <span>preview and code sync</span>
              </li>
            </ul>
          </div>

          <div className="landing-hero-stage" aria-label="Generated scene preview">
            <article className="landing-stage-card landing-stage-card--console">
              <header>
                <span>Turn Pipeline</span>
                <small>24ms orchestration tick</small>
              </header>
              <ol>
                <li><span>parse</span><em>intent classified as animate</em></li>
                <li><span>select</span><em>manim scored highest</em></li>
                <li><span>generate</span><em>scene code streaming</em></li>
                <li><span>execute</span><em>preview artifact published</em></li>
              </ol>
            </article>

            <article className="landing-stage-card landing-stage-card--code">
              <header>
                <Code2 className="h-4 w-4" />
                <span>artifact scene.ts</span>
              </header>
              <pre>{`const pulse = timeline()
  .to(camera, { z: 2.8 }, 0)
  .to(core, { rotateY: Math.PI * 2 }, 0)
  .to(rings, { opacity: [0, 1] }, 0.3)`}</pre>
            </article>
          </div>
        </section>

        <section id="platform" className="landing-features">
          <div className="landing-section-head">
            <p>Platform</p>
            <h2>One studio for prompt, code, preview, and revision.</h2>
          </div>

          <div className="landing-feature-grid">
            <FeatureCard
              icon={<Orbit className="h-5 w-5" />}
              title="Skill-aware generation"
              description="Router selects the best engine for 3D, animation, and data visuals with deterministic fallback behavior."
            />
            <FeatureCard
              icon={<GalleryVerticalEnd className="h-5 w-5" />}
              title="Revision-native workflow"
              description="Every turn keeps scene history navigable, so teams can compare and recover high-quality outputs quickly."
            />
            <FeatureCard
              icon={<Rocket className="h-5 w-5" />}
              title="Execution in the loop"
              description="Generated code is validated, sandboxed, and previewed instantly so intent and result stay tightly coupled."
            />
          </div>
        </section>

        <section id="proof" className="landing-proof">
          <div className="landing-section-head">
            <p>Proof</p>
            <h2>Built for teams shipping visuals under pressure.</h2>
          </div>

          <div className="landing-proof-grid">
            <ProofCard
              title="Launch visuals in one afternoon"
              description="Design and engineering teams can move from concept prompt to reviewed scene artifact in a single loop."
              stat="4.8x faster"
            />
            <ProofCard
              title="Stability-first model routing"
              description="Provider failover and deterministic fallback keep generation responsive even during upstream model instability."
              stat="99.2% turn success"
            />
            <ProofCard
              title="Auditable orchestration trace"
              description="Each stage emits lifecycle events for debugging, review, and product telemetry without breaking API contracts."
              stat="100% traceable"
            />
          </div>
        </section>

        <section className="landing-final-cta">
          <div>
            <h2>Bring your next visual system online.</h2>
            <p>Start free, invite your team, and ship interactive visuals with a chat-first workflow.</p>
          </div>
          <div className="landing-final-cta__actions">
            <Link to="/auth" className="landing-cta-primary">Start Building</Link>
            <a href="#platform" className="landing-cta-secondary">
              <ShieldCheck className="h-4 w-4" />
              Runtime-safe pipeline
            </a>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <Sparkles className="h-4 w-4" />
          <span>Terranet</span>
        </div>
        <p>© 2026 Terranet. Built for generative visual engineering.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <article className="landing-feature-card">
      <div className="landing-feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}

function ProofCard({ title, description, stat }: { title: string; description: string; stat: string }) {
  return (
    <article className="landing-proof-card">
      <span className="landing-proof-card__stat">{stat}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </article>
  );
}
