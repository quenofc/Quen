import React from 'react';

const paths = [
  {
    number: '01',
    label: 'Trade',
    title: 'Access tokenized markets.',
    description: 'Review qualified Robinhood Token markets and trade against USDG when every execution check passes.',
    items: ['Live market checks', 'Verified price references', 'Simulated execution'],
    action: 'Explore RWA markets',
    href: '/app/rwa',
  },
  {
    number: '02',
    label: 'Settle',
    title: 'Move USDG directly.',
    description: 'Send or request canonical USDG on Robinhood Chain with live contract checks and receipt verification.',
    items: ['Mainnet transfers', 'Payment requests', 'Verified receipts'],
    action: 'Settle USDG',
    href: '/app/settlement',
    featured: true,
  },
  {
    number: '03',
    label: 'Build',
    title: 'Connect real value.',
    description: 'Build products across unified liquidity, verified real-world assets, and programmable settlement rails.',
    items: ['Developer access', 'Institutional rails', 'Composable products'],
    action: 'Build with QUEN',
    href: '/docs',
  },
];

const Arrow = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export default function PricingSection() {
  return (
    <section id="join" className="main-section pricing join-quen">
      <div className="w-layout-blockcontainer main-container w-container">
        <div className="join-quen-shell">
          <header className="join-quen-header">
            <div className="join-quen-kicker">
              <span className="join-quen-status" />
              <span>JOIN THE NETWORK</span>
              <span>[03 PATHS]</span>
            </div>
            <div className="join-quen-heading">
              <h2>
                Join with <span>QUEN.</span>
              </h2>
              <p>
                Participate in the quality layer connecting on-chain finance,
                real-world assets, and settlement infrastructure.
              </p>
            </div>
            <div className="join-quen-line"><i /></div>
          </header>

          <div className="join-quen-grid">
            {paths.map((path) => (
              <article className={`join-card${path.featured ? ' is-featured' : ''}`} key={path.number}>
                <div className="join-card-top">
                  <span>{path.number}</span>
                  <span>{path.label}</span>
                </div>

                <div className="join-card-body">
                  <h3>{path.title}</h3>
                  <p>{path.description}</p>
                </div>

                <ul>
                  {path.items.map((item) => <li key={item}>{item}</li>)}
                </ul>

                <a href={path.href} className="join-card-action">
                  <span>{path.action}</span>
                  <Arrow />
                </a>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}