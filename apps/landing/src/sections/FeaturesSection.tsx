import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Eye, GitGraph, Palette, Film, Globe, Users } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    icon: Eye,
    title: 'Real-time Preview',
    description: 'See changes instantly. No compile step.',
  },
  {
    icon: GitGraph,
    title: 'Node Graph',
    description: 'Logic, events, and data—connected.',
  },
  {
    icon: Palette,
    title: 'Materials & Shaders',
    description: 'PBR, procedural, and custom.',
  },
  {
    icon: Film,
    title: 'Animation',
    description: 'Keyframes, rigs, and physics.',
  },
  {
    icon: Globe,
    title: 'Export Anywhere',
    description: 'Web, video, or interactive.',
  },
  {
    icon: Users,
    title: 'Team Sync',
    description: 'Share scenes, review, and ship.',
  },
];

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const header = headerRef.current;
    const cards = cardsRef.current.filter(Boolean);

    if (!section || !header || cards.length === 0) return;

    const ctx = gsap.context(() => {
      // Header animation
      gsap.fromTo(header,
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: header,
            start: 'top 75%',
            end: 'top 45%',
            scrub: 1,
          }
        }
      );

      // Cards animation with stagger
      cards.forEach((card) => {
        gsap.fromTo(card,
          { y: 60, opacity: 0, scale: 0.98 },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.6,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: card,
              start: 'top 80%',
              end: 'top 50%',
              scrub: 1,
            }
          }
        );
      });

    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section 
      ref={sectionRef} 
      className="bg-slate py-24 md:py-32 z-50"
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div ref={headerRef} className="text-center mb-16">
          <h2 className="font-display font-bold text-primary-light text-4xl md:text-5xl mb-4">
            Everything you need to ship.
          </h2>
          <p className="body-text text-secondary-light max-w-2xl mx-auto">
            A complete creative environment—built for speed, designed for control.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              ref={el => { cardsRef.current[index] = el; }}
              className="feature-card p-8 relative group hover:border-accent/30 transition-all duration-300"
            >
              {/* Status dot */}
              <div className="absolute top-6 right-6 w-2 h-2 rounded-full bg-accent" />

              {/* Icon */}
              <feature.icon className="w-8 h-8 text-accent mb-6" strokeWidth={1.5} />

              {/* Title */}
              <h3 className="font-display font-semibold text-primary-light text-xl mb-3">
                {feature.title}
              </h3>

              {/* Description */}
              <p className="text-secondary-light text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
