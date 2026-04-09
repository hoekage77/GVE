import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Check } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const plans = [
  {
    name: 'Starter',
    price: 'Free',
    period: '',
    features: [
      '3 scenes',
      'Community support',
      'Web export',
      'Basic templates',
    ],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/mo',
    features: [
      'Unlimited scenes',
      'Private projects',
      'HD export',
      'Priority support',
      'Advanced shaders',
      'Team collaboration',
    ],
    cta: 'Start Pro',
    highlighted: true,
  },
  {
    name: 'Team',
    price: '$89',
    period: '/mo',
    features: [
      'Everything in Pro',
      'Team library',
      'SSO authentication',
      'Audit logs',
      'SLA guarantee',
      'Dedicated support',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

export default function PricingSection() {
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
        { y: 30, opacity: 0 },
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
      cards.forEach((card, index) => {
        gsap.fromTo(card,
          { y: 50, opacity: 0, scale: 0.98 },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.6,
            delay: index * 0.12,
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
      className="bg-charcoal py-24 md:py-32 z-[70]"
    >
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div ref={headerRef} className="text-center mb-16">
          <h2 className="font-display font-bold text-primary-light text-4xl md:text-5xl mb-4">
            Simple pricing. Serious power.
          </h2>
          <p className="body-text text-secondary-light max-w-xl mx-auto">
            Start free. Upgrade when you're ready to ship.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={plan.name}
              ref={el => { cardsRef.current[index] = el; }}
              className={`feature-card p-8 relative ${
                plan.highlighted 
                  ? 'border-accent/50 ring-1 ring-accent/30' 
                  : ''
              }`}
            >
              {/* Popular badge */}
              {plan.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-accent text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}

              {/* Plan name */}
              <h3 className="font-display font-semibold text-primary-light text-xl mb-2">
                {plan.name}
              </h3>

              {/* Price */}
              <div className="flex items-baseline mb-6">
                <span className="font-display font-bold text-primary-light text-4xl">
                  {plan.price}
                </span>
                <span className="text-secondary-light text-sm ml-1">
                  {plan.period}
                </span>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" strokeWidth={2} />
                    <span className="text-secondary-light text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button 
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${
                  plan.highlighted
                    ? 'bg-accent text-white hover:bg-accent/90'
                    : 'bg-white/5 text-primary-light hover:bg-white/10 border border-white/10'
                }`}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
