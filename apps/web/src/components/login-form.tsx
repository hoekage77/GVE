import { SignIn, SignUp } from '@clerk/clerk-react';
import { useMemo, useState } from 'react';

export function LoginForm() {
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
    <section className="auth-container">
      <div className="auth-card">
        <header className="auth-card-header">
          <h2>{isSignUp ? 'Create your workspace' : 'Welcome back'}</h2>
          <p>{isSignUp ? 'Start building visuals in minutes.' : 'Sign in to continue your active sessions.'}</p>
        </header>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            className={`auth-tab ${!isSignUp ? 'active' : ''}`}
            onClick={() => setIsSignUp(false)}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
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
              routing="virtual"
              redirectUrl="/chat"
              appearance={clerkAppearance}
            />
          ) : (
            <SignIn
              key="auth-sign-in"
              routing="virtual"
              redirectUrl="/chat"
              appearance={clerkAppearance}
            />
          )}
        </div>
      </div>

      <p className="auth-footer">
        By continuing, you agree to GenVis's Terms of Service and Privacy Policy.
      </p>
    </section>
  );
}