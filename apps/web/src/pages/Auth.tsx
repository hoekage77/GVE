import { SignIn, SignUp } from '@clerk/clerk-react';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import '../styles/auth.css';

export default function AuthPage() {
  const [isSignUp, setIsSignUp] = useState(false);

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">
          <Link to="/">
            <Sparkles className="h-8 w-8" />
            <span>Terranet</span>
          </Link>
          <p>Generative Visual Intelligence</p>
        </div>

        <div className="auth-card">
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
                routing="path"
                path="/auth"
                signInUrl="/auth"
                redirectUrl="/chat"
              />
            ) : (
              <SignIn 
                routing="path"
                path="/auth"
                signUpUrl="/auth"
                redirectUrl="/chat"
              />
            )}
          </div>
        </div>

        <p className="auth-footer">
          By continuing, you agree to Terranet's Terms of Service and Privacy Policy.
        </p>
      </div>

      <div className="auth-hero">
        <div className="auth-hero-content">
          <h2>Create with AI</h2>
          <p>
            Join thousands of developers and designers using Terranet to 
            generate interactive visual experiences.
          </p>
          <div className="auth-hero-features">
            <span>🎨 Visual Creation</span>
            <span>⚡ Real-time Preview</span>
            <span>🚀 One-click Deploy</span>
          </div>
        </div>
      </div>
    </div>
  );
}
