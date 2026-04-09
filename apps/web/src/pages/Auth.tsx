import { SignIn, SignUp } from '@clerk/clerk-react';
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles, ShieldCheck, TimerReset, GalleryHorizontalEnd } from 'lucide-react';
import '../styles/auth.css';

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const clerkAppearance = useMemo(
    () => ({
      elements: {
        rootBox: 'auth-clerk-root',
        cardBox: 'auth-clerk-card-box',
        card: 'auth-clerk-card',
        header: 'auth-clerk-header',
        socialButtonsBlockButton: 'auth-clerk-social-button',
        socialButtonsBlockButtonText: 'auth-clerk-social-button-text',
        dividerLine: 'auth-clerk-divider-line',
        dividerText: 'auth-clerk-divider-text',
        formFieldLabel: 'auth-clerk-label',
        formFieldInput: 'auth-clerk-input',
        formButtonPrimary: 'auth-clerk-primary-button',
        footerAction: 'auth-clerk-footer-action',
        footerActionText: 'auth-clerk-footer-text',
        footerActionLink: 'auth-clerk-footer-link',
      },
    }),
    [],
  );

  return (
    <div className="auth-page">
      <section className="auth-stage">
        <div className="auth-stage-header">
          <Link to="/" className="auth-brand-link">
            <Sparkles className="h-5 w-5" />
            <span>Terranet</span>
          </Link>
          <p>Generative Visual Engine</p>
        </div>

        <div className="auth-stage-copy">
          <h1>Sign in to keep your visual workflow in motion.</h1>
          <p>
            Continue from where you left off with session history, live preview state, and artifact revisions in one place.
          </p>
        </div>

        <div className="auth-stage-pillars">
          <article>
            <ShieldCheck className="h-4 w-4" />
            <div>
              <h3>Safe runtime boundaries</h3>
              <p>Validated generation and sandbox execution by default.</p>
            </div>
          </article>
          <article>
            <TimerReset className="h-4 w-4" />
            <div>
              <h3>Fast iteration loop</h3>
              <p>Prompt, preview, and modify without leaving chat context.</p>
            </div>
          </article>
          <article>
            <GalleryHorizontalEnd className="h-4 w-4" />
            <div>
              <h3>Revision-native history</h3>
              <p>Navigate scene and artifact versions with full traceability.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="auth-container">
        <div className="auth-card">
          <header className="auth-card-header">
            <h2>{isSignUp ? 'Create your workspace' : 'Welcome back'}</h2>
            <p>{isSignUp ? 'Start building visuals in minutes.' : 'Sign in to continue your active sessions.'}</p>
          </header>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${!isSignUp ? 'active' : ''}`}
              onClick={() => setIsSignUp(false)}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab ${isSignUp ? 'active' : ''}`}
              onClick={() => setIsSignUp(true)}
            >
              Sign Up
            </button>
          </div>

          <div className="auth-form">
            {isSignUp ? (
              <SignUp 
                key="auth-sign-up"
                routing="path"
                path="/auth"
                signInUrl="/auth"
                redirectUrl="/chat"
                appearance={clerkAppearance}
              />
            ) : (
              <SignIn 
                key="auth-sign-in"
                routing="path"
                path="/auth"
                signUpUrl="/auth"
                redirectUrl="/chat"
                appearance={clerkAppearance}
              />
            )}
          </div>
        </div>

        <p className="auth-footer">
          By continuing, you agree to Terranet's Terms of Service and Privacy Policy.
        </p>
      </section>
    </div>
  );
}
