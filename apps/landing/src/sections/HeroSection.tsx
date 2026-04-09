import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Play } from 'lucide-react';
import { getWebAppUrl } from '../lib/urls';

gsap.registerPlugin(ScrollTrigger);

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const orbRef = useRef<HTMLImageElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadlineRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const microLabelRef = useRef<HTMLSpanElement>(null);
  const bottomLeftRef = useRef<HTMLParagraphElement>(null);
  const bottomRightRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const orb = orbRef.current;
    const headline = headlineRef.current;
    const subheadline = subheadlineRef.current;
    const cta = ctaRef.current;
    const microLabel = microLabelRef.current;
    const bottomLeft = bottomLeftRef.current;
    const bottomRight = bottomRightRef.current;

    if (!section || !orb || !headline || !subheadline || !cta || !microLabel || !bottomLeft || !bottomRight) return;

    const ctx = gsap.context(() => {
      // Initial state - all hidden
      gsap.set([orb, headline, subheadline, cta, microLabel, bottomLeft, bottomRight], { opacity: 0 });
      gsap.set(orb, { scale: 0.92, y: '6vh' });
      gsap.set(headline, { y: 40 });
      gsap.set([subheadline, cta], { y: 18 });
      gsap.set([bottomLeft, bottomRight], { y: 20 });

      // Auto-play entrance animation
      const entranceTl = gsap.timeline({ delay: 0.2 });

      entranceTl
        .to(microLabel, { opacity: 1, duration: 0.6, ease: 'power2.out' })
        .to(orb, { opacity: 1, scale: 1, y: 0, duration: 1, ease: 'power2.out' }, 0.1)
        .to(headline, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, 0.3)
        .to(subheadline, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0.5)
        .to(cta, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' }, 0.6)
        .to([bottomLeft, bottomRight], { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.1 }, 0.7);

      // Scroll-driven exit animation
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=130%',
          pin: true,
          scrub: 0.6,
          onLeaveBack: () => {
            // Reset all elements to visible when scrolling back to top
            gsap.to([orb, headline, subheadline, cta, microLabel, bottomLeft, bottomRight], {
              opacity: 1,
              y: 0,
              scale: 1,
              duration: 0.3
            });
          }
        }
      });

      // SETTLE phase: 0% - 70% (hold position)
      // EXIT phase: 70% - 100%
      scrollTl
        .fromTo(headline, 
          { y: 0, opacity: 1 }, 
          { y: '-18vh', opacity: 0, ease: 'power2.in' }, 
          0.7
        )
        .fromTo(orb, 
          { scale: 1, y: 0, opacity: 1 }, 
          { scale: 0.85, y: '-10vh', opacity: 0.35, ease: 'power2.in' }, 
          0.7
        )
        .fromTo([subheadline, cta], 
          { y: 0, opacity: 1 }, 
          { y: '-12vh', opacity: 0, ease: 'power2.in', stagger: 0.02 }, 
          0.72
        )
        .fromTo([bottomLeft, bottomRight], 
          { y: 0, opacity: 1 }, 
          { y: '6vh', opacity: 0, ease: 'power2.in', stagger: 0.05 }, 
          0.75
        )
        .fromTo(microLabel, 
          { opacity: 1 }, 
          { opacity: 0, ease: 'power2.in' }, 
          0.8
        );

    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section 
      ref={sectionRef} 
      className="section-pinned bg-charcoal flex items-center justify-center z-10"
    >
      {/* Micro label - top center */}
      <span 
        ref={microLabelRef}
        className="micro-label text-secondary-light absolute"
        style={{ left: '50%', top: '10%', transform: 'translateX(-50%)' }}
      >
        GenVis
      </span>

      {/* Orb - center */}
      <img 
        ref={orbRef}
        src="/hero_orb.jpg" 
        alt="Generative Orb"
        className="absolute animate-float"
        style={{ 
          left: '50%', 
          top: '52%', 
          transform: 'translate(-50%, -50%)',
          width: 'min(56vw, 72vh)',
          maxWidth: '700px',
          borderRadius: '50%'
        }}
      />

      {/* Headline - center over orb */}
      <h1 
        ref={headlineRef}
        className="font-display font-bold text-primary-light headline-hero uppercase absolute text-center"
        style={{ 
          left: '50%', 
          top: '52%', 
          transform: 'translate(-50%, -50%)',
          textShadow: '0 4px 30px rgba(0,0,0,0.5)'
        }}
      >
        Design the<br />Impossible
      </h1>

      {/* Subheadline */}
      <p 
        ref={subheadlineRef}
        className="body-text text-secondary-light absolute text-center max-w-xl"
        style={{ left: '50%', top: '68%', transform: 'translateX(-50%)' }}
      >
        A real-time creative system for 3D worlds, motion, and interactive media.
      </p>

      {/* CTA Row */}
      <div 
        ref={ctaRef}
        className="absolute flex items-center gap-4"
        style={{ left: '50%', top: '78%', transform: 'translateX(-50%)' }}
      >
        <a className="btn-primary flex items-center gap-2" href={getWebAppUrl()}>
          Start Building
          <ArrowRight className="w-4 h-4" />
        </a>
        <button className="btn-secondary flex items-center gap-2">
          <Play className="w-4 h-4" />
          View Demo
        </button>
      </div>

      {/* Bottom left paragraph */}
      <p 
        ref={bottomLeftRef}
        className="text-sm text-secondary-light absolute"
        style={{ left: '6vw', top: '82%', maxWidth: '28vw' }}
      >
        Build scenes, materials, and motion logic—then publish anywhere.
      </p>

      {/* Bottom right paragraph */}
      <p 
        ref={bottomRightRef}
        className="text-sm text-secondary-light absolute"
        style={{ left: '72vw', top: '82%', maxWidth: '22vw' }}
      >
        Used by teams who ship campaigns, products, and experiences.
      </p>
    </section>
  );
}
