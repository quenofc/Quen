import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, createWalletClient, custom, fallback, formatEther, formatUnits, http, parseAbi, parseEventLogs, type Address, type Hash } from 'viem';
import { AlertTriangle, ArrowUpRight, Check, Clipboard, Copy, ExternalLink, LoaderCircle, ShieldCheck, WalletCards } from 'lucide-react';
import { makePaymentRequestUriFromAmount, SETTLEMENT_CHAIN_ID, SETTLEMENT_TOKEN, validateSettlement } from './settlementHelpers';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const CHAIN_HEX = '0x1237';
const chain = { id: SETTLEMENT_CHAIN_ID, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } } } as const;
const abi = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function paused() view returns (bool)', 'function transfer(address,uint256) returns (bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
const publicClient = createPublicClient({ chain, transport: fallback([http('/robinhood-rpc'), http(RPC)]) });
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const walletError = (error: unknown) => /reject|denied|user/i.test(String(error)) ? 'Signature was cancelled in your wallet.' : 'Settlement could not be completed. No funds were moved.';

declare global { interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (event: string, handler: (...args: unknown[]) => void) => void; removeListener?: (event: string, handler: (...args: unknown[]) => void) => void } } }

export default function SettlementApp() {
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [network, setNetwork] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tokenOk, setTokenOk] = useState(false);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<bigint | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'send' | 'receive'>('send');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [tx, setTx] = useState<{ stage: 'idle' | 'signing' | 'confirming' | 'success' | 'error'; hash?: Hash; message?: string }>({ stage: 'idle' });
  const [review, setReview] = useState<{ recipient: Address; units: bigint; amount: string } | null>(null);
  const requestRef = useRef(0);

  const readState = useCallback(async (address?: Address) => {
    const generation = ++requestRef.current;
    setNetwork('loading');
    try {
      const [rpcChain, bytecode, name, symbol, decimals, pause] = await Promise.all([
        publicClient.getChainId(), publicClient.getBytecode({ address: SETTLEMENT_TOKEN }), publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'name', authorizationList: undefined }), publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'symbol', authorizationList: undefined }), publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'decimals', authorizationList: undefined }), publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'paused', authorizationList: undefined }).catch(() => null),
      ]);
      const verified = rpcChain === SETTLEMENT_CHAIN_ID && Boolean(bytecode && bytecode !== '0x') && name === 'Global Dollar' && symbol === 'USDG' && decimals === 6;
      if (generation !== requestRef.current) return;
      setTokenOk(verified && pause === false); setPaused(pause);
      if (address) {
        const [balance, native] = await Promise.all([publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'balanceOf', args: [address], authorizationList: undefined }), publicClient.getBalance({ address })]);
        if (generation !== requestRef.current) return;
        setTokenBalance(balance); setEthBalance(native);
      } else { setTokenBalance(null); setEthBalance(null); }
      setNetwork(verified && pause === false ? 'ready' : 'error');
    } catch { if (generation === requestRef.current) { setNetwork('error'); setTokenOk(false); setNotice('Robinhood Chain data is temporarily unavailable.'); } }
  }, []);

  const syncWallet = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const [accounts, current] = await Promise.all([window.ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>, window.ethereum.request({ method: 'eth_chainId' }) as Promise<string>]);
      const next = accounts[0] as Address | undefined;
      setReview(null); setAccount(next ?? null); setWalletChainId(Number(current));
      await readState(next);
    } catch { setNotice('Unable to read wallet state.'); }
  }, [readState]);
  useEffect(() => { void readState(); void syncWallet(); const timer = window.setInterval(() => void readState(account ?? undefined), 20000); return () => { clearInterval(timer); requestRef.current += 1; }; }, [readState, syncWallet, account]);
  useEffect(() => { const accounts = () => void syncWallet(); const chains = () => void syncWallet(); window.ethereum?.on?.('accountsChanged', accounts); window.ethereum?.on?.('chainChanged', chains); return () => { window.ethereum?.removeListener?.('accountsChanged', accounts); window.ethereum?.removeListener?.('chainChanged', chains); }; }, [syncWallet]);

  const connect = async () => { if (!window.ethereum) { setNotice('Connect an injected wallet to continue.'); return; } try { await window.ethereum.request({ method: 'eth_requestAccounts' }); await syncWallet(); } catch { setNotice('Wallet connection was cancelled.'); } };
  const switchNetwork = async () => { if (!window.ethereum) return; try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); } catch (error) { if ((error as { code?: number }).code !== 4902) { setNotice('Select Robinhood Chain in your wallet.'); return; } try { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] }); } catch { setNotice('Robinhood Chain could not be added.'); } } await syncWallet(); };
  const validation = useMemo(() => validateSettlement(recipient, amount, account, tokenBalance ?? 0n), [recipient, amount, account, tokenBalance]);
  const requestUri = useMemo(() => { if (!account || mode !== 'receive' || !amount.trim()) return ''; try { return makePaymentRequestUriFromAmount(account, amount); } catch { return ''; } }, [account, amount, mode]);
  const busy = tx.stage === 'signing' || tx.stage === 'confirming';
  const copy = async (value: string) => { if (!value) return; await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  useEffect(() => {
    const generation = ++requestRef.current;
    setFeeEstimate(null);
    if (mode !== 'send' || !account || !validation.ok || walletChainId !== SETTLEMENT_CHAIN_ID || !tokenOk || paused !== false) return;
    const timer = window.setTimeout(async () => {
      try {
        const [gas, gasPrice] = await Promise.all([
          publicClient.estimateContractGas({ account, address: SETTLEMENT_TOKEN, abi, functionName: 'transfer', args: [validation.recipient, validation.units] }),
          publicClient.getGasPrice(),
        ]);
        if (generation === requestRef.current) setFeeEstimate(gas * gasPrice);
      } catch { if (generation === requestRef.current) setFeeEstimate(null); }
    }, 350);
    return () => clearTimeout(timer);
  }, [account, mode, paused, tokenOk, validation, walletChainId]);

  const beginReview = () => {
    if (!validation.ok || !account || walletChainId !== SETTLEMENT_CHAIN_ID || !tokenOk || paused !== false) return;
    setReview({ recipient: validation.recipient, units: validation.units, amount: amount.trim() });
    setTx({ stage: 'idle' });
  };

  const submit = async () => {
    const request = ++requestRef.current;
    if (!account || walletChainId !== SETTLEMENT_CHAIN_ID || !review || !window.ethereum) return;
    const snapshot = review;
    let submittedHash: Hash | undefined;
    setTx({ stage: 'signing' }); setNotice('');
    try {
      const [accounts, walletChain] = await Promise.all([window.ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>, window.ethereum.request({ method: 'eth_chainId' }) as Promise<string>]);
      if (request !== requestRef.current || Number(walletChain) !== SETTLEMENT_CHAIN_ID || accounts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('Wallet state changed.');
      const [rpcChain, freshPause, freshBalance] = await Promise.all([
        publicClient.getChainId(),
        publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'paused', authorizationList: undefined }).catch(() => null),
        publicClient.readContract({ address: SETTLEMENT_TOKEN, abi, functionName: 'balanceOf', args: [account], authorizationList: undefined }),
      ]);
      if (rpcChain !== SETTLEMENT_CHAIN_ID || freshPause !== false) throw new Error('Settlement is not currently available.');
      const fresh = validateSettlement(snapshot.recipient, snapshot.amount, account, freshBalance);
      if (!fresh.ok || fresh.units !== snapshot.units || fresh.recipient.toLowerCase() !== snapshot.recipient.toLowerCase()) throw new Error('Settlement details changed.');
      const simulation = await publicClient.simulateContract({ account, address: SETTLEMENT_TOKEN, abi, functionName: 'transfer', args: [snapshot.recipient, snapshot.units] });
      if (simulation.result !== true) throw new Error('Token transfer was not accepted.');
      if (request !== requestRef.current) throw new Error('Settlement details changed.');
      const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum as never) });
      submittedHash = await wallet.writeContract(simulation.request);
      setTx({ stage: 'confirming', hash: submittedHash, message: 'Submitted. Waiting for confirmation.' });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Transaction reverted.');
      const transfers = parseEventLogs({ abi, logs: receipt.logs, eventName: 'Transfer', strict: true });
      const confirmed = transfers.some((event) => event.address.toLowerCase() === SETTLEMENT_TOKEN.toLowerCase()
        && event.args.from.toLowerCase() === account.toLowerCase()
        && event.args.to.toLowerCase() === snapshot.recipient.toLowerCase()
        && event.args.value === snapshot.units);
      if (!confirmed) throw new Error('Transfer event could not be verified.');
      setTx({ stage: 'success', hash: submittedHash, message: 'USDG settlement confirmed.' }); setAmount(''); setReview(null); await readState(account);
    } catch (error) {
      setTx(submittedHash
        ? { stage: 'error', hash: submittedHash, message: 'Submitted, but confirmation is not verified. Check Blockscout before retrying.' }
        : { stage: 'error', message: walletError(error) });
    }
  };

  return <div className="settlement-app">
    <header className="settlement-header"><a className="app-brand" href="/"><span className="app-logo"><img src="/quen-logo-blue.png" alt="QUEN" /></span><span><strong>QUEN</strong><small>SETTLEMENT RAILS</small></span></a><nav className="app-product-nav"><a href="/app">LIQUIDITY</a><a href="/app/rwa">RWA MARKETS</a><a className="active" href="/app/settlement">SETTLEMENT</a></nav><div className="settlement-header-actions">{account ? <span className="settlement-account"><i />{short(account)}</span> : <button className="connect-button" onClick={() => void connect()}><WalletCards size={14} /> CONNECT WALLET</button>}</div></header>
    <main className="settlement-main"><section className="settlement-hero"><div><p className="eyebrow">OPERATIONS / SETTLEMENT</p><h1>Move USDG.<br /><em>Directly.</em></h1><p className="settlement-lede">A precise mainnet transfer desk for USDG on Robinhood Chain.</p></div><div className="settlement-status"><div><span className={`status-dot ${network === 'ready' ? 'online' : network === 'error' ? 'error' : ''}`} /> ROBINHOOD CHAIN</div><strong>{network === 'ready' ? 'LIVE' : network === 'loading' ? 'READING' : 'UNAVAILABLE'}</strong><small>Chain ID {SETTLEMENT_CHAIN_ID} · USDG · 6 decimals</small></div></section>
      {notice && <div className="settlement-notice">{notice}</div>}
      <section className="settlement-workspace"><div className="settlement-form-panel"><div className="settlement-tabs"><button disabled={busy || Boolean(review)} className={mode === 'send' ? 'active' : ''} onClick={() => setMode('send')}>SEND USDG</button><button disabled={busy || Boolean(review)} className={mode === 'receive' ? 'active' : ''} onClick={() => setMode('receive')}>RECEIVE / REQUEST</button></div>{!account ? <div className="settlement-connect"><WalletCards size={24} /><h2>Connect your wallet</h2><p>Read your balance and settle from your own account.</p><button className="transaction-primary" onClick={() => void connect()}>CONNECT WALLET <ArrowUpRight size={15} /></button></div> : walletChainId !== SETTLEMENT_CHAIN_ID ? <div className="settlement-connect"><h2>Robinhood Chain required</h2><p>Switch networks before preparing a payment.</p><button className="transaction-primary" onClick={() => void switchNetwork()}>SWITCH NETWORK <ArrowUpRight size={15} /></button></div> : mode === 'send' ? <form className="settlement-form" onSubmit={(e) => { e.preventDefault(); review ? void submit() : beginReview(); }}><label>RECIPIENT ADDRESS<input disabled={busy || Boolean(review)} value={recipient} onChange={(e) => { setRecipient(e.target.value); setReview(null); }} placeholder="0x…" spellCheck={false} /></label><label>USDG AMOUNT<div className="amount-input"><input disabled={busy || Boolean(review)} inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setReview(null); }} placeholder="0.00" /><button type="button" disabled={busy || Boolean(review)} onClick={() => setAmount(tokenBalance === null ? '' : formatUnits(tokenBalance, 6))}>MAX</button></div></label><div className="balance-line"><span>Available USDG</span><b>{tokenBalance === null ? '—' : formatUnits(tokenBalance, 6)}</b></div>{!validation.ok && (recipient || amount) && !review && <p className="field-error">{validation.message}</p>}{review && <div className="settlement-review"><span>READY TO SIGN</span><strong>{review.amount} USDG</strong><small>To {short(review.recipient)}</small><button type="button" disabled={busy} onClick={() => setReview(null)}>EDIT</button></div>}<button className="transaction-primary" disabled={busy || !tokenOk || paused !== false || (!review && !validation.ok)}>{busy ? <LoaderCircle className="spin" size={15} /> : review ? 'CONFIRM AND SIGN' : 'REVIEW SETTLEMENT'} <ArrowUpRight size={15} /></button><p className="form-note">Chain, balance, token state, and transfer simulation are checked again before signing.</p></form> : <div className="settlement-form"><label>PAYMENT REQUEST RECIPIENT<input value={account} readOnly /></label><label>USDG AMOUNT<div className="amount-input"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /><span>USDG</span></div></label><div className="request-box">{requestUri ? <code>{requestUri}</code> : <span>Enter an amount to generate a wallet payment request.</span>}<button onClick={() => void copy(requestUri)} disabled={!requestUri} aria-label="Copy payment request">{copied ? <Check size={16} /> : <Copy size={16} />}</button></div><p className="form-note"><Clipboard size={13} /> This is a wallet payment request, not an on-chain transaction until paid.</p></div>}</div>
        <aside className="settlement-summary"><p className="eyebrow">SETTLEMENT SUMMARY</p><h2>Verified before signing.</h2><dl><div><dt>NETWORK</dt><dd>Robinhood Chain · {SETTLEMENT_CHAIN_ID}</dd></div><div><dt>ASSET</dt><dd>USDG · {short(SETTLEMENT_TOKEN)}</dd></div><div><dt>RECIPIENT</dt><dd>{review ? short(review.recipient) : recipient && validation.ok ? short(validation.recipient) : '—'}</dd></div><div><dt>AMOUNT</dt><dd>{review?.amount || amount || '—'} USDG</dd></div><div><dt>ESTIMATED FEE</dt><dd>{feeEstimate === null ? '—' : `${Number(formatEther(feeEstimate)).toLocaleString(undefined, { maximumSignificantDigits: 4 })} ETH`}</dd></div></dl><div className="token-check"><ShieldCheck size={15} /><span>Canonical token checked<br /><small>{tokenOk && paused === false ? 'USDG · transfers active' : 'Transfer controls unavailable'}</small></span></div>{ethBalance !== null && <div className="eth-line">Wallet gas balance <b>{formatEther(ethBalance)} ETH</b></div>}</aside></section>
      {tx.stage !== 'idle' && <div className={`settlement-result ${tx.stage}`}><span>{tx.stage === 'success' ? <Check size={16} /> : tx.stage === 'signing' || tx.stage === 'confirming' ? <LoaderCircle className="spin" size={16} /> : <AlertTriangle size={16} />}</span><strong>{tx.message}</strong>{tx.hash && <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View on Blockscout <ExternalLink size={13} /></a>}</div>}
    </main><footer className="app-footer"><span>QUEN / SETTLEMENT RAILS</span><a href={EXPLORER} target="_blank" rel="noreferrer">Blockscout explorer <ExternalLink size={12} /></a></footer>
  </div>;
}