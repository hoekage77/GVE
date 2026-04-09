import { Link } from '@tanstack/react-router';
import { GalleryVerticalEnd } from 'lucide-react';
import { useEffect } from 'react';
import { LoginForm } from '../components/login-form';
import '../styles/auth.css';

export default function AuthPage() {
  useEffect(() => {
    document.title = 'GenVis | Authentication';
  }, []);

  return (
    <div className="auth-page">
      <img
        src="/wireframe_landscape.jpg"
        alt="Wireframe Landscape"
        className="auth-bg-image"
      />
      <div className="auth-vignette" />

      <div className="auth-content-overlay">
        <div className="auth-stack">
          <Link to="/" className="auth-brand-link" aria-label="Go to GenVis home">
            <span className="auth-brand-icon">
              <GalleryVerticalEnd className="h-4 w-4" />
            </span>
            <span>GenVis</span>
          </Link>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
