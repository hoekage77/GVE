import './App.css';

import Navigation from './components/Navigation';
import HeroSection from './sections/HeroSection';
import WireframeSection from './sections/WireframeSection';
import ParticleSection from './sections/ParticleSection';
import PortraitSection from './sections/PortraitSection';
import FeaturesSection from './sections/FeaturesSection';
import GridSection from './sections/GridSection';
import PricingSection from './sections/PricingSection';
import TestimonialsSection from './sections/TestimonialsSection';
import CTAFooterSection from './sections/CTAFooterSection';
import { useScrollSnap } from './hooks/useScrollSnap';

function App() {
  useScrollSnap();

  return (
    <div className="relative">
      {/* Navigation */}
      <Navigation />

      {/* Grain overlay */}
      <div className="grain-overlay" />

      {/* Main content */}
      <main className="relative">
        {/* Section 1: Hero - pin: true */}
        <HeroSection />

        {/* Section 2: Wireframe World - pin: true */}
        <div id="workflow">
          <WireframeSection />
        </div>

        {/* Section 3: Particle Field - pin: true */}
        <ParticleSection />

        {/* Section 4: Portrait Split - pin: true */}
        <PortraitSection />

        {/* Section 5: Features - pin: false */}
        <div id="features">
          <FeaturesSection />
        </div>

        {/* Section 6: Grid Floor - pin: true */}
        <GridSection />

        {/* Section 7: Pricing - pin: false */}
        <div id="pricing">
          <PricingSection />
        </div>

        {/* Section 8: Testimonials - pin: false */}
        <TestimonialsSection />

        {/* Section 9: CTA + Footer - pin: false */}
        <div id="docs">
          <CTAFooterSection />
        </div>
      </main>
    </div>
  );
}

export default App;
