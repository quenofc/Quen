import React from 'react';

const railLogos = [
  { name: 'Robinhood Chain', src: '/market-logos/robinhood-chain.jpg' },
  { name: 'Ethereum', src: '/market-logos/ethereum.svg' },
  { name: 'NVIDIA', src: '/market-logos/nvidia.svg' },
  { name: 'QUEN Network', src: '/quen-logo-blue.png', isQuen: true },
  { name: 'Apple', src: '/market-logos/apple.svg' },
  { name: 'Microsoft', src: '/market-logos/microsoft.svg', needsContrast: true },
  { name: 'Tesla', src: '/market-logos/tesla.svg' },
];

export default function IntegrationSection() {
  return (
    <section id="integration" className="tracks integration">
      <div className="wrapper-sections">
        <div className="wrapper-frame">
          <div className="w-layout-blockcontainer main-container w-container">
            <div className="wrapper-integration">
              <div className="wrapper-content-integration">
                <div className="wrapper-title-integration">
                  <div className="badge">
                    <div className="scramble secondary">ECOSYSTEM</div>
                    <div className="block-title-workflow-animation">
                      <div className="text-secondary animated">-</div>
                      <div className="text-secondary animated">-</div>
                      <div className="text-secondary animated">-</div>
                    </div>
                    <div className="scramble v1">CORE RAILS</div>
                  </div>
                </div>
                <div className="line-horizontal" />
                <div className="wrapper-title-integration">
                  <div className="text-looping-animation">DeFi + RWA + Payments. One Network.</div>
                </div>
              </div>

              <div className="wrapper-icon-integration">
                {railLogos.map((logo, index) => (
                  <div className={`icon-integration v${index + 1}`} key={logo.name}>
                    <img
                      src={logo.src}
                      loading="lazy"
                      alt={`${logo.name} logo.`}
                      className={[
                        'image-icon-integration',
                        'core-rail-brand-logo',
                        logo.isQuen ? 'quen-ecosystem-logo' : '',
                        logo.needsContrast ? 'core-rail-light-logo' : '',
                      ].filter(Boolean).join(' ')}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}