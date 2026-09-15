import React from 'react';

const ArrowUpRight = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 15 15 5M7 5h8v8" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export default function FooterSection() {
  return (
    <section id="footer" className="main-section fixed">
      <div className="w-layout-blockcontainer main-container w-container">
        <div className="wrapper-footer quen-footer-stage">
          <footer className="quen-footer-shell">
            <div className="quen-footer-glow" aria-hidden="true" />

            <div className="quen-footer-hero">
              <a href="#hero" className="quen-footer-identity" aria-label="QUEN, back to top">
                <span className="quen-footer-logo-frame">
                  <img src="/quen-logo-blue.png" alt="" className="quen-footer-logo" />
                </span>
                <span className="quen-footer-name">
                  <strong>QUEN</strong>
                  <span>Quality Unified Economy Network</span>
                </span>
              </a>

              <div className="quen-footer-statement">
                <span className="scramble secondary">THE QUALITY LAYER</span>
                <h2>One network for quality finance.</h2>
              </div>
            </div>

            <div className="quen-footer-rule" />

            <div className="quen-footer-navigation">
              <div className="quen-footer-intro">
                <p>
                  Unifying DeFi, real-world assets, and settlement rails through
                  a quality-first economy.
                </p>
                <a href="#hero" className="quen-footer-top-link">
                  Back to top
                  <ArrowUpRight />
                </a>
              </div>

              <nav className="quen-footer-column" aria-label="Products">
                <span>Products</span>
                <a href="/app">Unified Liquidity</a>
                <a href="/app/rwa">RWA Gateway</a>
                <a href="/app/settlement">Settlement Rails</a>
              </nav>

              <nav className="quen-footer-column" aria-label="Network">
                <span>Network</span>
                <a href="/docs">QUEN Documentation</a>
                <a href="#lab">Quality Lab</a>
                <a href="#workflow">Roadmap</a>
              </nav>

              <nav className="quen-footer-column" aria-label="Company">
                <span>Company</span>
                <a href="#integration">Ecosystem</a>
                <a href="https://x.com/QuenOfc" target="_blank" rel="noreferrer">X / @QuenOfc</a>
                <a href="#contact">Contact</a>
                <a href="#hero">About QUEN</a>
              </nav>
            </div>

            <div className="quen-footer-bottom">
              <span>© 2026 QUEN Network</span>
              <span>Quality first. Unified by design.</span>
            </div>
          </footer>
        </div>
      </div>
    </section>
  );
}