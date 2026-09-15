import React from 'react';

const frameworkLayers = [
  {
    number: '01',
    title: 'Unified Liquidity',
    description: 'Shared access across on-chain markets and verified real-world assets.',
  },
  {
    number: '02',
    title: 'RWA Gateway',
    description: 'A structured path from real-world value to programmable financial products.',
  },
  {
    number: '03',
    title: 'Settlement Rails',
    description: 'Efficient movement of value across currencies, markets, and borders.',
  },
  {
    number: '04',
    title: 'Quality Layer',
    description: 'Transparent standards and scoring applied across every connected product.',
  },
];

export default function FeaturesSection() {
  return (
    <section className="main-section quen-framework" id="framework">
      <div className="w-layout-blockcontainer main-container w-container">
        <header className="quen-framework-header">
          <div className="quen-framework-kicker">
            <span>QUEN / SYSTEM 01</span>
            <span>QUALITY-LED INFRASTRUCTURE</span>
          </div>
          <div className="quen-framework-heading">
            <h2>The QUEN<br />Framework</h2>
            <p>
              Four connected layers turn fragmented financial infrastructure into
              one quality-driven economy network.
            </p>
          </div>
        </header>

        <div className="content-feature quen-framework-grid">
          <div className="quen-framework-layers">
            {frameworkLayers.map((layer) => (
              <article className="quen-framework-layer" key={layer.number}>
                <span className="quen-framework-number">{layer.number}</span>
                <div>
                  <h3>{layer.title}</h3>
                  <p>{layer.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}