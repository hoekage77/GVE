import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { WEB_APP_URL } from '../lib/urls';

gsap.registerPlugin(ScrollTrigger);

export default function GridSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const subheadlineRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const microLabelRef = useRef<HTMLSpanElement>(null);
  const bottomLeftRef = useRef<HTMLParagraphElement>(null);
  const bottomRightRef = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const image = imageRef.current;
    const headline = headlineRef.current;
    const subheadline = subheadlineRef.current;
    const cta = ctaRef.current;
    const microLabel = microLabelRef.current;
    const bottomLeft = bottomLeftRef.current;
    const bottomRight = bottomRightRef.current;

    if (!section || !image || !headline || !subheadline || !cta || !microLabel || !bottomLeft || !bottomRight) return;

    const ctx = gsap.context(() => {
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=130%',
          pin: true,
          scrub: 0.6,
        }
      });

      // ENTRANCE: 0% - 30%
      scrollTl
        .fromTo(image, 
          { opacity: 0, scale: 1.05 }, 
          { opacity: 0.6, scale: 1, ease: 'none' }, 
          0
        )
        .fromTo(headline, 
          { y: '18vh', opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none' }, 
          0
        )
        .fromTo(subheadline, 
          { y: '10vh', opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none' }, 
          0.05
        )
        .fromTo(cta, 
          { y: '10vh', opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none' }, 
          0.1
        )
        .fromTo([bottomLeft, bottomRight], 
          { y: '6vh', opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none', stagger: 0.02 }, 
          0.12
        )
        .fromTo(microLabel, 
          { opacity: 0 }, 
          { opacity: 1, ease: 'none' }, 
          0.08
        );

      // Complete entrance by 30%
      scrollTl.to({}, {}, 0.3);

      // SETTLE: 30% - 70% (hold position)

      // EXIT: 70% - 100%
      scrollTl
        .fromTo(headline, 
          { y: 0, opacity: 1 }, 
          { y: '-16vh', opacity: 0, ease: 'power2.in' }, 
          0.7
        )
        .fromTo(image, 
          { opacity: 0.6, scale: 1 }, 
          { opacity: 0.2, scale: 1.04, ease: 'power2.in' }, 
          0.7
        )
        .fromTo([subheadline, cta], 
          { opacity: 1 }, 
          { opacity: 0, ease: 'power2.in', stagger: 0.02 }, 
          0.72
        )
        .fromTo([bottomLeft, bottomRight], 
          { opacity: 1 }, 
          { opacity: 0, ease: 'power2.in', stagger: 0.02 }, 
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
      className="section-pinned bg-charcoal flex items-center justify-center z-[60]"
    >
      {/* Grid floor background */}
      <img 
        ref={imageRef}
        src="/grid_floor.jpg" 
        alt="Grid Floor"
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: 0 }}
      />

      {/* Vignette */}
      <div className="vignette" />

      {/* Micro label */}
      <span 
        ref={microLabelRef}
        className="micro-label text-secondary-light absolute"
        style={{ left: '50%', top: '10%', transform: 'translateX(-50%)' }}
      >
        Depth
      </span>

      {/* Headline */}
      <h2 
        ref={headlineRef}
        className="font-display font-bold text-primary-light headline-section uppercase absolute text-center"
        style={{ 
          left: '50%', 
          top: '54%', 
          transform: 'translate(-50%, -50%)',
          textShadow: '0 4px 30px rgba(0,0,0,0.8)'
        }}
      >
        Design Without<br />Limits
      </h2>

      {/* Subheadline */}
      <p 
        ref={subheadlineRef}
        className="body-text text-secondary-light absolute text-center max-w-xl"
        style={{ left: '50%', top: '66%', transform: 'translateX(-50%)' }}
      >
        From first sketch to final pixel—one system, full control.
      </p>

      {/* CTA Row */}
      <div 
        ref={ctaRef}
        className="absolute flex items-center gap-4"
        style={{ left: '50%', top: '76%', transform: 'translateX(-50%)' }}
      >
        <a className="btn-primary flex items-center gap-2" href={WEB_APP_URL}>
          Get Started
          <ArrowRight className="w-4 h-4" />
        </a>
        <button className="btn-secondary flex items-center gap-2">
          <MessageCircle className="w-4 h-4" />
          Talk to Sales
        </button>
      </div>

      {/* Bottom left */}
      <p 
        ref={bottomLeftRef}
        className="text-sm text-secondary-light absolute"
        style={{ left: '6vw', top: '82%', maxWidth: '28vw' }}
      >
        Scenes, components, and design tokens—reusable and versioned.
      </p>

      {/* Bottom right */}
      <p 
        ref={bottomRightRef}
        className="text-sm text-secondary-light absolute"
        style={{ left: '72vw', top: '82%', maxWidth: '22vw' }}
      >
        Built for teams who care about craft—and performance.
      </p>
    </section>
  );
}
