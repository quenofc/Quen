import React, { lazy, Suspense, useEffect } from 'react';
import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import PartnersSection from './components/PartnersSection';
import ProductSection from './components/ProductSection';
import FeaturesSection from './components/FeaturesSection';
import LabSection from './components/LabSection';
import WorkflowSection from './components/WorkflowSection';
import PricingSection from './components/PricingSection';
import IntegrationSection from './components/IntegrationSection';
import CtaSection from './components/CtaSection';
import FooterSection from './components/FooterSection';
import { initAllAnimations } from './animations';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
const LiquidityApp = lazy(() => import('./app/LiquidityApp'));
const RwaGateway = lazy(() => import('./app/RwaGateway'));
const SettlementApp = lazy(() => import('./app/SettlementApp'));
const DocsPage = lazy(() => import('./docs/DocsPage'));

export default function App() {
  if (window.location.pathname === '/docs') {
    return <Suspense fallback={<div className="app-route-loading">LOADING DOCUMENTATION</div>}><DocsPage /></Suspense>;
  }
  if (window.location.pathname === '/app/rwa') {
    return (
      <Suspense fallback={<div className="app-route-loading">INITIALIZING RWA GATEWAY</div>}>
        <RwaGateway />
      </Suspense>
    );
  }
  if (window.location.pathname === '/app/settlement') {
    return <Suspense fallback={<div className="app-route-loading">INITIALIZING SETTLEMENT RAILS</div>}><SettlementApp /></Suspense>;
  }

  if (window.location.pathname === '/app') {
    return (
      <Suspense fallback={<div className="app-route-loading">INITIALIZING QUEN NETWORK</div>}>
        <LiquidityApp />
      </Suspense>
    );
  }

  return <LandingPage />;
}

function LandingPage() {
  useEffect(() => {
    // Wait for DOM layout and images to settle
    const timer = setTimeout(() => {
      initAllAnimations();
      ScrollTrigger.refresh();
      if (window.location.hash) {
        requestAnimationFrame(() => {
          document.querySelector(window.location.hash)?.scrollIntoView();
        });
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  return (
    <div className="w-full min-h-screen bg-black text-white selection:bg-blue-600 selection:text-white">
      <Navbar />
      <main>
        <HeroSection />
        <PartnersSection />
        <ProductSection />
        <FeaturesSection />
        <LabSection />
        <WorkflowSection />
        <PricingSection />
        <IntegrationSection />
        <CtaSection />
      </main>
      <FooterSection />
      <section id="contact" className="wrapper-footer anchor" />
    </div>
  );
}


