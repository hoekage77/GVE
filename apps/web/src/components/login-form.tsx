import { SignIn, SignUp } from '../lib/clerk';
import { useMemo, useState } from 'react';

export function LoginForm() {
  const [isSignUp, setIsSignUp] = useState(false);

  const clerkAppearance = useMemo(
    () => ({
      elements: {
        rootBox: 'w-full min-w-0',
        cardBox: 'w-full min-w-0 shadow-none',
        card: 'w-full min-w-0 border-none shadow-none bg-transparent p-0',
        header: 'hidden',
        socialButtonsBlockButton: 'rounded-[0.58rem] min-h-[2.55rem] bg-white/5 border-white/10 text-auth-ink hover:bg-white/10',
        socialButtonsBlockButtonText: '',
        dividerLine: 'bg-white/10',
        dividerText: 'text-auth-muted text-[0.78rem]',
        formFieldLabel: 'text-auth-muted text-[0.84rem] font-semibold',
        formFieldInput: 'rounded-[0.58rem] border-white/10 bg-white/5 text-auth-ink min-h-[2.55rem] shadow-none focus:border-auth-accent focus:shadow-[0_0_0_3px_rgba(255,106,61,0.14)] focus:bg-white/[0.08]',
        formButtonPrimary: 'rounded-[0.68rem] bg-gradient-to-br from-auth-accent to-auth-accent-strong text-auth-bg font-semibold min-h-[2.55rem] transition-all duration-200 hover:brightness-110 hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(255,106,61,0.3)]',
        footerAction: '',
        footerActionText: 'text-slate-500',
        footerActionLink: 'text-auth-accent font-semibold hover:text-auth-accent-strong',
        footer: 'mt-1.5',
      },
    }),
    [],
  );

  return (
    <section className="w-full grid justify-items-center">
      <div className="w-full max-w-[28rem] bg-auth-surface/70 border border-white/[0.08] rounded-[1.15rem] p-[clamp(1.2rem,2.5vw,1.8rem)] max-sm:p-4 shadow-[0_28px_54px_-42px_rgba(0,0,0,0.8),0_0_40px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
        <header className="mb-5 grid gap-1.5 text-center">
          <h2 className="m-0 font-[Space_Grotesk,sans-serif] text-2xl text-auth-ink font-bold">
            {isSignUp ? 'Create your workspace' : 'Welcome back'}
          </h2>
          <p className="m-0 text-auth-muted text-[0.9rem]">
            {isSignUp ? 'Start building visuals in minutes.' : 'Sign in to continue your active sessions.'}
          </p>
        </header>

        <div className="flex w-full border border-white/[0.08] rounded-[0.72rem] p-[0.22rem] gap-[0.22rem] mb-5 bg-auth-bg/60" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            className={`flex-1 border-none bg-transparent text-auth-muted font-semibold text-[0.85rem] rounded-[0.55rem] py-2.5 cursor-pointer transition-all duration-200 hover:bg-white/[0.08] hover:text-auth-ink ${!isSignUp ? 'bg-gradient-to-br from-auth-accent to-auth-accent-strong !text-auth-bg' : ''}`}
            onClick={() => setIsSignUp(false)}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            className={`flex-1 border-none bg-transparent text-auth-muted font-semibold text-[0.85rem] rounded-[0.55rem] py-2.5 cursor-pointer transition-all duration-200 hover:bg-white/[0.08] hover:text-auth-ink ${isSignUp ? 'bg-gradient-to-br from-auth-accent to-auth-accent-strong !text-auth-bg' : ''}`}
            onClick={() => setIsSignUp(true)}
          >
            Sign Up
          </button>
        </div>

        <div className="border-t border-white/[0.08] pt-5">
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

      <p className="mt-6 text-[0.8rem] text-slate-500 text-center">
        By continuing, you agree to GenVis's Terms of Service and Privacy Policy.
      </p>
    </section>
  );
}