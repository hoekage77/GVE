import { Link } from '@tanstack/react-router';
import { GalleryVerticalEnd } from 'lucide-react';
import { useEffect } from 'react';
import { LoginForm } from '../components/login-form';

export default function AuthPage() {
  useEffect(() => {
    document.title = 'GenVis | Authentication';
  }, []);

  return (
    <div className="relative min-h-svh h-svh overflow-hidden bg-auth-bg text-auth-ink font-[Inter,'Space_Grotesk',sans-serif]">
      <img
        src="/wireframe_landscape.jpg"
        alt="Wireframe Landscape"
        className="fixed inset-0 w-full h-full object-cover opacity-15 animate-drift-x z-0"
      />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_35%,rgba(0,0,0,0.85)_100%)] z-[1] pointer-events-none" />

      <div className="relative z-10 h-svh min-h-svh flex flex-col items-center justify-center overflow-y-auto overflow-x-hidden overscroll-contain p-[clamp(0.8rem,2.2vw,1.5rem)] max-[860px]:h-auto max-[860px]:justify-start max-[860px]:pt-5 max-[860px]:pb-5">
        <div className="w-full max-w-[28rem] max-sm:max-w-[24rem] mx-auto flex flex-col gap-4">
          <Link to="/" className="w-max inline-flex items-center gap-[0.45rem] self-center text-auth-accent no-underline font-bold font-[Space_Grotesk,sans-serif]" aria-label="Go to GenVis home">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-[0.45rem] bg-auth-accent text-auth-bg shadow-[0_4px_12px_rgba(255,106,61,0.35)]">
              <GalleryVerticalEnd className="h-4 w-4" />
            </span>
            <span className="text-lg">GenVis</span>
          </Link>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
