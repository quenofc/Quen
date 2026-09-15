import React from 'react';

type MarketItem = {
  symbol: string;
  name: string;
  logo: string;
  className?: string;
};

const marketItems: MarketItem[] = [
  { symbol: 'RH CHAIN', name: 'Robinhood Chain', logo: '/market-logos/robinhood-chain.jpg', className: 'robinhood' },
  { symbol: 'ETH', name: 'Ethereum', logo: '/market-logos/ethereum.svg' },
  { symbol: 'NVDA', name: 'NVIDIA', logo: '/market-logos/nvidia.svg' },
  { symbol: 'AAPL', name: 'Apple', logo: '/market-logos/apple.svg' },
  { symbol: 'MSFT', name: 'Microsoft', logo: '/market-logos/microsoft.svg', className: 'light-logo' },
  { symbol: 'TSLA', name: 'Tesla', logo: '/market-logos/tesla.svg' },
  { symbol: 'AMZN', name: 'Amazon', logo: '/market-logos/amazon.svg', className: 'light-logo' },
  { symbol: 'GOOGL', name: 'Alphabet', logo: '/market-logos/google.svg' },
];

function MarketTickerGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="partner market-ticker-group" aria-hidden={hidden || undefined}>
      {marketItems.map((item) => (
        <div className={`market-ticker-item ${item.className ?? ''}`} key={`${hidden ? 'copy' : 'main'}-${item.symbol}`}>
          <span className="market-mark" aria-hidden="true">
            <img src={item.logo} alt="" loading="eager" />
          </span>
          <span className="market-ticker-copy">
            <strong>{item.symbol}</strong>
            <small>{item.name}</small>
          </span>
          <i aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

export default function PartnersSection() {
  return (
    <section id="market-ecosystem" className="main-section">
      <div className="w-layout-blockcontainer main-container w-container">
        <div className="wrapper-partner">
          <div className="title-partner">
            <div className="block-title-partner v1">
              <div className="small-text animation">A Unified Economy For Every Participant</div>
            </div>
            <div className="block-title-partner v2">
              <div className="small-text secondary animation-loop">ECOSYSTEM</div>
              <span className="ecosystem-pulse" aria-hidden="true" />
            </div>
          </div>

          <div className="wrapper-partners market-ticker-window">
            <div className="bg-partner v1" />
            <div className="bg-partner v2" />
            <div className="block-partner-move">
              <div className="block-partners market-ticker-track">
                <MarketTickerGroup />
                <MarketTickerGroup hidden />
              </div>
            </div>
          </div>

          <div className="wrapper-border vertical v1">
            <div className="border fill" />
            <div className="border empty" />
            <div className="bg-partner v1" />
            <div className="bg-partner v2" />
          </div>
        </div>
      </div>
    </section>
  );
}