import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Calendar } from 'lucide-react';
import { getWebAppUrl } from '../lib/urls';

gsap.registerPlugin(ScrollTrigger);

const footerLinks = {
  Product: ['Features', 'Pricing', 'Changelog', 'Roadmap'],
  Resources: ['Docs', 'Tutorials', 'API', 'Support'],
  Legal: ['Privacy', 'Terms', 'Cookies'],
};

export default function CTAFooterSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const cta = ctaRef.current;
    const footer = footerRef.current;

    if (!section || !cta || !footer) return;

    const ctx = gsap.context(() => {
      // CTA animation
      gsap.fromTo(cta,
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: cta,
            start: 'top 80%',
            end: 'top 50%',
            scrub: 1,
          }
        }
      );

      // Footer animation
      gsap.fromTo(footer,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.6,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: footer,
            start: 'top 90%',
            end: 'top 70%',
            scrub: 1,
          }
        }
      );

    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section 
      ref={sectionRef} 
      className="bg-charcoal z-[90]"
    >
      {/* CTA Block */}
      <div 
        ref={ctaRef}
        className="py-24 md:py-32 text-center px-6"
      >
        <h2 className="font-display font-bold text-primary-light text-4xl md:text-6xl mb-4">
          Start building today.
        </h2>
        <p className="body-text text-secondary-light max-w-xl mx-auto mb-8">
          No credit card. No setup time. Just make something.
        </p>
        <div className="flex items-center justify-center gap-4">
          <a className="btn-primary flex items-center gap-2" href={getWebAppUrl()}>
            Get Started Free
            <ArrowRight className="w-4 h-4" />
          </a>
          <button className="btn-secondary flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Schedule a Demo
          </button>
        </div>
      </div>

      {/* Footer */}
      <div 
        ref={footerRef}
        className="border-t border-white/5 py-12 px-6"
      >
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            {/* Logo column */}
            <div>
              <span className="font-display font-bold text-primary-light text-xl">
                GenVis
              </span>
              <p className="text-secondary-light text-sm mt-2">
                Real-time creative platform
              </p>
            </div>

            {/* Link columns */}
            {Object.entries(footerLinks).map(([category, links]) => (
              <div key={category}>
                <h4 className="font-semibold text-primary-light text-sm mb-4">
                  {category}
                </h4>
                <ul className="space-y-2">
                  {links.map((link) => (
                    <li key={link}>
                      <a 
                        href="#" 
                        className="text-secondary-light text-sm hover:text-primary-light transition-colors"
                      >
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Copyright */}
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-secondary-light text-xs">
              © {new Date().getFullYear()} GenVis. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-secondary-light text-xs hover:text-primary-light transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="text-secondary-light text-xs hover:text-primary-light transition-colors">
                Terms of Service
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
