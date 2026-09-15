import React, { useState } from 'react';

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith('#')) {
      e.preventDefault();
      setMobileMenuOpen(false);
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <div className="navbar">
      <div className="wrapper-navbar logo">
        <a href="#hero" onClick={(e) => handleLinkClick(e, '#hero')} className="w-inline-block">
          <img
            className="logo-navbar"
            src="/quen-logo-blue.png"
            alt=""
            aria-label="QUEN — Quality Unified Economy Network"
          />
        </a>
      </div>

      <div className="wrapper-navbar menu">
        <div className="wrapper-link-navbar">
          <a href="#product" onClick={(e) => handleLinkClick(e, '#product')} className="link-menu w-inline-block">
            <div className="text-secondary menu v1">Product</div>
          </a>
          <a href="#lab" onClick={(e) => handleLinkClick(e, '#lab')} className="link-menu w-inline-block">
            <div className="text-secondary menu v1">Quality Lab</div>
          </a>
          <a href="#workflow" onClick={(e) => handleLinkClick(e, '#workflow')} className="link-menu w-inline-block">
            <div className="text-secondary menu v1">Roadmap</div>
          </a>
          <a href="#integration" onClick={(e) => handleLinkClick(e, '#integration')} className="link-menu w-inline-block">
            <div className="text-secondary menu v1">Ecosystem</div>
          </a>
        </div>
        <a
          data-w-id="09714e88-c4a4-13a4-326d-691aded0cd8b"
           href="/app"
          className="button-primary w-inline-block"
        >
          <div className="wrapper-button-primary">
            <div className="wrapper-button-primary-text">
              <div className="text-menu">ENTER</div>
            </div>
            <div className="wrapper-button-primary-bg">
              <div className="bg-button-primary"></div>
            </div>
          </div>
        </a>
      </div>

      <div className={`quen-mobile-nav ${mobileMenuOpen ? 'is-open' : ''}`}>
        <button
          type="button"
          className="quen-mobile-toggle"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="quen-mobile-menu"
        >
          <span className="mobile-menu-icon" aria-hidden="true">
            <i />
            <i />
          </span>
        </button>

        <nav id="quen-mobile-menu" className="quen-mobile-menu" aria-hidden={!mobileMenuOpen}>
          <div className="quen-mobile-menu-head">
            <span>QUEN NETWORK</span>
            <span>[MENU]</span>
          </div>
          <div className="quen-mobile-menu-links">
            {[
              ['01', 'Product', '#product'],
              ['02', 'Quality Lab', '#lab'],
              ['03', 'Roadmap', '#workflow'],
              ['04', 'Ecosystem', '#integration'],
              ['05', 'ENTER', '/app'],
              ['06', 'Contact Us', '#contact'],
            ].map(([number, label, href]) => (
              <a href={href} onClick={(e) => handleLinkClick(e, href)} key={href}>
                <span>{number}</span>
                <strong>{label}</strong>
                <i aria-hidden="true">
                  <svg viewBox="0 0 16 16">
                    <path d="M3 13 13 3M6 3h7v7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </i>
              </a>
            ))}
          </div>
          <div className="quen-mobile-menu-foot">
            <span>Quality Unified Economy Network</span>
            <span>DeFi / RWA / Payments</span>
          </div>
        </nav>
      </div>
    </div>
  );
}

