import { useState, useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { WEB_APP_URL } from '../lib/urls';

const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Docs', href: '#docs' },
];

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
          isScrolled 
            ? 'bg-charcoal/80 backdrop-blur-md border-b border-white/5' 
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <a href="#" className="font-display font-bold text-primary-light text-xl">
              GenVis
            </a>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-secondary-light text-sm hover:text-primary-light transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden md:flex items-center gap-4">
              <a 
                href={WEB_APP_URL}
                className="text-secondary-light text-sm hover:text-primary-light transition-colors"
              >
                Sign In
              </a>
              <a className="btn-primary text-sm py-2 px-4" href={WEB_APP_URL}>
                Get Started
              </a>
            </div>

            {/* Mobile menu button */}
            <button
              className="md:hidden text-primary-light"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[99] bg-charcoal/95 backdrop-blur-lg md:hidden">
          <div className="flex flex-col items-center justify-center h-full gap-8">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-primary-light text-2xl font-display"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a 
              href={WEB_APP_URL}
              className="text-secondary-light text-xl"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Sign In
            </a>
            <a className="btn-primary mt-4" href={WEB_APP_URL}>
              Get Started
            </a>
          </div>
        </div>
      )}
    </>
  );
}
