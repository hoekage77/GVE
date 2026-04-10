import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Images } from 'lucide-react';
import { getWebAppUrl } from '../lib/urls';

gsap.registerPlugin(ScrollTrigger);

export default function PortraitSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const microLabelRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const image = imageRef.current;
    const content = contentRef.current;
    const headline = headlineRef.current;
    const body = bodyRef.current;
    const cta = ctaRef.current;
    const microLabel = microLabelRef.current;

    if (!section || !image || !content || !headline || !body || !cta || !microLabel) return;

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
          { x: '-20vw', opacity: 0 }, 
          { x: 0, opacity: 1, ease: 'none' }, 
          0
        )
        .fromTo(content, 
          { x: '12vw', opacity: 0 }, 
          { x: 0, opacity: 1, ease: 'none' }, 
          0
        )
        .fromTo(headline, 
          { y: 40, opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none' }, 
          0.08
        )
        .fromTo(body, 
          { y: 25, opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none' }, 
          0.12
        )
        .fromTo(cta, 
          { y: 18, opacity: 0 }, 
          { y: 0, opacity: 1, ease: 'none' }, 
          0.16
        )
        .fromTo(microLabel, 
          { opacity: 0 }, 
          { opacity: 1, ease: 'none' }, 
          0.06
        );

      // Complete entrance by 30%
      scrollTl.to({}, {}, 0.3);

      // SETTLE: 30% - 70% (hold position)

      // EXIT: 70% - 100%
      scrollTl
        .fromTo(content, 
          { x: 0, opacity: 1 }, 
          { x: '10vw', opacity: 0, ease: 'power2.in' }, 
          0.7
        )
        .fromTo(image, 
          { opacity: 1 }, 
          { opacity: 0.35, ease: 'power2.in' }, 
          0.7
        )
        .fromTo([headline, body, cta], 
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
      className="section-pinned bg-charcoal flex flex-col md:flex-row z-40"
    >
      {/* Left portrait image */}
      <div className="relative w-full md:w-1/2 h-[42vh] md:h-full overflow-hidden">
        <img 
          ref={imageRef}
          src="/portrait_model.jpg" 
          alt="Creative Professional"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: 0 }}
        />
        {/* Subtle gradient overlay on image edge */}
        <div 
          className="absolute inset-y-0 right-0 w-24 pointer-events-none"
          style={{ background: 'linear-gradient(to right, transparent, rgba(11,13,16,0.5))' }}
        />
      </div>

      {/* Vertical divider */}
      <div 
        className="absolute top-0 bottom-0 w-px bg-white/10 hidden md:block"
        style={{ left: '50%' }}
      />

      {/* Right content area */}
      <div className="w-full md:w-1/2 h-[58vh] md:h-full flex items-center justify-center relative">
        <div 
          ref={contentRef}
          className="max-w-md px-6 md:px-8 pb-8 md:pb-0"
          style={{ opacity: 0 }}
        >
          {/* Micro label */}
          <span 
            ref={microLabelRef}
            className="micro-label text-secondary-light block mb-6"
          >
            Stories
          </span>

          {/* Headline */}
          <h2 
            ref={headlineRef}
            className="font-display font-bold text-primary-light headline-section uppercase mb-6"
          >
            Own the Moment
          </h2>

          {/* Body text */}
          <p 
            ref={bodyRef}
            className="body-text text-secondary-light mb-8"
          >
            Great work needs a great stage. Publish scenes as links, embeds, or high-res exports—and let your audience step inside.
          </p>
        </div>
      </div>

      {/* CTA Row */}
      <div
        ref={ctaRef}
        className="landing-section-cta absolute z-10 flex items-center gap-4"
        style={{ left: '50%', top: '72%', transform: 'translateX(-50%)' }}
      >
        <a className="btn-primary flex items-center gap-2" href={getWebAppUrl()}>
          Start Creating
          <ArrowRight className="w-4 h-4" />
        </a>
        <button className="btn-secondary flex items-center gap-2">
          <Images className="w-4 h-4" />
          View Gallery
        </button>
      </div>
    </section>
  );
}
