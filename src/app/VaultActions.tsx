import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hash,
} from 'viem';
import { ArrowUpRight, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, WalletCards } from 'lucide-react';

const CHAIN_ID = 4663;
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address;
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address;
const VAULT = '0xBeEff033F34C046626B8D0A041844C5d1A5409dd' as Address;
const UNISWAP_QUOTER = '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7' as Address;
const UNISWAP_ROUTER = '0xcaf681a66d020601342297493863e78c959e5cb2' as Address;
const SWAP_FEES = [100, 500, 3000, 10000] as const;
const SLIPPAGE_BPS = 50n;
const QUOTE_TTL_MS = 15_000;
const chain = {
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
} as const;

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function previewDeposit(uint256) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function previewWithdraw(uint256) view returns (uint256)',
  'function canReceiveShares(address) view returns (bool)',
  'function canSendAssets(address) view returns (bool)',
  'function deposit(uint256,address) returns (uint256)',
  'function withdraw(uint256,address,address) returns (uint256)',
]);

const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);

const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)',
]);

const publicClient = createPublicClient({ transport: http(RPC_URL) });
const compact = (value: bigint, decimals: number, digits = 4) =>
  Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });

type Props = {
  account: string | null;
  connected: boolean;
  onConnect: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
};

type TransactionState = {
  stage: 'idle' | 'signing' | 'confirming' | 'success' | 'error';
  message: string;
  hash?: Hash;
};

type SwapQuote = { amountOut: bigint; minimumOut: bigint; fee: number; gasEstimate: bigint; issuedAt: number; expiresAt: number };

async function readVerifiedRoute(address: Address) {
  const [rpcChainId, asset, tokenDecimals, tokenSymbol, vaultDecimals, canReceiveShares, canSendAssets, nativeBalance, tokenBalance, tokenAllowance, shares] =
    await Promise.all([
      publicClient.getChainId(),
      publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'asset', authorizationList: undefined }),
      publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: 'decimals', authorizationList: undefined }),
      publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: 'symbol', authorizationList: undefined }),
      publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'decimals', authorizationList: undefined }),
      publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'canReceiveShares', args: [address], authorizationList: undefined }),
      publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'canSendAssets', args: [address], authorizationList: undefined }),
      publicClient.getBalance({ address }),
      publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [address], authorizationList: undefined }),
      publicClient.readContract({ address: USDG, abi: erc20Abi, functionName: 'allowance', args: [address, VAULT], authorizationList: undefined }),
      publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'balanceOf', args: [address], authorizationList: undefined }),
    ]);
  if (
    rpcChainId !== CHAIN_ID ||
    asset.toLowerCase() !== USDG.toLowerCase() ||
    tokenDecimals !== 6 ||
    tokenSymbol !== 'USDG' ||
    vaultDecimals !== 18 ||
    !canReceiveShares ||
    !canSendAssets
  ) throw new Error('Contract identity or permission gate failed. Transactions remain unavailable.');
  const assets = shares > 0n
    ? await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'previewRedeem', args: [shares], authorizationList: undefined })
    : 0n;
  return { nativeBalance, tokenBalance, tokenAllowance, shares, assets };
}

async function quoteEthToUsdg(amountIn: bigint): Promise<SwapQuote> {
  const candidates = await Promise.allSettled(SWAP_FEES.map(async (fee) => {
    const result = await publicClient.simulateContract({
      address: UNISWAP_QUOTER,
      abi: quoterAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: WETH, tokenOut: USDG, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    const [amountOut, , , gasEstimate] = result.result;
    const issuedAt = Date.now();
    return { amountOut, minimumOut: amountOut * (10_000n - SLIPPAGE_BPS) / 10_000n, fee, gasEstimate, issuedAt, expiresAt: issuedAt + QUOTE_TTL_MS };
  }));
  const valid: SwapQuote[] = [];
  for (const candidate of candidates) {
    if (candidate.status === 'fulfilled' && candidate.value.amountOut > 0n) valid.push(candidate.value);
  }
  valid.sort((a, b) => a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0);
  if (!valid[0]) throw new Error('No valid on-chain ETH to USDG quote is available.');
  return valid[0];
}

const idleTransaction: TransactionState = { stage: 'idle', message: '' };

export default function VaultActions({ account, connected, onConnect, onSwitchNetwork }: Props) {
  const [routeState, setRouteState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [routeError, setRouteError] = useState('');
  const [usdgBalance, setUsdgBalance] = useState<bigint>(0n);
  const [ethBalance, setEthBalance] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [shareBalance, setShareBalance] = useState<bigint>(0n);
  const [redeemableAssets, setRedeemableAssets] = useState<bigint>(0n);
  const [supplyAmount, setSupplyAmount] = useState('');
  const [swapAmount, setSwapAmount] = useState('');
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [previewShares, setPreviewShares] = useState<bigint | null>(null);
  const [withdrawShares, setWithdrawShares] = useState<bigint | null>(null);
  const [transaction, setTransaction] = useState<TransactionState>(idleTransaction);
  const [now, setNow] = useState(Date.now());
  const refreshGeneration = useRef(0);

  const address = account as Address | null;

  const refreshPosition = useCallback(async () => {
    const requestGeneration = ++refreshGeneration.current;
    if (!address || !connected) {
      setRouteState('checking');
      setUsdgBalance(0n);
      setEthBalance(0n);
      setAllowance(0n);
      setShareBalance(0n);
      setRedeemableAssets(0n);
      return;
    }

    try {
      const { nativeBalance, tokenBalance, tokenAllowance, shares, assets } = await readVerifiedRoute(address);

      if (requestGeneration !== refreshGeneration.current) return;
      setUsdgBalance(tokenBalance);
      setEthBalance(nativeBalance);
      setAllowance(tokenAllowance);
      setShareBalance(shares);
      setRedeemableAssets(assets);
      setRouteState('ready');
      setRouteError('');
    } catch (error) {
      if (requestGeneration !== refreshGeneration.current) return;
      setRouteState('error');
      setRouteError(error instanceof Error ? error.message : 'Unable to verify the live USDG vault route.');
    }
  }, [address, connected]);

  useEffect(() => {
    void refreshPosition();
    const timer = window.setInterval(() => void refreshPosition(), 20_000);
    return () => {
      window.clearInterval(timer);
      refreshGeneration.current += 1;
    };
  }, [refreshPosition]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const supplyAssets = useMemo(() => {
    try { return supplyAmount ? parseUnits(supplyAmount, 6) : 0n; } catch { return 0n; }
  }, [supplyAmount]);

  const swapWei = useMemo(() => {
    try { return swapAmount ? parseUnits(swapAmount, 18) : 0n; } catch { return 0n; }
  }, [swapAmount]);

  const withdrawAssets = useMemo(() => {
    try { return withdrawAmount ? parseUnits(withdrawAmount, 6) : 0n; } catch { return 0n; }
  }, [withdrawAmount]);

  useEffect(() => {
    let cancelled = false;
    if (swapWei <= 0n || swapWei > ethBalance || routeState !== 'ready') {
      setSwapQuote(null);
      setQuoteState('idle');
      return;
    }
    const quote = async () => {
      setQuoteState('loading');
      let best: SwapQuote | null = null;
      try { best = await quoteEthToUsdg(swapWei); } catch { best = null; }
      if (cancelled) return;
      if (!best) {
        setSwapQuote(null);
        setQuoteState('error');
        return;
      }
      setSwapQuote(best);
      setQuoteState('ready');
    };
    const timer = window.setTimeout(() => void quote(), 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ethBalance, routeState, swapWei]);

  useEffect(() => {
    let cancelled = false;
    if (supplyAssets <= 0n || routeState !== 'ready') {
      setPreviewShares(null);
      return;
    }
    void publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'previewDeposit', args: [supplyAssets], authorizationList: undefined })
      .then((value) => { if (!cancelled) setPreviewShares(value); })
      .catch(() => { if (!cancelled) setPreviewShares(null); });
    return () => { cancelled = true; };
  }, [routeState, supplyAssets]);

  useEffect(() => {
    let cancelled = false;
    if (withdrawAssets <= 0n || routeState !== 'ready') {
      setWithdrawShares(null);
      return;
    }
    void publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'previewWithdraw', args: [withdrawAssets], authorizationList: undefined })
      .then((value) => { if (!cancelled) setWithdrawShares(value); })
      .catch(() => { if (!cancelled) setWithdrawShares(null); });
    return () => { cancelled = true; };
  }, [routeState, withdrawAssets]);

  const walletClient = () => {
    if (!window.ethereum || !address) throw new Error('Connect an injected wallet first.');
    return createWalletClient({ account: address, chain, transport: custom(window.ethereum as never) });
  };

  const submit = async (kind: 'swap' | 'approve' | 'deposit' | 'withdraw') => {
    if (!address || !connected) return;
    setTransaction({ stage: 'signing', message: 'Confirm the transaction in your wallet.' });
    try {
      const client = walletClient();
      const freshRoute = await readVerifiedRoute(address);
      let hash: Hash;

      if (kind === 'swap') {
        if (!swapQuote || swapQuote.expiresAt <= Date.now() || swapWei <= 0n || swapWei > freshRoute.nativeBalance) throw new Error('Refresh the ETH to USDG quote before swapping.');
        const freshQuote = await quoteEthToUsdg(swapWei);
        const swapCall = encodeFunctionData({
          abi: routerAbi,
          functionName: 'exactInputSingle',
          args: [{ tokenIn: WETH, tokenOut: USDG, fee: freshQuote.fee, recipient: address, amountIn: swapWei, amountOutMinimum: freshQuote.minimumOut, sqrtPriceLimitX96: 0n }],
        });
        const simulation = await publicClient.simulateContract({
          account: address,
          address: UNISWAP_ROUTER,
          abi: routerAbi,
          functionName: 'multicall',
          args: [BigInt(Math.floor(freshQuote.expiresAt / 1000)), [swapCall]],
          value: swapWei,
        });
        if (freshQuote.expiresAt <= Date.now()) throw new Error('The fresh swap quote expired before signing.');
        hash = await client.writeContract(simulation.request);
      } else if (kind === 'approve') {
        if (supplyAssets <= 0n || supplyAssets > freshRoute.tokenBalance) throw new Error('Enter a valid USDG amount within your balance.');
        const simulation = await publicClient.simulateContract({
          account: address, address: USDG, abi: erc20Abi, functionName: 'approve', args: [VAULT, supplyAssets],
        });
        hash = await client.writeContract(simulation.request);
      } else if (kind === 'deposit') {
        if (supplyAssets <= 0n || supplyAssets > freshRoute.tokenBalance || freshRoute.tokenAllowance < supplyAssets) {
          throw new Error('USDG amount or allowance is no longer sufficient.');
        }
        const simulation = await publicClient.simulateContract({
          account: address, address: VAULT, abi: vaultAbi, functionName: 'deposit', args: [supplyAssets, address],
        });
        hash = await client.writeContract(simulation.request);
      } else {
        const freshWithdrawShares = withdrawAssets > 0n
          ? await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: 'previewWithdraw', args: [withdrawAssets], authorizationList: undefined })
          : 0n;
        if (withdrawAssets <= 0n || withdrawAssets > freshRoute.assets || freshWithdrawShares <= 0n || freshWithdrawShares > freshRoute.shares) {
          throw new Error('Enter a valid withdraw amount within your current position.');
        }
        const simulation = await publicClient.simulateContract({
          account: address, address: VAULT, abi: vaultAbi, functionName: 'withdraw', args: [withdrawAssets, address, address],
        });
        hash = await client.writeContract(simulation.request);
      }

      setTransaction({ stage: 'confirming', message: 'Transaction submitted. Waiting for mainnet confirmation.', hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== 'success') throw new Error('Transaction reverted on Robinhood Chain.');
      setTransaction({
        stage: 'success',
        message: kind === 'swap' ? 'Swap confirmed. USDG is now available in your wallet.' : kind === 'approve' ? 'USDG spending approved.' : kind === 'deposit' ? 'Supply confirmed. Vault shares are now in your wallet.' : 'Withdrawal confirmed. USDG returned to your wallet.',
        hash,
      });
      if (kind !== 'approve') {
        setSwapAmount('');
        setSupplyAmount('');
        setWithdrawAmount('');
      }
      await refreshPosition();
    } catch (error) {
      setTransaction({
        stage: 'error',
        message: error instanceof Error ? error.message : 'Transaction was not completed.',
      });
    }
  };

  if (!account) {
    return <section className="vault-actions" id="vault-actions">
      <div><p className="eyebrow">LIVE ACTION / 03</p><div className="action-brand"><img src="/brand/usdg.png" alt="Global Dollar USDG" /><img src="/brand/morpho.svg" alt="Morpho" /></div><h3>Supply USDG. Earn through Morpho.</h3><p>Connect your wallet to read your real USDG balance and transact directly with the Steakhouse USDG vault.</p></div>
      <button className="transaction-primary" onClick={() => void onConnect()}><WalletCards size={16} /> CONNECT WALLET</button>
    </section>;
  }

  if (!connected) {
    return <section className="vault-actions" id="vault-actions">
      <div><p className="eyebrow">LIVE ACTION / 03</p><h3>Robinhood Chain required.</h3><p>Switch networks before QUEN reads balances or prepares a transaction.</p></div>
      <button className="transaction-primary" onClick={() => void onSwitchNetwork()}>SWITCH NETWORK <ArrowUpRight size={15} /></button>
    </section>;
  }

  const busy = transaction.stage === 'signing' || transaction.stage === 'confirming';
  const needsApproval = supplyAssets > allowance;

  return <section className="vault-actions" id="vault-actions">
    <div className="vault-actions-head">
      <div><p className="eyebrow">LIVE ACTION / 03</p><h3>Supply and withdraw USDG</h3><p>Transactions go directly from your wallet to the verified Morpho Vault V2 contract. QUEN never takes custody.</p></div>
      <button className="position-refresh" onClick={() => void refreshPosition()} disabled={busy}><RefreshCw size={13} /> Refresh balances</button>
    </div>

    {routeState === 'error' && <div className="transaction-message error">{routeError}</div>}
    <div className="position-strip">
      <div><span>WALLET USDG</span><strong>{routeState === 'ready' ? compact(usdgBalance, 6, 2) : '—'}</strong></div>
      <div><span>VAULT SHARES</span><strong>{routeState === 'ready' ? compact(shareBalance, 18, 6) : '—'}</strong></div>
      <div><span>REDEEMABLE USDG</span><strong>{routeState === 'ready' ? compact(redeemableAssets, 6, 2) : '—'}</strong></div>
      <div><span>ROUTE</span><strong className={routeState}>{routeState === 'ready' ? 'VERIFIED LIVE' : routeState.toUpperCase()}</strong></div>
    </div>

    <div className="transaction-progress" aria-label="Transaction flow"><span className={usdgBalance === 0n ? 'active' : 'complete'}>GET USDG</span><i /><span className={usdgBalance > 0n && allowance === 0n ? 'active' : allowance > 0n ? 'complete' : ''}>APPROVE</span><i /><span className={allowance > 0n ? 'active' : ''}>SUPPLY</span></div>

    <div className="swap-panel">
      <form onSubmit={(event) => { event.preventDefault(); void submit('swap'); }}>
        <div className="transaction-title"><span>00</span><img src="/brand/ethereum.svg" alt="" /><strong>GET USDG WITH ETH</strong><img src="/brand/usdg.png" alt="" /></div>
        <label>ETH amount<input inputMode="decimal" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} placeholder="0.00" disabled={busy || routeState !== 'ready'} /><button type="button" onClick={() => setSwapAmount(formatUnits(ethBalance * 95n / 100n, 18))}>MAX</button></label>
        <div className="swap-details">
          <span>Balance <b>{compact(ethBalance, 18, 5)} ETH</b></span>
          <span>Best Uniswap fee <b>{swapQuote ? `${swapQuote.fee / 10_000}%` : '—'}</b></span>
          <span>Estimated output <b>{swapQuote ? `${compact(swapQuote.amountOut, 6, 2)} USDG` : quoteState === 'loading' ? 'Quoting…' : '—'}</b></span>
          <span>Minimum received <b>{swapQuote ? `${compact(swapQuote.minimumOut, 6, 2)} USDG` : '—'}</b></span>
        </div>
        {quoteState === 'error' && <small className="quote-error">No valid on-chain quote is available. Swap remains disabled.</small>}
         <button className="transaction-primary" disabled={busy || quoteState !== 'ready' || !swapQuote || swapQuote.expiresAt <= now || swapWei <= 0n || swapWei > ethBalance}>
          {busy ? <LoaderCircle className="spin" size={15} /> : 'SWAP ETH TO USDG'}
        </button>
         <small>0.5% maximum slippage. Quote expires after 15 seconds, is refreshed before signing, and carries an on-chain deadline.</small>
      </form>
    </div>

    <div className="transaction-grid">
      <form onSubmit={(event) => { event.preventDefault(); void submit(needsApproval ? 'approve' : 'deposit'); }}>
        <div className="transaction-title"><span>01</span><img src="/brand/usdg.png" alt="" /><strong>SUPPLY USDG</strong><img src="/brand/morpho.svg" alt="" /></div>
        <label>Amount<input inputMode="decimal" value={supplyAmount} onChange={(event) => setSupplyAmount(event.target.value)} placeholder="0.00" disabled={busy || routeState !== 'ready'} /><button type="button" onClick={() => setSupplyAmount(formatUnits(usdgBalance, 6))}>MAX</button></label>
        <small>Estimated shares: {previewShares === null ? '—' : compact(previewShares, 18, 6)} steakUSDG</small>
        <button className="transaction-primary" disabled={busy || routeState !== 'ready' || supplyAssets <= 0n || supplyAssets > usdgBalance}>
          {busy ? <LoaderCircle className="spin" size={15} /> : needsApproval ? 'APPROVE USDG' : 'SUPPLY TO MORPHO'}
        </button>
      </form>

      <form onSubmit={(event) => { event.preventDefault(); void submit('withdraw'); }}>
        <div className="transaction-title"><span>02</span><img src="/brand/morpho.svg" alt="" /><strong>WITHDRAW USDG</strong><img src="/brand/usdg.png" alt="" /></div>
        <label>Amount<input inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="0.00" disabled={busy || routeState !== 'ready'} /><button type="button" onClick={() => setWithdrawAmount(formatUnits(redeemableAssets, 6))}>MAX</button></label>
        <small>Shares to burn: {withdrawShares === null ? '—' : compact(withdrawShares, 18, 6)} steakUSDG</small>
        <button className="transaction-secondary" disabled={busy || routeState !== 'ready' || withdrawAssets <= 0n || withdrawAssets > redeemableAssets}>
          {busy ? <LoaderCircle className="spin" size={15} /> : 'WITHDRAW TO WALLET'}
        </button>
      </form>
    </div>

    {transaction.stage !== 'idle' && <div className={`transaction-message ${transaction.stage}`}>
      {transaction.stage === 'success' && <CheckCircle2 size={15} />}
      {(transaction.stage === 'signing' || transaction.stage === 'confirming') && <LoaderCircle className="spin" size={15} />}
      <span>{transaction.message}</span>
      {transaction.hash && <a href={`${EXPLORER}/tx/${transaction.hash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a>}
    </div>}
    <p className="transaction-risk">Yield is variable and not guaranteed. Morpho vault deposits involve smart-contract, oracle, collateral, liquidity, and curator risk. Review the transaction in your wallet before signing.</p>
  </section>;
}