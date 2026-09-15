import React from 'react';

function NetworkVisual() {
  return (
    <div className="lab-card-visual lab-network-visual">
      <svg className="lab-state-fragmented" viewBox="0 0 320 210" aria-hidden="true">
        <path d="M42 48h72v48H42zM205 38h72v48h-72zM55 137h72v38H55zM215 132h62v48h-62z" />
        <path className="lab-dash" d="M114 72h42M177 63h28M127 155h45M193 155h22" />
        <circle cx="166" cy="106" r="10" />
      </svg>
      <svg className="lab-state-unified" viewBox="0 0 320 210" aria-hidden="true">
        <circle cx="160" cy="105" r="62" />
        <circle cx="160" cy="105" r="35" />
        <path d="M160 43v27M222 105h-27M160 167v-27M98 105h27" />
        <circle className="lab-svg-fill" cx="160" cy="105" r="9" />
        <circle className="lab-svg-node" cx="160" cy="43" r="5" />
        <circle className="lab-svg-node" cx="222" cy="105" r="5" />
        <circle className="lab-svg-node" cx="160" cy="167" r="5" />
        <circle className="lab-svg-node" cx="98" cy="105" r="5" />
      </svg>
      <span className="lab-visual-code">NET / 01</span>
    </div>
  );
}

function QualityVisual() {
  return (
    <div className="lab-card-visual lab-quality-visual">
      <div className="lab-quality-header">
        <span>QUALITY INDEX</span>
        <span className="lab-state-fragmented">67</span>
        <span className="lab-state-unified">99</span>
      </div>
      <div className="lab-quality-bars" aria-hidden="true">
        {[42, 58, 36, 67, 51].map((value, index) => (
          <i key={value} style={{ '--bar': `${value}%`, '--delay': index } as React.CSSProperties} />
        ))}
      </div>
      <div className="lab-quality-scale"><span>0</span><span>QUALITY READINESS</span><span>100</span></div>
    </div>
  );
}

function VerificationVisual() {
  const checks = ['ASSET ORIGIN', 'RISK MODEL', 'COMPLIANCE'];

  return (
    <div className="lab-card-visual lab-verification-visual">
      {checks.map((check, index) => (
        <div className="lab-check-row" key={check}>
          <span>0{index + 1}</span>
          <strong>{check}</strong>
          <em className="lab-state-fragmented">PENDING</em>
          <em className="lab-state-unified">VERIFIED</em>
        </div>
      ))}
    </div>
  );
}

function SettlementVisual() {
  return (
    <div className="lab-card-visual lab-settlement-visual">
      <svg viewBox="0 0 320 170" aria-hidden="true">
        <path className="lab-chart-grid" d="M24 25H300M24 68H300M24 111H300M24 154H300" />
        <path className="lab-state-fragmented lab-chart-line" d="M24 137L69 114L108 128L153 75L199 108L244 68L300 88" />
        <path className="lab-state-unified lab-chart-line" d="M24 140L69 128L108 111L153 96L199 70L244 53L300 25" />
        <circle className="lab-state-unified lab-svg-fill" cx="300" cy="25" r="5" />
      </svg>
      <div className="lab-chart-meta"><span>SETTLEMENT EFFICIENCY</span><strong className="lab-state-unified">+32.8%</strong></div>
    </div>
  );
}

export default function LabSection() {
  return (
    <section id="lab" className="tracks lab">
      <div className="wrapper-sections">
        <div className="wrapper-frame">
          <div className="w-layout-blockcontainer main-container w-container">
            <div className="wrapper-padding">
              <div className="wrapper-lab">
                <div className="block-title-lab">
                  <div className="medium-big-text color-gradient">From</div>
                  <div className="medium-big-text animated-1">Fragmented</div>
                  <div className="wrapper-toggle"><div className="toggle" /></div>
                  <div className="medium-big-text muted animated-2">Unified</div>
                </div>

                <div className="block-content-lab">
                  <article className="block-content-desc-lab v1">
                    <header className="lab-card-header"><span>Network State</span><b>01</b></header>
                    <NetworkVisual />
                    <footer className="lab-card-footer">
                      <span className="lab-state-fragmented">LIQUIDITY SILOED</span>
                      <span className="lab-state-unified">NETWORK CONNECTED</span>
                    </footer>
                  </article>

                  <article className="block-content-desc-lab v2">
                    <header className="lab-card-header"><span>Process Quality</span><b>02</b></header>
                    <QualityVisual />
                    <footer className="lab-card-footer">
                      <span className="lab-state-fragmented">PARTIAL SIGNAL</span>
                      <span className="lab-state-unified">QUALITY ACTIVE</span>
                    </footer>
                  </article>

                  <article className="block-content-desc-lab v3">
                    <header className="lab-card-header"><span>Asset Verification</span><b>03</b></header>
                    <VerificationVisual />
                    <footer className="lab-card-footer">
                      <span className="lab-state-fragmented">MANUAL REVIEW</span>
                      <span className="lab-state-unified">ON-CHAIN VERIFIED</span>
                    </footer>
                  </article>

                  <article className="block-content-desc-lab v4">
                    <header className="lab-card-header"><span>Settlement Output</span><b>04</b></header>
                    <SettlementVisual />
                    <footer className="lab-card-footer">
                      <span className="lab-state-fragmented">FRAGMENTED RAILS</span>
                      <span className="lab-state-unified">UNIFIED FLOW</span>
                    </footer>
                  </article>

                  <div className="block-scan-lab"><div className="line-scan" /><div className="body-scan" /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="trigger-wrapper-v2">
        <div className="trigger-lab v1" />
        <div className="block-trigger-lab"><div className="trigger-lab v2" /><div className="trigger-lab v3" /></div>
      </div>
    </section>
  );
}