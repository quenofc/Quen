import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, custom, formatEther, http } from 'viem';
import { ArrowUpRight, Check, Copy, ExternalLink, LockKeyhole, LogOut, RefreshCw, ShieldAlert, ShieldCheck, WalletCards, Wifi, X } from 'lucide-react';
import VaultActions from './VaultActions';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const CHAIN_ID = 4663;
const CHAIN_HEX = '0x1237';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const MORPHO_API = 'https://api.morpho.org';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const STEAKHOUSE_VAULT = '0xBeEff033F34C046626B8D0A041844C5d1A5409dd';
const LOCAL_DISCONNECT_KEY = 'quen.wallet.locallyDisconnected';
const chain = { id: CHAIN_ID, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } }, blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } } } as const;

type Opportunity = { name: string; category: 'DeFi' | 'RWA'; assets: string; risk: string; status: string; contract?: string; logos?: string[] };
const opportunities: Opportunity[] = [
  { name: 'Steakhouse USDG', category: 'DeFi', assets: 'USDG · Morpho Vault V2', risk: 'Variable', status: 'Live route', contract: STEAKHOUSE_VAULT, logos: ['/brand/steakhouse.png', '/brand/morpho.svg', '/brand/usdg.png'] },
  { name: 'QUEN Treasury Rail', category: 'RWA', assets: 'USDC · Short-duration credit', risk: 'Pending', status: 'Coming online' },
  { name: 'DeFi USDC Market', category: 'DeFi', assets: 'USDC / ETH', risk: 'Pending', status: 'Unavailable' },
  { name: 'Settlement Reserve', category: 'RWA', assets: 'USD settlement assets', risk: 'Pending', status: 'Coming online' },
  { name: 'Core Liquidity Pool', category: 'DeFi', assets: 'ETH / QUEN', risk: 'Pending', status: 'Unavailable' },
];

export type VaultState = {
  totalAssets: number;
  withdrawableAssets: number;
  sharePrice: number;
  apy: number;
  indexedBlock: string;
  updatedAt: number;
};

const formatUsd = (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const isFiniteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
export const VAULT_UNAVAILABLE_NOTICE = 'Live Morpho vault data is unavailable. No cached APY or TVL is shown.';
const DECIMAL_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

function parseFiniteDecimal(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUnsignedInteger(value: unknown, safe = false): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && (!safe || Number.isSafeInteger(value)) ? value : null;
  }
  if (typeof value !== 'string' || !UNSIGNED_INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (!safe || Number.isSafeInteger(parsed)) ? parsed : null;
}

type MorphoVaultPayload = {
  chain_id?: unknown;
  address?: unknown;
  total_assets?: unknown;
  withdrawable_assets?: unknown;
  share_price_ray?: unknown;
  last_indexed_block?: unknown;
  last_accrual_timestamp?: unknown;
};

type MorphoApyPayload = {
  chain_id?: unknown;
  vault_address?: unknown;
  apy?: unknown;
  last_indexed_block?: unknown;
};

type MorphoResponseEnvelope = {
  data: Record<string, unknown>;
};

export function parseMorphoEnvelope(response: unknown): Record<string, unknown> | null {
  if (
    typeof response !== 'object' ||
    response === null ||
    Array.isArray(response) ||
    !Object.prototype.hasOwnProperty.call(response, 'data')
  ) return null;

  const data = (response as Partial<MorphoResponseEnvelope>).data;
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data : null;
}

export function validateVaultPayload(
  state: MorphoVaultPayload,
  apy: MorphoApyPayload,
  nowSeconds = Date.now() / 1000,
): VaultState | null {
  const stateChainId = parseUnsignedInteger(state.chain_id, true);
  const apyChainId = parseUnsignedInteger(apy.chain_id, true);
  const totalAssetsRaw = parseUnsignedInteger(state.total_assets);
  const withdrawableAssetsRaw = parseUnsignedInteger(state.withdrawable_assets);
  const sharePriceRaw = parseUnsignedInteger(state.share_price_ray);
  const apyRaw = parseFiniteDecimal(apy.apy);
  const stateBlock = parseUnsignedInteger(state.last_indexed_block, true);
  const apyBlock = parseUnsignedInteger(apy.last_indexed_block, true);
  const updatedAt = parseUnsignedInteger(state.last_accrual_timestamp, true);
  if (
    stateChainId === null ||
    apyChainId === null ||
    totalAssetsRaw === null ||
    withdrawableAssetsRaw === null ||
    sharePriceRaw === null ||
    apyRaw === null ||
    stateBlock === null ||
    apyBlock === null ||
    updatedAt === null
  ) return null;

  const nextState = {
    totalAssets: totalAssetsRaw / 1e6,
    withdrawableAssets: withdrawableAssetsRaw / 1e6,
    sharePrice: sharePriceRaw / 1e27,
    apy: apyRaw,
    indexedBlock: String(stateBlock),
    updatedAt,
  };
  const correctIdentity =
    stateChainId === CHAIN_ID &&
    apyChainId === CHAIN_ID &&
    String(state.address).toLowerCase() === STEAKHOUSE_VAULT.toLowerCase() &&
    String(apy.vault_address).toLowerCase() === STEAKHOUSE_VAULT.toLowerCase();
  const age = nowSeconds - nextState.updatedAt;
  const fresh = Number.isFinite(age) && age >= 0 && age < 10 * 60;
  const blocksConsistent = Math.abs(stateBlock - apyBlock) <= 50;
  const valid =
    correctIdentity &&
    fresh &&
    blocksConsistent &&
    isFiniteNonNegative(nextState.totalAssets) &&
    isFiniteNonNegative(nextState.withdrawableAssets) &&
    isFiniteNonNegative(nextState.apy) &&
    Number.isFinite(nextState.sharePrice) &&
    nextState.sharePrice > 0 &&
    nextState.withdrawableAssets <= nextState.totalAssets;
  return valid ? nextState : null;
}

function shorten(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function providerErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code: unknown }).code)
    : null;
}

export default function LiquidityApp() {
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [block, setBlock] = useState<bigint | null>(null);
  const [networkState, setNetworkState] = useState<'loading' | 'online' | 'error'>('loading');
  const [walletState, setWalletState] = useState<'idle' | 'connecting' | 'connected' | 'wrong' | 'error'>('idle');
  const [notice, setNotice] = useState('');
  const [networkNotice, setNetworkNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<'All' | 'DeFi' | 'RWA'>('All');
  const [vaultState, setVaultState] = useState<VaultState | null>(null);
  const [, setVaultError] = useState('');
  const vaultRequestGeneration = useRef(0);

  const readNetwork = useCallback(async () => {
    setNetworkState('loading');
    try {
      const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
      const [latest, rpcChainId] = await Promise.all([publicClient.getBlockNumber(), publicClient.getChainId()]);
      if (rpcChainId !== CHAIN_ID) {
        setBlock(null);
        setBalance(null);
        setNetworkState('error');
        setNetworkNotice(`RPC network mismatch. Expected chain ${CHAIN_ID}, received ${rpcChainId}.`);
        return;
      }
      setBlock(latest); setNetworkState('online'); setNetworkNotice('');
      if (account) setBalance(await publicClient.getBalance({ address: account as `0x${string}` }));
    } catch {
      setBlock(null);
      setBalance(null);
      setNetworkState('error');
      setNetworkNotice('Robinhood Chain RPC is currently unavailable. Live network data has been cleared.');
    }
  }, [account]);

  const readVault = useCallback(async () => {
    const requestGeneration = ++vaultRequestGeneration.current;
    setVaultError('');
    try {
      const [stateResponse, apyResponse] = await Promise.all([
        fetch(`${MORPHO_API}/v1/vaults-v2/${CHAIN_ID}:${STEAKHOUSE_VAULT}/state`),
        fetch(`${MORPHO_API}/v1/vaults-v2/${CHAIN_ID}:${STEAKHOUSE_VAULT}/apy-averages?lookback=seven_days`),
      ]);
      if (!stateResponse.ok || !apyResponse.ok) throw new Error('Morpho API rejected the request');
      const state = parseMorphoEnvelope(await stateResponse.json());
      const apy = parseMorphoEnvelope(await apyResponse.json());
      if (!state || !apy) throw new Error('Morpho response envelope changed');
      const nextState = validateVaultPayload(state, apy);
      if (!nextState) throw new Error('Morpho payload failed validation');
      if (requestGeneration !== vaultRequestGeneration.current) return;
      setVaultState(nextState);
    } catch {
      if (requestGeneration !== vaultRequestGeneration.current) return;
      setVaultState(null);
      setVaultError(VAULT_UNAVAILABLE_NOTICE);
    }
  }, []);

  useEffect(() => { void readNetwork(); const timer = window.setInterval(() => void readNetwork(), 30000); return () => window.clearInterval(timer); }, [readNetwork]);
  useEffect(() => {
    void readVault();
    const timer = window.setInterval(() => void readVault(), 30000);
    return () => {
      window.clearInterval(timer);
      vaultRequestGeneration.current += 1;
    };
  }, [readVault]);

  const syncWallet = useCallback(async (address?: string, force = false) => {
    if (!window.ethereum) return;
    if (!force && sessionStorage.getItem(LOCAL_DISCONNECT_KEY) === 'true') return;
    try {
      const accounts = address ? [address] : await window.ethereum.request({ method: 'eth_accounts' }) as string[];
      const currentChain = Number(await window.ethereum.request({ method: 'eth_chainId' }));
      setChainId(currentChain);
      if (accounts[0]) {
        setAccount(accounts[0]); setWalletState(currentChain === CHAIN_ID ? 'connected' : 'wrong');
        const walletClient = createPublicClient({ chain, transport: custom(window.ethereum as never) });
        if (currentChain === CHAIN_ID) setBalance(await walletClient.getBalance({ address: accounts[0] as `0x${string}` }));
        else setBalance(null);
      } else { setAccount(null); setBalance(null); setWalletState('idle'); }
    } catch {
      setAccount(null);
      setBalance(null);
      setWalletState('error');
      setNotice('Unable to read wallet state. Check your wallet and try again.');
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const accountsChanged = (...args: unknown[]) => void syncWallet((args[0] as string[] | undefined)?.[0]);
    const chainChanged = () => void syncWallet();
    window.ethereum.on('accountsChanged', accountsChanged); window.ethereum.on('chainChanged', chainChanged);
    void syncWallet();
    return () => { window.ethereum?.removeListener?.('accountsChanged', accountsChanged); window.ethereum?.removeListener?.('chainChanged', chainChanged); };
  }, [syncWallet]);

  const connect = async () => {
    if (!window.ethereum) { setWalletState('error'); setNotice('No injected wallet detected. Install an EIP-1193 wallet to continue.'); return; }
    setWalletState('connecting'); setNotice('');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      sessionStorage.removeItem(LOCAL_DISCONNECT_KEY);
      await syncWallet(accounts[0], true);
    } catch (error) { setWalletState('error'); setNotice((error as Error).message || 'Connection request was rejected.'); }
  };
  const switchNetwork = async () => {
    if (!window.ethereum) return;
    setNotice('');
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
      await syncWallet(undefined, true);
    } catch (error) {
      if (providerErrorCode(error) !== 4902) {
        setNotice('Network switch was rejected. Select Robinhood Chain in your wallet.');
        return;
      }
      try {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC_URL], blockExplorerUrls: [EXPLORER] }] });
        await syncWallet(undefined, true);
      } catch { setNotice('Robinhood Chain could not be added. Check your wallet and try again.'); }
    }
  };
  const disconnectLocally = () => {
    sessionStorage.setItem(LOCAL_DISCONNECT_KEY, 'true');
    setAccount(null);
    setBalance(null);
    setWalletState('idle');
    setNotice('Wallet disconnected from this QUEN session. Wallet authorization remains managed by your wallet.');
  };
  const copyAddress = async () => { if (!account) return; await navigator.clipboard.writeText(account); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  const filtered = useMemo(() => opportunities.filter((item) => filter === 'All' || item.category === filter), [filter]);
  const eth = balance === null ? '—' : Number(formatEther(balance)).toLocaleString(undefined, { maximumFractionDigits: 5 });

  return <div className="liquidity-app">
    <header className="liquidity-header">
      <a className="app-brand" href="/"><span className="app-logo"><img src="/quen-logo-blue.png" alt="QUEN" /></span><span><strong>QUEN</strong><small>UNIFIED LIQUIDITY</small></span></a>
      <nav className="app-product-nav"><a className="active" href="/app">LIQUIDITY</a><a href="/app/rwa">RWA MARKETS</a><a href="/app/settlement">SETTLEMENT</a></nav>
      <div className="header-center"><img src="/brand/robinhood-chain.png" alt="" /><span className={`status-dot ${networkState}`} /> ROBINHOOD CHAIN <b>{networkState === 'online' ? 'LIVE' : networkState.toUpperCase()}</b></div>
      <div className="header-actions"><a href="/" className="return-link">Landing <ArrowUpRight size={14} /></a>{account ? <button className="wallet-chip" onClick={disconnectLocally} title="Disconnect from this QUEN session"><span className="wallet-live" />{shorten(account)} <LogOut size={14} /></button> : <button className="connect-button" onClick={() => void connect()}>{walletState === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET'}</button>}</div>
    </header>
    <main className="liquidity-main">
      <section className="app-intro"><div><p className="eyebrow">OPERATIONS / 01</p><h1>Unified<br /><em>Liquidity.</em></h1><p className="intro-copy">A clear view across the economy. Review quality-evaluated opportunities, monitor network conditions, and deploy capital only where settlement is live.</p></div><div className="network-card"><div className="card-label"><Wifi size={14} /> LIVE NETWORK</div><strong>{networkState === 'online' ? 'Healthy' : networkState === 'error' ? 'RPC unavailable' : 'Reading network'}</strong><dl><div><dt>CHAIN ID</dt><dd>{CHAIN_ID}</dd></div><div><dt>LATEST BLOCK</dt><dd>{block ? block.toLocaleString() : '—'}</dd></div></dl><button className="refresh-button" onClick={() => void readNetwork()}><RefreshCw size={13} /> Refresh status</button></div></section>
      {networkNotice && <div className="notice"><X size={15} /> {networkNotice}</div>}
      {notice && <div className="notice"><X size={15} /> {notice}</div>}
      <section className="summary-grid"><div className="summary-card accent"><span className="card-label">LIVE VAULT ASSETS</span><strong>{vaultState ? `${formatUsd(vaultState.totalAssets)} USDG` : '—'}</strong><small>{vaultState ? `Morpho indexed block ${Number(vaultState.indexedBlock).toLocaleString()}` : 'Waiting for verified source'}</small></div><div className="summary-card"><span className="card-label">7D REALIZED APY</span><strong>{vaultState ? `${(vaultState.apy * 100).toFixed(2)}%` : '—'}</strong><small>Live Morpho API · excludes rewards</small></div><div className="summary-card"><span className="card-label">WITHDRAWABLE NOW</span><strong>{vaultState ? `${formatUsd(vaultState.withdrawableAssets)}` : '—'}</strong><small>{vaultState ? `${((vaultState.withdrawableAssets / vaultState.totalAssets) * 100).toFixed(1)}% of assets` : 'No cached value'}</small></div></section>
       <section className="qualified-route">
         <div>
           <p className="eyebrow">QUALIFIED ASSETS / 02</p>
           <h2>RWA Markets to canonical USDG.</h2>
           <p>Qualified RWA assets are not accepted by the Steakhouse USDG vault. When an on-chain route is available, swap a supported asset to canonical USDG in RWA Markets first; the separately verified USDG vault flow remains gated by its live contract checks.</p>
         </div>
         <a className="qualified-route-link" href="/app/rwa">OPEN RWA MARKETS <ArrowUpRight size={14} /></a>
       </section>
      <section className="route-review">
         <div className="route-review-head"><div><p className="eyebrow">ROUTE REVIEW / 03</p><div className="route-brand-line"><span className="brand-cluster"><img src="/brand/steakhouse.png" alt="Steakhouse Financial" /><img src="/brand/morpho.svg" alt="Morpho" /><img src="/brand/usdg.png" alt="Global Dollar USDG" /></span><h2>Steakhouse USDG</h2></div><p>Canonical USDG routed directly into a Morpho Vault V2. Contract identity, permissions, balances, previews, simulations, and receipts are revalidated from Robinhood Chain before an action can move funds.</p></div><span className={`route-verdict ${vaultState ? 'live' : ''}`}>{vaultState ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />} {vaultState ? 'INDEXER VERIFIED / ACTION GATED' : 'INDEXER UNAVAILABLE / ACTION GATED'}</span></div>
        <div className="route-metrics"><div><span>SHARE PRICE</span><strong>{vaultState ? `${vaultState.sharePrice.toFixed(6)} USDG` : '—'}</strong></div><div><span>USDG</span><a href={`${EXPLORER}/address/${USDG}`} target="_blank" rel="noreferrer">{shorten(USDG)} <ExternalLink size={12} /></a></div><div><span>VAULT</span><a href={`${EXPLORER}/address/${STEAKHOUSE_VAULT}`} target="_blank" rel="noreferrer">{shorten(STEAKHOUSE_VAULT)} <ExternalLink size={12} /></a></div><div><span>DATA TIME</span><strong>{vaultState ? new Date(vaultState.updatedAt * 1000).toLocaleString() : '—'}</strong></div></div>
        <div className="gate-grid">
          <div className="gate-card pending"><ShieldAlert size={15} /><div><strong>Contract identity checked per wallet</strong><small>USDG asset, symbol, decimals, vault asset, share decimals, and permission gates must match before that wallet's actions unlock.</small></div></div>
          <div className="gate-card pending"><ShieldAlert size={15} /><div><strong>Transactions require fresh simulation</strong><small>Approval, deposit and withdrawal are revalidated and simulated against mainnet immediately before the wallet can submit them.</small></div></div>
          <div className="gate-card pending"><ShieldAlert size={15} /><div><strong>Variable protocol risk</strong><small>Morpho allocations, collateral, oracle, liquidity and curator controls can change. Yield is not guaranteed.</small></div></div>
          <div className="gate-card pending"><ShieldAlert size={15} /><div><strong>Non-custodial direct route</strong><small>After wallet-specific gates pass, your wallet interacts with USDG and the Morpho vault directly. QUEN does not receive the assets.</small></div></div>
        </div>
        <VaultActions account={account} connected={walletState === 'connected'} onConnect={connect} onSwitchNetwork={switchNetwork} />
      </section>
            <section className="workspace"><div className="workspace-head"><div><p className="eyebrow">MARKET SURFACE / 04</p><h2>Liquidity opportunities</h2></div><div className="filters">{(['All', 'DeFi', 'RWA'] as const).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="opportunity-table"><div className="table-head"><span>OPPORTUNITY</span><span>QUALITY</span><span>RISK</span><span>STATUS</span><span>ACTION</span></div>{filtered.map((item) => <div className="opportunity-row" key={item.name}><div className="opp-name">{item.logos ? <span className="market-logo-stack">{item.logos.map((logo, index) => <img src={logo} alt="" key={logo} style={{ zIndex: item.logos!.length - index }} />)}</span> : <span className={`category-mark ${item.category.toLowerCase()}`}>{item.category === 'RWA' ? 'R' : 'D'}</span>}<div><strong>{item.name}</strong><small>{item.category} · {item.assets}</small></div></div><div className="quality"><b>{item.contract ? 'GATED' : '—'}</b><span>{item.contract ? 'Runtime checks required' : 'Pending verification'}</span></div><div className="risk-cell"><span className="risk">{item.risk}</span></div><div className="status-cell"><span className="availability"><i />{item.contract ? 'Direct route' : item.status}</span></div>{item.contract ? <a className="supply-button active" href="#vault-actions">Review</a> : <button className="supply-button" disabled title="This route is not available">Locked <LockKeyhole size={14} /></button>}</div>)}</div></section>
       <section className="wallet-panel"><div><p className="eyebrow">ACCOUNT / 05</p><h2>Wallet connection</h2><p>Connect an injected wallet to read your live Robinhood Chain balance. QUEN never fabricates portfolio values or submits transactions without a verified route.</p></div>{account ? <div className="account-detail"><div className="account-line"><span className="wallet-avatar"><WalletCards size={17} /></span><div><small>CONNECTED ACCOUNT</small><strong>{shorten(account)}</strong></div><button onClick={() => void copyAddress()} aria-label="Copy address">{copied ? <Check size={16} /> : <Copy size={16} />}</button><a href={`${EXPLORER}/address/${account}`} target="_blank" rel="noreferrer"><ExternalLink size={16} /></a></div>{walletState === 'wrong' && <div className="wrong-network"><ShieldCheck size={15} /><span>Wallet is on chain {chainId}. Robinhood Chain is required for live balances.</span><button onClick={() => void switchNetwork()}>Switch network</button></div>}<div className="account-balance"><span>LIVE NATIVE BALANCE</span><strong>{walletState === 'connected' ? `${eth} ETH` : 'Unavailable on this network'}</strong></div></div> : <button className="large-connect" onClick={() => void connect()}>{walletState === 'error' ? 'TRY AGAIN' : 'CONNECT INJECTED WALLET'} <ArrowUpRight size={16} /></button>}</section>
    </main>
    <footer className="app-footer"><span>QUEN / QUALITY UNIFIED ECONOMY NETWORK</span><span className="footer-network"><img src="/brand/robinhood-chain.png" alt="" /> Robinhood Chain · Chain ID {CHAIN_ID}</span><a href={EXPLORER} target="_blank" rel="noreferrer">Blockscout explorer <ExternalLink size={12} /></a></footer>
  </div>;
}