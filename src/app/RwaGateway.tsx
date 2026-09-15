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
import { AlertTriangle, ArrowUpRight, CheckCircle2, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import robinhoodRegistry from '../../research/sources/stablecoin-robinhood-contracts.md?raw';
import {
  EIP1967_SLOTS,
  MAX_ORACLE_AGE_SECONDS,
  MAX_ROUND_TRIP_LOSS_BPS,
  PROVEN_CHAINLINK_FEEDS,
  RWA_DISCLOSURE_URL,
  RWA_REGISTRY_URL,
  TOKENISED_EQUITY_LEGAL_WORDING,
} from './rwaEvidence';

const CHAIN_ID = 4663;
const CHAIN_HEX = '0x1237';
const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const RPC_TRANSPORT_URL = '/robinhood-rpc';
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address;
const QUOTER = '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7' as Address;
const ROUTER = '0xcaf681a66d020601342297493863e78c959e5cb2' as Address;
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as Address;
const FEES = [100, 500, 3000, 10000] as const;
const SLIPPAGE_BPS = 50n;
const QUOTE_TTL_MS = 15_000;
const MAX_PRICE_IMPACT_BPS = 100;
const MAX_QUOTE_TWAP_DEVIATION_BPS = 200;
const chain = {
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
} as const;

type Asset = { ticker: string; name: string; address: Address; logo?: string; kind: 'Stock' | 'ETF' };
type Status = 'Registry' | 'Qualified' | 'Tradable' | 'Blocked';
type Gate = { key: string; label: string; passed: boolean; detail: string };
type PoolEvidence = {
  fee: number;
  pool: Address | null;
  queried: boolean;
  valid: boolean;
  token0?: Address;
  token1?: Address;
  poolFee?: number;
  liquidity?: bigint;
  sqrtPriceX96?: bigint;
  tick?: number;
  observations?: number;
  twap?: number;
  spot?: number;
  checks: Gate[];
  error?: string;
};
type PrivilegedEvidence = {
  paused: boolean | null;
  oraclePaused: boolean | null;
  owner: Address | null;
  ownerReadable: boolean;
  implementationSlot: `0x${string}` | null;
  adminSlot: `0x${string}` | null;
  beaconSlot: `0x${string}` | null;
  resolvedImplementation: Address | null;
  implementationCode: `0x${string}` | undefined;
  storageReadable: boolean;
};
type OracleEvidence = {
  feed: Address | null;
  bytecode: `0x${string}` | undefined;
  decimals: number | null;
  roundId: bigint | null;
  answer: bigint | null;
  updatedAt: bigint | null;
  answeredInRound: bigint | null;
  ageSeconds: number | null;
  history: { timestamp: number; price: number }[];
  passed: boolean;
  detail: string;
};
type QualityComponent = { label: string; score: number | null; detail: string };
type Assessment = {
  key: string;
  block: bigint | null;
  chainId: number | null;
  metadata: { name: string; symbol: string; decimals: number } | null;
  identityGates: Gate[];
  marketGates: Gate[];
  gates: Gate[];
  pools: PoolEvidence[];
  selectedPool: PoolEvidence | null;
  twap: number | null;
  spot: number | null;
  onChainScore: number;
  offChainScore: number | null;
  offChainComponents: QualityComponent[];
  privileged: PrivilegedEvidence;
  oracle: OracleEvidence;
};
type Quote = {
  amountOut: bigint;
  minimumOut: bigint;
  fee: number;
  issuedAt: number;
  expiresAt: number;
  requestKey: string;
  reverseAmountOut: bigint;
  reverseIssuedAt: number;
  reverseExpiresAt: number;
  roundTripLossBps: number;
};
type TxState = { stage: 'idle' | 'signing' | 'confirming' | 'success' | 'error'; message: string; hash?: Hash };

const REGISTRY_PATTERN = /^\| (.+?) • Robinhood Token \| ([^|]+?) \| .*?`(0x[a-fA-F0-9]{40})`/gm;
const ASSETS: Asset[] = Array.from(robinhoodRegistry.matchAll(REGISTRY_PATTERN), (match) => ({
  name: match[1].trim(),
  ticker: match[2].trim(),
  address: match[3] as Address,
  logo: `/market-logos/rwa/${encodeURIComponent(match[2].trim())}.png`,
  kind: (/\b(ETF|Trust|Fund)\b/i.test(match[1]) ? 'ETF' : 'Stock') as Asset['kind'],
})).sort((a, b) => a.ticker.localeCompare(b.ticker));
const DEFAULT_ASSET = ASSETS.find((asset) => asset.ticker === 'AAPL') ?? ASSETS[0]!;

const tokenAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function paused() view returns (bool)',
  'function oraclePaused() view returns (bool)',
  'function owner() view returns (address)',
]);
const aggregatorAbi = parseAbi([
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
  'function getRoundData(uint80 roundId) view returns (uint80 id,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
]);
const beaconAbi = parseAbi(['function implementation() view returns (address)']);
const quoterAbi = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);
const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)',
]);
const factoryAbi = parseAbi([
  'function getPool(address,address,uint24) view returns (address)',
  'function feeAmountTickSpacing(uint24) view returns (int24)',
]);
const poolAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)',
]);
const client = createPublicClient({
  transport: http(RPC_TRANSPORT_URL, {
    batch: { batchSize: 50, wait: 10 },
    retryCount: 5,
    retryDelay: 1_000,
    timeout: 20_000,
  }),
});
const ZERO = '0x0000000000000000000000000000000000000000';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const display = (value: bigint, decimals: number, digits = 4) =>
  Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: digits });
const sameAddress = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const gate = (key: string, label: string, passed: boolean, detail: string): Gate => ({ key, label, passed, detail });
const friendlyError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/429|too many requests/i.test(message)) return 'Network is busy. Retrying shortly.';
  if (/502|bad gateway|http request failed/i.test(message)) return 'Market data is temporarily unavailable.';
  if (/timeout|timed out/i.test(message)) return 'Market data request timed out.';
  if (/revert|execution reverted/i.test(message)) return 'This market check is not supported by the contract.';
  return fallback;
};
const priceFromTick = (tick: number, token0: Address, asset: Address, assetDecimals: number) => {
  const token0IsAsset = sameAddress(token0, asset);
  const token1PerToken0 = Math.pow(1.0001, tick) * Math.pow(10, token0IsAsset ? assetDecimals - 6 : 6 - assetDecimals);
  return token0IsAsset ? token1PerToken0 : 1 / token1PerToken0;
};
const addressFromSlot = (slot: `0x${string}` | null): Address | null => {
  if (!slot || slot === '0x' || /^0x0+$/.test(slot)) return null;
  const value = `0x${slot.slice(-40)}` as Address;
  return value === ZERO ? null : value;
};

async function inspectPool(asset: Asset, fee: number, assetDecimals: number): Promise<PoolEvidence> {
  try {
    const pool = await client.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: 'getPool',
      args: [USDG, asset.address, fee],
      authorizationList: undefined,
    }) as Address;
    if (pool.toLowerCase() === ZERO) return { fee, pool: null, queried: true, valid: false, checks: [], error: 'Factory returned no pool for this fee tier.' };
    const [code, token0, token1, poolFee, liquidity, slot0, observation] = await Promise.all([
      client.getBytecode({ address: pool }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'token0', authorizationList: undefined }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'token1', authorizationList: undefined }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'fee', authorizationList: undefined }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity', authorizationList: undefined }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0', authorizationList: undefined }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'observe', args: [[300, 0]], authorizationList: undefined }),
    ]);
    const observationValues = observation[0] as readonly bigint[];
    const tick = Number(slot0[1]);
    const tickDelta = observationValues[1] - observationValues[0];
    let twapTick = tickDelta / 300n;
    if (tickDelta < 0n && tickDelta % 300n !== 0n) twapTick -= 1n;
    const checks = [
      gate('pool-bytecode', 'Pool bytecode', Boolean(code && code !== '0x'), 'The factory target has deployed bytecode.'),
      gate('pool-tokens', 'Pool token pair', (sameAddress(token0, USDG) && sameAddress(token1, asset.address)) || (sameAddress(token0, asset.address) && sameAddress(token1, USDG)), `token0 ${short(token0)} · token1 ${short(token1)}`),
      gate('pool-fee', 'Pool fee', Number(poolFee) === fee, `Factory tier ${fee} · pool reports ${Number(poolFee)}`),
      gate('pool-liquidity', 'Pool liquidity', liquidity > 0n, `${formatUnits(liquidity, 0)} liquidity units`),
      gate('pool-slot0', 'Pool slot0', slot0[0] > 0n && Number.isFinite(tick) && slot0[6], `sqrtPriceX96 ${slot0[0] > 0n ? 'present' : 'zero'} · tick ${tick} · ${slot0[6] ? 'unlocked' : 'locked'}`),
      gate('pool-observe', '5-minute observe()', observationValues.length >= 2 && slot0[3] >= 2, `Cumulative ticks returned for [300, 0] seconds ago · ${slot0[3]} stored observations.`),
    ];
    const valid = checks.every((item) => item.passed);
    return {
      fee, pool, queried: true, valid, token0, token1, poolFee: Number(poolFee), liquidity,
      sqrtPriceX96: slot0[0], tick, observations: Number(slot0[3]), twap: priceFromTick(Number(twapTick), token0, asset.address, assetDecimals),
      spot: priceFromTick(tick, token0, asset.address, assetDecimals), checks,
    };
  } catch (error) {
    return { fee, pool: null, queried: false, valid: false, checks: [], error: friendlyError(error, 'Pool data is unavailable.') };
  }
}

async function assessAsset(asset: Asset, key: string): Promise<Assessment> {
  let chainId: number | null = null;
  let block: bigint | null = null;
  let bytecode: `0x${string}` | undefined;
  let metadata: Assessment['metadata'] = null;
  const [chainResult, blockResult, bytecodeResult] = await Promise.allSettled([
    client.getChainId(), client.getBlockNumber(), client.getBytecode({ address: asset.address }),
  ]);
  chainId = chainResult.status === 'fulfilled' ? chainResult.value : null;
  block = blockResult.status === 'fulfilled' ? blockResult.value : null;
  bytecode = bytecodeResult.status === 'fulfilled' ? bytecodeResult.value : undefined;
  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address: asset.address, abi: tokenAbi, functionName: 'name', authorizationList: undefined }),
      client.readContract({ address: asset.address, abi: tokenAbi, functionName: 'symbol', authorizationList: undefined }),
      client.readContract({ address: asset.address, abi: tokenAbi, functionName: 'decimals', authorizationList: undefined }),
    ]);
    metadata = { name, symbol, decimals: Number(decimals) };
  } catch {
    metadata = null;
  }
  let paused: boolean | null = null;
  let oraclePaused: boolean | null = null;
  let owner: Address | null = null;
  let ownerReadable = false;
  const [pausedResult, oraclePausedResult, ownerResult] = await Promise.allSettled([
    client.readContract({ address: asset.address, abi: tokenAbi, functionName: 'paused', authorizationList: undefined }),
    client.readContract({ address: asset.address, abi: tokenAbi, functionName: 'oraclePaused', authorizationList: undefined }),
    client.readContract({ address: asset.address, abi: tokenAbi, functionName: 'owner', authorizationList: undefined }),
  ]);
  paused = pausedResult.status === 'fulfilled' ? pausedResult.value : null;
  oraclePaused = oraclePausedResult.status === 'fulfilled' ? oraclePausedResult.value : null;
  if (ownerResult.status === 'fulfilled') { owner = ownerResult.value; ownerReadable = true; }
  let implementationSlot: `0x${string}` | null = null;
  let adminSlot: `0x${string}` | null = null;
  let beaconSlot: `0x${string}` | null = null;
  let storageReadable = true;
  const slotResults = await Promise.all(Object.entries(EIP1967_SLOTS).map(async ([name, slot]) => {
    try { return [name, await client.getStorageAt({ address: asset.address, slot: slot as `0x${string}` })] as const; }
    catch { return [name, null] as const; }
  }));
  for (const [name, value] of slotResults) {
    if (value === undefined) storageReadable = false;
    if (name === 'implementation') implementationSlot = value ?? null;
    if (name === 'admin') adminSlot = value ?? null;
    if (name === 'beacon') beaconSlot = value ?? null;
  }
  const implementationAddress = addressFromSlot(implementationSlot);
  const beaconAddress = addressFromSlot(beaconSlot);
  let beaconImplementation: Address | null = null;
  if (beaconAddress) {
    try { beaconImplementation = await client.readContract({ address: beaconAddress, abi: beaconAbi, functionName: 'implementation', authorizationList: undefined }); } catch { beaconImplementation = null; }
  }
  const resolvedImplementation = implementationAddress ?? beaconImplementation;
  let implementationCode: `0x${string}` | undefined;
  if (resolvedImplementation) {
    try { implementationCode = await client.getBytecode({ address: resolvedImplementation }); } catch { implementationCode = undefined; }
  }
  const privileged: PrivilegedEvidence = {
    paused, oraclePaused, owner, ownerReadable, implementationSlot, adminSlot, beaconSlot,
    resolvedImplementation, implementationCode, storageReadable,
  };
  let oracle: OracleEvidence;
  const feed = PROVEN_CHAINLINK_FEEDS[asset.ticker] ?? null;
  if (!feed) {
    oracle = { feed: null, bytecode: undefined, decimals: null, roundId: null, answer: null, updatedAt: null, answeredInRound: null, ageSeconds: null, history: [], passed: false, detail: 'NOT ASSESSED: no proven official Chainlink tokenized-equity mapping is available for this asset.' };
  } else {
    let feedBytecode: `0x${string}` | undefined;
    let feedDecimals: number | null = null;
    let roundId: bigint | null = null;
    let answer: bigint | null = null;
    let updatedAt: bigint | null = null;
    let answeredInRound: bigint | null = null;
    let history: OracleEvidence['history'] = [];
    try {
      feedBytecode = await client.getBytecode({ address: feed });
      feedDecimals = Number(await client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'decimals', authorizationList: undefined }));
      const latest = await client.readContract({ address: feed, abi: aggregatorAbi, functionName: 'latestRoundData', authorizationList: undefined }) as readonly [bigint, bigint, bigint, bigint, bigint];
      [roundId, answer, , updatedAt, answeredInRound] = latest;
      const firstRound = roundId > 23n ? roundId - 23n : 1n;
      const roundIds = Array.from({ length: Number(roundId - firstRound + 1n) }, (_, index) => firstRound + BigInt(index));
      const rounds = await Promise.allSettled(roundIds.map((id) => client.readContract({
        address: feed,
        abi: aggregatorAbi,
        functionName: 'getRoundData',
        args: [id],
        authorizationList: undefined,
      })));
      history = rounds.flatMap((result) => {
        if (result.status !== 'fulfilled') return [];
        const [, roundAnswer, , roundUpdatedAt] = result.value;
        if (roundAnswer <= 0n || roundUpdatedAt <= 0n) return [];
        return [{ timestamp: Number(roundUpdatedAt), price: Number(roundAnswer) / 100_000_000 }];
      }).sort((a, b) => a.timestamp - b.timestamp);
    } catch {
      feedBytecode = undefined;
    }
    const currentTimestamp = await client.getBlock().then((value) => value.timestamp).catch(() => BigInt(Math.floor(Date.now() / 1000)));
    const ageSeconds = updatedAt === null ? null : Number(currentTimestamp - updatedAt);
    const fresh = ageSeconds !== null && ageSeconds >= 0 && ageSeconds <= MAX_ORACLE_AGE_SECONDS;
    const passed = Boolean(feedBytecode && feedBytecode !== '0x' && feedDecimals === 8 && answer !== null && answer > 0n && updatedAt && updatedAt > 0n && answeredInRound !== null && roundId !== null && answeredInRound >= roundId && fresh);
    oracle = {
      feed, bytecode: feedBytecode, decimals: feedDecimals, roundId, answer, updatedAt, answeredInRound, ageSeconds, history, passed,
      detail: `Chainlink tokenized-equity total-return reference · ${short(feed)} · decimals ${feedDecimals ?? 'unreadable'} · answer ${answer?.toString() ?? 'unreadable'} · updatedAt ${updatedAt?.toString() ?? 'unreadable'} · age ${ageSeconds === null ? 'unreadable' : `${ageSeconds}s`}.`,
    };
  }
  const decimals = metadata?.decimals ?? 18;
  const identityGates = [
    gate('registry', 'Canonical registry match', ASSETS.some((item) => sameAddress(item.address, asset.address) && item.ticker === asset.ticker), `${asset.ticker} address is sourced from the Robinhood contract registry.`),
    gate('chain', 'Robinhood Chain', chainId === CHAIN_ID, chainId === null ? 'Chain ID could not be read.' : `RPC chain ID ${chainId} · required ${CHAIN_ID}`),
    gate('bytecode', 'Token bytecode', Boolean(bytecode && bytecode !== '0x'), 'The canonical token address has deployed bytecode.'),
    gate('metadata', 'Token metadata', Boolean(metadata && metadata.name.trim() === `${asset.name} • Robinhood Token` && metadata.symbol.trim() === asset.ticker && metadata.decimals <= 36), metadata ? `name ${metadata.name} · symbol ${metadata.symbol} · decimals ${metadata.decimals}` : 'name(), symbol(), or decimals() could not be read.'),
    gate('token-paused', 'Token transfer control', paused === false, paused === null ? 'paused() could not be verified.' : paused ? 'Token contract reports paused=true.' : 'Token contract reports paused=false.'),
    gate('oracle-control', 'Token oracle control', oraclePaused === false, oraclePaused === null ? 'oraclePaused() could not be verified.' : oraclePaused ? 'Token contract reports oraclePaused=true.' : 'Token contract reports oraclePaused=false.'),
    gate('privileged-storage', 'EIP-1967 authority storage', storageReadable, storageReadable ? `implementation ${implementationAddress ? short(implementationAddress) : 'empty'} · admin slot ${adminSlot && !/^0x0+$/.test(adminSlot) ? 'set' : 'empty'} · beacon ${beaconAddress ? short(beaconAddress) : 'empty'}.` : 'One or more required EIP-1967 storage reads failed.'),
    gate('implementation-code', 'Resolved implementation bytecode', !beaconAddress && !resolvedImplementation || Boolean(resolvedImplementation && implementationCode && implementationCode !== '0x'), resolvedImplementation ? `${short(resolvedImplementation)} · ${implementationCode && implementationCode !== '0x' ? 'deployed code present' : 'code unreadable or empty'}` : beaconAddress ? `Beacon ${short(beaconAddress)} disclosed but implementation() could not be resolved.` : 'No EIP-1967 implementation or beacon was disclosed by storage.'),
  ];
  let factoryCode: `0x${string}` | undefined;
  let quoterCode: `0x${string}` | undefined;
  let routerCode: `0x${string}` | undefined;
  const tickSpacings: number[] = [];
  const [venueResults, spacingResults, pools] = await Promise.all([
    Promise.all([FACTORY, QUOTER, ROUTER].map(async (address) => {
      try { return await client.getBytecode({ address: address as Address }); } catch { return undefined; }
    })),
    Promise.all(FEES.map(async (fee) => {
      try { return Number(await client.readContract({ address: FACTORY, abi: factoryAbi, functionName: 'feeAmountTickSpacing', args: [fee], authorizationList: undefined })); } catch { return 0; }
    })),
    Promise.all(FEES.map((fee) => inspectPool(asset, fee, decimals))),
  ]);
  [factoryCode, quoterCode, routerCode] = venueResults;
  tickSpacings.push(...spacingResults);
  const allPoolChecks = pools.every((pool) => pool.queried && (!pool.pool || pool.checks.every((item) => item.passed)));
  const selectedPool = pools.filter((pool) => pool.valid).sort((a, b) => Number(b.liquidity ?? 0n) - Number(a.liquidity ?? 0n))[0] ?? null;
  const marketGates = [
    gate('venue-bytecode', 'Execution venue bytecode', Boolean(factoryCode && factoryCode !== '0x' && quoterCode && quoterCode !== '0x' && routerCode && routerCode !== '0x'), `Factory ${short(FACTORY)} · quoter ${short(QUOTER)} · router ${short(ROUTER)} must all have deployed bytecode.`),
    gate('fee-tiers', 'Factory fee controls', tickSpacings.length === FEES.length && tickSpacings.every((spacing) => spacing > 0), FEES.map((fee, index) => `${fee}: ${tickSpacings[index] || 'unverified'}`).join(' · ')),
    gate('all-pools', 'Configured fee pools', allPoolChecks, `${FEES.length} fee tiers queried through the Uniswap factory.`),
    gate('valid-pool', 'Valid execution pool', Boolean(selectedPool), selectedPool ? `Selected ${short(selectedPool.pool!)} at ${selectedPool.fee / 10_000}% fee.` : 'No fee tier passed every pool contract check.'),
    gate('twap', '5-minute TWAP', Boolean(selectedPool?.twap && Number.isFinite(selectedPool.twap) && selectedPool.twap > 0), selectedPool?.twap ? `${selectedPool.twap.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDG per token.` : 'observe() did not produce a usable 5-minute price.'),
  ];
  const oracleGate = gate('oracle-feed', 'Official underlying oracle', oracle.passed, oracle.detail);
  const gates = [...identityGates, oracleGate, ...marketGates];
  const weights: Record<string, number> = { registry: 8, chain: 8, bytecode: 8, metadata: 8, 'token-paused': 8, 'oracle-control': 8, 'privileged-storage': 8, 'implementation-code': 8, 'venue-bytecode': 8, 'fee-tiers': 5, 'all-pools': 5, 'valid-pool': 8, twap: 10 };
  const onChainScore = gates.filter((item) => item.key !== 'oracle-feed').reduce((total, item) => total + (item.passed ? (weights[item.key] ?? 0) : 0), 0);
  const offChainComponents: QualityComponent[] = [
    { label: 'Legal/document evidence', score: 30, detail: 'Official registry and disclosure links are available; wording is limited to economic exposure.' },
    { label: 'Official Chainlink reference', score: oracle.passed ? 35 : null, detail: oracle.passed ? 'A proven standard AggregatorV3 feed passed bytecode, decimals, answer, round, and freshness checks.' : oracle.detail },
    { label: 'Eligibility verification', score: null, detail: 'NOT ASSESSED: no verified onboarding/KYC provider is connected.' },
  ];
  const offChainScore = offChainComponents.some((component) => component.score === null) ? null : offChainComponents.reduce((total, component) => total + (component.score ?? 0), 0);
  return { key, block, chainId, metadata, identityGates, marketGates, gates, pools, selectedPool, twap: selectedPool?.twap ?? null, spot: selectedPool?.spot ?? null, onChainScore, offChainScore, offChainComponents, privileged, oracle };
}

async function singleQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): Promise<{ amountOut: bigint; issuedAt: number; expiresAt: number }> {
  const simulation = await client.simulateContract({
    address: QUOTER,
    abi: quoterAbi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  const amountOut = simulation.result[0];
  if (amountOut <= 0n) throw new Error('Quoter returned zero output.');
  const issuedAt = Date.now();
  return { amountOut, issuedAt, expiresAt: issuedAt + QUOTE_TTL_MS };
}

async function quoteForPool(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number, requestKey: string): Promise<Quote> {
  const forward = await singleQuote(tokenIn, tokenOut, amountIn, fee);
  const reverse = await singleQuote(tokenOut, tokenIn, forward.amountOut, fee);
  const roundTripLossBps = Number((amountIn > reverse.amountOut ? amountIn - reverse.amountOut : 0n) * 10_000n / amountIn);
  if (!Number.isFinite(roundTripLossBps)) throw new Error('Round-trip loss could not be calculated.');
  return {
    amountOut: forward.amountOut,
    minimumOut: forward.amountOut * (10_000n - SLIPPAGE_BPS) / 10_000n,
    fee,
    issuedAt: forward.issuedAt,
    expiresAt: forward.expiresAt,
    requestKey,
    reverseAmountOut: reverse.amountOut,
    reverseIssuedAt: reverse.issuedAt,
    reverseExpiresAt: reverse.expiresAt,
    roundTripLossBps,
  };
}

export default function RwaGateway() {
  const [account, setAccount] = useState<Address | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState(DEFAULT_ASSET);
  const [search, setSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState<'All' | 'Stock' | 'ETF'>('All');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenSymbol, setTokenSymbol] = useState(selected.ticker);
  const [usdgBalance, setUsdgBalance] = useState(0n);
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [allowance, setAllowance] = useState(0n);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessmentState, setAssessmentState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [assessmentError, setAssessmentError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteState, setQuoteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState('');
  const [orderGates, setOrderGates] = useState<Gate[]>([]);
  const [showEvidence, setShowEvidence] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tx, setTx] = useState<TxState>({ stage: 'idle', message: '' });
  const selectionRef = useRef(0);
  const assessmentRequestRef = useRef(0);
  const quoteRequestRef = useRef(0);
  const submitRequestRef = useRef(0);
  const balanceRequestRef = useRef(0);

  const inputDecimals = side === 'buy' ? 6 : tokenDecimals;
  const inputBalance = side === 'buy' ? usdgBalance : tokenBalance;
  const inputToken = side === 'buy' ? USDG : selected.address;
  const outputToken = side === 'buy' ? selected.address : USDG;
  const parsedAmount = useMemo(() => {
    try { return amount ? parseUnits(amount, inputDecimals) : 0n; } catch { return 0n; }
  }, [amount, inputDecimals]);
  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ASSETS.filter((asset) => (assetFilter === 'All' || asset.kind === assetFilter) && (!query || asset.ticker.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query)));
  }, [assetFilter, search]);
  const baseMarketReady = Boolean(assessment?.identityGates.every((item) => item.passed) && assessment?.marketGates.every((item) => item.passed));
  const orderReady = orderGates.length > 0 && orderGates.every((item) => item.passed) && Boolean(quote && quote.expiresAt > now);
  const technicalReady = Boolean(assessment?.identityGates.every((item) => item.passed) && assessment?.marketGates.every((item) => item.passed));
  const status: Status = assessmentState === 'error' ? 'Blocked' : !assessment ? 'Registry' : !technicalReady ? 'Blocked' : orderReady ? 'Tradable' : 'Qualified';
  const secondsRemaining = quote ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) : 0;
  const busy = tx.stage === 'signing' || tx.stage === 'confirming';

  const invalidateWalletState = useCallback(() => {
    balanceRequestRef.current += 1;
    quoteRequestRef.current += 1;
    submitRequestRef.current += 1;
    setAccount(null);
    setConnected(false);
    setUsdgBalance(0n);
    setTokenBalance(0n);
    setAllowance(0n);
    setQuote(null);
    setOrderGates([]);
    setQuoteState('idle');
  }, []);

  const assertCurrentWallet = useCallback(async (expectedAccount: Address) => {
    if (!window.ethereum) throw new Error('No injected wallet was found.');
    const [walletChain, accounts] = await Promise.all([
      window.ethereum.request({ method: 'eth_chainId' }) as Promise<string>,
      window.ethereum.request({ method: 'eth_accounts' }) as Promise<string[]>,
    ]);
    if (walletChain.toLowerCase() !== CHAIN_HEX || !sameAddress(accounts[0], expectedAccount)) {
      invalidateWalletState();
      throw new Error('Wallet account or network changed. Reconnect on Robinhood Chain and request a new quote.');
    }
  }, [invalidateWalletState]);

  const connect = async () => {
    if (!window.ethereum) {
      setTx({ stage: 'error', message: 'No injected wallet was found.' });
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      const walletChain = await window.ethereum.request({ method: 'eth_chainId' }) as string;
      if (walletChain.toLowerCase() !== CHAIN_HEX) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
        } catch (error) {
          const code = (error as { code?: number }).code;
          if (code !== 4902) throw error;
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC_URL], blockExplorerUrls: [EXPLORER] }] });
        }
      }
      setAccount(accounts[0] as Address);
      setConnected(true);
      setTx({ stage: 'idle', message: '' });
    } catch (error) {
      setTx({ stage: 'error', message: error instanceof Error ? error.message : 'Wallet connection failed.' });
    }
  };

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const accountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      if (!account || !sameAddress(accounts?.[0], account)) invalidateWalletState();
    };
    const chainChanged = (...args: unknown[]) => {
      const nextChain = String(args[0] ?? '').toLowerCase();
      if (nextChain !== CHAIN_HEX) invalidateWalletState();
    };
    window.ethereum.on('accountsChanged', accountsChanged);
    window.ethereum.on('chainChanged', chainChanged);
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', accountsChanged);
      window.ethereum?.removeListener?.('chainChanged', chainChanged);
    };
  }, [account, invalidateWalletState]);

  const refreshBalances = useCallback(async () => {
    const request = ++balanceRequestRef.current;
    try {
      const [block, usdBalance, rwaBalance, approved] = await Promise.all([
        client.getBlockNumber(),
        account ? client.readContract({ address: USDG, abi: tokenAbi, functionName: 'balanceOf', args: [account], authorizationList: undefined }) : Promise.resolve(0n),
        account ? client.readContract({ address: selected.address, abi: tokenAbi, functionName: 'balanceOf', args: [account], authorizationList: undefined }) : Promise.resolve(0n),
        account ? client.readContract({ address: side === 'buy' ? USDG : selected.address, abi: tokenAbi, functionName: 'allowance', args: [account, ROUTER], authorizationList: undefined }) : Promise.resolve(0n),
      ]);
      if (request !== balanceRequestRef.current) return;
      setAssessment((current) => current ? { ...current, block } : current);
      setUsdgBalance(usdBalance);
      setTokenBalance(rwaBalance);
      setAllowance(approved);
    } catch {
      if (request !== balanceRequestRef.current) return;
      setUsdgBalance(0n);
      setTokenBalance(0n);
      setAllowance(0n);
    }
  }, [account, selected.address, side]);

  useEffect(() => {
    const key = ++selectionRef.current;
    const request = ++assessmentRequestRef.current;
    setAssessment(null);
    setAssessmentState('loading');
    setAssessmentError('');
    setQuote(null);
    setQuoteState('idle');
    setOrderGates([]);
    setAmount('');
    void assessAsset(selected, `${selected.address}:${key}`).then((result) => {
      if (request !== assessmentRequestRef.current || key !== selectionRef.current) return;
      setAssessment(result);
      setAssessmentState('ready');
      if (result.metadata) {
        setTokenDecimals(result.metadata.decimals);
        setTokenSymbol(result.metadata.symbol);
      }
    }).catch((error) => {
      if (request !== assessmentRequestRef.current || key !== selectionRef.current) return;
      setAssessmentState('error');
      setAssessmentError(friendlyError(error, 'Market assessment is temporarily unavailable.'));
    });
  }, [selected]);

  useEffect(() => { void refreshBalances(); }, [refreshBalances, assessment?.key]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const evaluateOrder = useCallback((nextQuote: Quote, nextAssessment: Assessment, nextAmount: bigint, nextInputDecimals: number, nextOutputDecimals: number) => {
    const executionPrice = side === 'buy'
      ? Number(formatUnits(nextAmount, nextInputDecimals)) / Number(formatUnits(nextQuote.amountOut, nextOutputDecimals))
      : Number(formatUnits(nextQuote.amountOut, nextOutputDecimals)) / Number(formatUnits(nextAmount, nextInputDecimals));
    const spotDeviation = nextAssessment.spot && executionPrice > 0 ? Math.abs(executionPrice / nextAssessment.spot - 1) * 10_000 : Infinity;
    const twapDeviation = nextAssessment.twap && executionPrice > 0 ? Math.abs(executionPrice / nextAssessment.twap - 1) * 10_000 : Infinity;
    return [
      gate('quote-expiry', 'Quote freshness', nextQuote.expiresAt > Date.now(), `Quote expires in ${Math.max(0, Math.ceil((nextQuote.expiresAt - Date.now()) / 1000))}s.`),
      gate('reverse-quote', 'Immediate reverse quote', nextQuote.reverseAmountOut > 0n && nextQuote.reverseExpiresAt > Date.now(), `Same ${nextQuote.fee / 10_000}% pool fee · reverse output ${display(nextQuote.reverseAmountOut, nextInputDecimals, 6)} · expires in ${Math.max(0, Math.ceil((nextQuote.reverseExpiresAt - Date.now()) / 1000))}s.`),
      gate('round-trip-loss', 'Round-trip recovery', nextQuote.roundTripLossBps >= 0 && nextQuote.roundTripLossBps <= MAX_ROUND_TRIP_LOSS_BPS, `${nextQuote.roundTripLossBps.toFixed(1)} bps total loss from exact forward output and immediate reverse quote · limit ${MAX_ROUND_TRIP_LOSS_BPS} bps.`),
      gate('price-impact', 'Per-order price impact', Number.isFinite(spotDeviation) && spotDeviation <= MAX_PRICE_IMPACT_BPS, `${Number.isFinite(spotDeviation) ? spotDeviation.toFixed(1) : '—'} bps vs current pool spot · limit ${MAX_PRICE_IMPACT_BPS} bps.`),
      gate('quote-twap', 'Quote vs 5-minute TWAP', Number.isFinite(twapDeviation) && twapDeviation <= MAX_QUOTE_TWAP_DEVIATION_BPS, `${Number.isFinite(twapDeviation) ? twapDeviation.toFixed(1) : '—'} bps deviation · limit ${MAX_QUOTE_TWAP_DEVIATION_BPS} bps.`),
    ];
  }, [side]);

  useEffect(() => {
    const request = ++quoteRequestRef.current;
    const key = selectionRef.current;
    if (!assessment?.selectedPool || !baseMarketReady || parsedAmount <= 0n || parsedAmount > inputBalance) {
      setQuote(null);
      setQuoteState('idle');
      setOrderGates([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setQuoteState('loading');
      setQuoteError('');
      void quoteForPool(inputToken, outputToken, parsedAmount, assessment.selectedPool!.fee, `${key}:${request}`).then((nextQuote) => {
        if (request !== quoteRequestRef.current || key !== selectionRef.current) return;
        const gates = evaluateOrder(nextQuote, assessment, parsedAmount, inputDecimals, side === 'buy' ? tokenDecimals : 6);
        setQuote(nextQuote);
        setOrderGates(gates);
        setQuoteState('ready');
      }).catch((error) => {
        if (request !== quoteRequestRef.current || key !== selectionRef.current) return;
        setQuote(null);
        setOrderGates([]);
        setQuoteState('error');
        setQuoteError(friendlyError(error, 'No valid on-chain quote is available.'));
      });
    }, 350);
    return () => { window.clearTimeout(timer); };
  }, [assessment, baseMarketReady, evaluateOrder, inputBalance, inputDecimals, inputToken, outputToken, parsedAmount, side, tokenDecimals]);

  const submit = async () => {
    if (!account || !connected || !window.ethereum || status !== 'Tradable' || parsedAmount <= 0n) return;
    const key = selectionRef.current;
    const request = ++submitRequestRef.current;
    try {
      setTx({ stage: 'signing', message: 'Revalidating registry, pools, quote, and transaction simulation…' });
      const freshAssessment = await assessAsset(selected, `${selected.address}:submit:${request}`);
      if (key !== selectionRef.current || request !== submitRequestRef.current) throw new Error('The selected asset changed; review the current assessment.');
      if (!freshAssessment.identityGates.every((item) => item.passed) || !freshAssessment.marketGates.every((item) => item.passed) || !freshAssessment.selectedPool) throw new Error('Fresh on-chain assessment is not tradable.');
      const freshQuote = await quoteForPool(inputToken, outputToken, parsedAmount, freshAssessment.selectedPool.fee, `${key}:submit:${request}`);
      const freshGates = evaluateOrder(freshQuote, freshAssessment, parsedAmount, inputDecimals, side === 'buy' ? tokenDecimals : 6);
      if (!freshGates.every((item) => item.passed)) throw new Error(`Fresh order gates failed: ${freshGates.filter((item) => !item.passed).map((item) => item.label).join(', ')}.`);
      await assertCurrentWallet(account);
      const freshAllowance = await client.readContract({ address: inputToken, abi: tokenAbi, functionName: 'allowance', args: [account, ROUTER], authorizationList: undefined });
      const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum as never) });
      let simulation;
      if (freshAllowance < parsedAmount) {
        simulation = await client.simulateContract({ account, address: inputToken, abi: tokenAbi, functionName: 'approve', args: [ROUTER, parsedAmount] });
      } else {
        const swapCall = encodeFunctionData({
          abi: routerAbi,
          functionName: 'exactInputSingle',
          args: [{ tokenIn: inputToken, tokenOut: outputToken, fee: freshQuote.fee, recipient: account, amountIn: parsedAmount, amountOutMinimum: freshQuote.minimumOut, sqrtPriceLimitX96: 0n }],
        });
        simulation = await client.simulateContract({
          account, address: ROUTER, abi: routerAbi, functionName: 'multicall',
          args: [BigInt(Math.floor(freshQuote.expiresAt / 1000)), [swapCall]],
        });
      }
      if (key !== selectionRef.current || request !== submitRequestRef.current) throw new Error('The selected asset changed before signing.');
      if (freshAllowance >= parsedAmount && freshQuote.expiresAt <= Date.now()) throw new Error('The revalidated quote expired before signing. Request a new quote.');
      await assertCurrentWallet(account);
      const hash = await wallet.writeContract(simulation.request);
      setTx({ stage: 'confirming', message: 'Waiting for Robinhood Chain confirmation.', hash });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('Transaction reverted on Robinhood Chain.');
      const approved = freshAllowance < parsedAmount;
      setTx({ stage: 'success', message: approved ? 'Router approval confirmed. Re-validate the quote before executing the trade.' : `${side === 'buy' ? 'Buy' : 'Sell'} confirmed on-chain.`, hash });
      if (key !== selectionRef.current || request !== submitRequestRef.current) return;
      if (!approved) setAmount('');
      setAssessment(freshAssessment);
      setQuote(freshQuote);
      setOrderGates(freshGates);
      await refreshBalances();
    } catch (error) {
      setTx({ stage: 'error', message: friendlyError(error, 'Transaction was not completed.') });
    }
  };

  const chartPoints = useMemo(() => {
    const points = assessment?.oracle.history.length
      ? assessment.oracle.history.map((point) => point.price)
      : assessment?.selectedPool?.twap && assessment.selectedPool.spot
        ? [assessment.selectedPool.twap, assessment.selectedPool.spot]
        : [];
    if (points.length < 2) return '';
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    return points.map((price, index) => `${index / (points.length - 1) * 100},${80 - ((price - min) / range) * 60}`).join(' ');
  }, [assessment]);
  const chartUsesOracle = Boolean(assessment?.oracle.history.length);
  const chartStart = assessment?.oracle.history[0]?.timestamp;
  const chartEnd = assessment?.oracle.history.at(-1)?.timestamp;
  const selectAsset = (asset: Asset) => {
    selectionRef.current += 1;
    setSelected(asset);
    window.setTimeout(() => document.getElementById('rwa-trade')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  };

  return <div className="liquidity-app rwa-gateway">
    <header className="liquidity-header">
      <a className="app-brand" href="/"><span className="app-logo"><img src="/quen-logo-blue.png" alt="QUEN" /></span><span><strong>QUEN</strong><small>RWA GATEWAY</small></span></a>
      <nav className="app-product-nav"><a href="/app">LIQUIDITY</a><a className="active" href="/app/rwa">RWA GATEWAY</a><a href="/app/settlement">SETTLEMENT</a></nav>
      <div className="header-center"><img src="/brand/robinhood-chain.png" alt="" /><span className={`status-dot ${assessment?.chainId === CHAIN_ID ? 'online' : assessmentState === 'loading' ? '' : 'error'}`} /> ROBINHOOD CHAIN <b>{assessment?.chainId === CHAIN_ID ? 'LIVE' : assessmentState === 'loading' ? 'SYNCING' : 'UNAVAILABLE'}</b></div>
      <div className="header-actions">{account ? <span className="wallet-chip"><span className="wallet-live" />{short(account)}</span> : <button className="connect-button" onClick={() => void connect()}>CONNECT WALLET</button>}</div>
    </header>
    <main className="liquidity-main">
      <section className="rwa-hero">
         <div><p className="eyebrow">TOKENIZED MARKETS / 01</p><h1>RWA <em>Gateway.</em></h1><p>Discover canonical Robinhood Tokens and inspect live contract evidence before any USDG route can move funds.</p><div className="rwa-assurance"><span><ShieldCheck size={13} /> CANONICAL REGISTRY</span><span><ShieldCheck size={13} /> CHAINLINK REFERENCE</span><span><ShieldCheck size={13} /> SIMULATED FIRST</span></div></div>
        <div className="rwa-live-card"><span>LIVE ASSESSMENT</span><strong>{assessmentState === 'loading' ? 'SYNCING' : status.toUpperCase()}</strong><small>Technical market evidence only; no underlying security price is represented.</small><dl><div><dt>CHAIN</dt><dd>4663</dd></div><div><dt>BLOCK</dt><dd>{assessment?.block?.toLocaleString() ?? '—'}</dd></div></dl></div>
      </section>
      <section className="rwa-market-layout">
        <div className="rwa-assets">
          <div className="rwa-section-head"><div><p className="eyebrow">MARKET REGISTRY / 02</p><h2>Canonical assets</h2></div><button onClick={() => { setSelected({ ...selected }); void refreshBalances(); }}><RefreshCw size={13} /> REFRESH</button></div>
          <div className="rwa-search"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ticker or company" /><span>{filteredAssets.length} / {ASSETS.length}</span></div>
          <div className="rwa-filter-tabs">{(['All', 'Stock', 'ETF'] as const).map((filter) => <button key={filter} className={assetFilter === filter ? 'active' : ''} onClick={() => setAssetFilter(filter)}>{filter === 'All' ? 'ALL ASSETS' : `${filter.toUpperCase()}S`}</button>)}</div>
          <div className="rwa-asset-list">{filteredAssets.map((asset) => <button key={asset.address} className={selected.address === asset.address ? 'selected' : ''} onClick={() => selectAsset(asset)}>
            <span className="rwa-asset-logo"><b>{asset.ticker.slice(0, 2)}</b>{asset.logo && <img src={asset.logo} alt={`${asset.name} logo`} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</span>
            <span><strong>{asset.ticker}</strong><small>{asset.name}</small></span><span className="asset-kind">{asset.kind}</span><span className="rwa-route-live registry"><i /> CANONICAL</span>
          </button>)}</div>
        </div>
        <div className={`rwa-trade market-${assessmentState}`} id="rwa-trade">
          <div className="rwa-trade-identity"><span className="rwa-asset-logo large"><b>{selected.ticker.slice(0, 2)}</b>{selected.logo && <img src={selected.logo} alt={`${selected.name} logo`} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}</span><div><small>{selected.kind.toUpperCase()} · ROBINHOOD TOKEN</small><h2>{selected.name} <em>{selected.ticker}</em></h2><a href={`${EXPLORER}/token/${selected.address}`} target="_blank" rel="noreferrer">{short(selected.address)} <ExternalLink size={12} /></a></div><span className={`verified-badge assessment-status ${status.toLowerCase()}`}>{status === 'Tradable' ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />} {assessmentState === 'loading' ? 'SYNCING' : status.toUpperCase()}</span></div>
           <div className="rwa-assessment">
              <div className="assessment-head"><div><span>QUALITY CHECK</span><strong>{assessment ? `${assessment.onChainScore}/100 ON-CHAIN` : '—'}</strong></div><button type="button" onClick={() => setShowEvidence((value) => !value)}>{showEvidence ? 'HIDE DETAILS' : 'VIEW DETAILS'}</button></div>
              {showEvidence && (assessmentState === 'loading' ? <div className="assessment-empty"><LoaderCircle className="spin" size={16} /> CHECKING MARKET</div> : assessmentState === 'error' ? <div className="assessment-empty blocked"><AlertTriangle size={16} /> {assessmentError}</div> : <><div className="assessment-gates">{assessment?.gates.map((item) => <div className={`assessment-gate ${item.passed ? 'passed' : 'blocked'}`} key={item.key}><span>{item.passed ? 'PASS' : 'BLOCK'}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></div>)}</div><div className="assessment-pools"><strong>POOL CHECKS</strong>{assessment?.pools.map((pool) => <div className={`pool-row ${pool.valid ? 'valid' : 'unavailable'}`} key={pool.fee}><span>{pool.fee / 10_000}%</span><b>{pool.pool ? short(pool.pool) : 'NO POOL'}</b><small>{pool.valid ? `Liquidity available · TWAP ${pool.twap!.toLocaleString(undefined, { maximumFractionDigits: 6 })}` : pool.error ?? 'Unavailable'}</small></div>)}</div><div className="evidence-columns"><div className="evidence-block"><strong>CONTRACT CONTROLS</strong><p>Transfers: <b>{assessment?.privileged.paused === false ? 'ACTIVE' : 'UNAVAILABLE'}</b> · Oracle: <b>{assessment?.privileged.oraclePaused === false ? 'ACTIVE' : 'UNAVAILABLE'}</b></p><p>Upgrade implementation: <b>{assessment?.privileged.resolvedImplementation ? short(assessment.privileged.resolvedImplementation) : 'NONE'}</b></p></div><div className="evidence-block"><strong>DOCUMENTS</strong><p><a href={RWA_REGISTRY_URL} target="_blank" rel="noreferrer">Robinhood registry <ExternalLink size={11} /></a><br /><a href={RWA_DISCLOSURE_URL} target="_blank" rel="noreferrer">Product disclosure <ExternalLink size={11} /></a></p><p>{TOKENISED_EQUITY_LEGAL_WORDING}</p></div></div><div className="oracle-evidence"><strong>PRICE REFERENCE</strong><span>{assessment?.oracle.passed ? 'Official Chainlink reference available.' : 'Official reference not available for this asset.'}</span></div></>)}
          </div>
           <div className="rwa-price-chart"><div className="chart-head"><div><span>{chartUsesOracle ? 'CHAINLINK OFFICIAL TOKENIZED-EQUITY REFERENCE' : 'UNISWAP V3 EXECUTION PRICE'}</span><strong>{chartUsesOracle && assessment?.oracle.answer ? `$${(Number(assessment.oracle.answer) / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : assessment?.twap ? `${assessment.twap.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDG` : assessmentState === 'loading' ? 'LOADING MARKET' : 'PRICE UNAVAILABLE'}</strong><small>{chartUsesOracle ? `${assessment?.oracle.history.length} verified on-chain Chainlink rounds` : assessment?.selectedPool ? `Live pool ${short(assessment.selectedPool.pool!)} · ${assessment.selectedPool.fee / 10_000}% fee` : 'No verified feed or execution curve is available for this asset.'}</small></div><span className={`market-data-state ${assessmentState}`}>{assessmentState === 'ready' ? (chartUsesOracle ? 'OFFICIAL FEED' : 'LIVE POOL') : assessmentState.toUpperCase()}</span></div><div className="chart-canvas">{chartPoints ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${selected.ticker} ${chartUsesOracle ? 'official Chainlink reference history' : 'on-chain execution price'}`}><polyline points={chartPoints} fill="none" stroke="#4a91ff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg> : <div className={`chart-empty ${assessmentState}`}>{assessmentState === 'loading' ? <LoaderCircle className="spin" size={18} /> : 'PRICE DATA UNAVAILABLE'}</div>}</div><div className="chart-axis"><span>{chartUsesOracle && chartStart ? new Date(chartStart * 1000).toLocaleDateString() : 'TWAP'}</span><span>{chartUsesOracle ? 'CHAINLINK · ROBINHOOD CHAIN' : 'LIVE EXECUTION ROUTE'}</span><span>{chartUsesOracle && chartEnd ? new Date(chartEnd * 1000).toLocaleDateString() : `BLOCK ${assessment?.block?.toLocaleString() ?? '—'}`}</span></div></div>
          <div className="rwa-order-panel">
            <div className="trade-tabs"><button type="button" className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>BUY</button><button type="button" className={side === 'sell' ? 'active sell' : ''} onClick={() => setSide('sell')}>SELL</button></div>
            {!account ? <div className="rwa-connect"><WalletCards size={25} /><strong>Connect to trade {selected.ticker}</strong><p>Wallet balances and approvals are read only after Robinhood Chain is connected.</p><button className="transaction-primary" onClick={() => void connect()}>CONNECT WALLET</button></div> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <div className="trade-balance"><span>AVAILABLE</span><strong>{display(inputBalance, inputDecimals)} {side === 'buy' ? 'USDG' : tokenSymbol}</strong></div>
               <label>YOU PAY<div><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" disabled={busy || status === 'Blocked' || status === 'Registry'} /><button type="button" disabled={busy || status === 'Blocked' || status === 'Registry'} onClick={() => setAmount(formatUnits(inputBalance, inputDecimals))}>MAX</button><span>{side === 'buy' ? 'USDG' : tokenSymbol}</span></div></label>
               <div className={`trade-quote ${quoteState}`}><span>YOU RECEIVE</span><strong>{quote ? display(quote.amountOut, side === 'buy' ? tokenDecimals : 6, 6) : quoteState === 'loading' ? 'READING FORWARD + REVERSE QUOTES…' : '—'} {quote ? (side === 'buy' ? tokenSymbol : 'USDG') : ''}</strong>{quote && <small>FORWARD + IMMEDIATE REVERSE · SAME {quote.fee / 10_000}% POOL · EXPIRES IN {secondsRemaining}s</small>}</div>
               <dl className="trade-details"><div><dt>BEST POOL FEE</dt><dd>{quote ? `${quote.fee / 10_000}%` : '—'}</dd></div><div><dt>MINIMUM RECEIVED</dt><dd>{quote ? `${display(quote.minimumOut, side === 'buy' ? tokenDecimals : 6, 6)} ${side === 'buy' ? tokenSymbol : 'USDG'}` : '—'}</dd></div><div><dt>MAX SLIPPAGE</dt><dd>0.5%</dd></div><div><dt>ROUND TRIP RECOVERY</dt><dd>{quote ? `${(100 - quote.roundTripLossBps / 100).toFixed(2)}% · ${quote.roundTripLossBps.toFixed(1)} bps loss` : '—'}</dd></div></dl>
              {orderGates.length > 0 && <div className="order-gates">{orderGates.map((item) => <div className={item.passed ? 'passed' : 'blocked'} key={item.key}><span>{item.passed ? 'PASS' : 'BLOCK'}</span><small>{item.label}: {item.detail}</small></div>)}</div>}
              {(quoteState === 'error' || quoteError) && <p className="trade-error">{quoteError || 'No valid on-chain quote. Trading remains disabled.'}</p>}
               {status !== 'Tradable' && <p className="trade-error">{status === 'Blocked' ? 'Trading is blocked until every hard technical gate passes.' : 'Enter an amount to request fresh forward and exit quotes.'}</p>}
              <button className={`transaction-primary ${side === 'sell' ? 'sell' : ''}`} disabled={busy || status !== 'Tradable' || !quote || parsedAmount <= 0n || parsedAmount > inputBalance}>{busy ? <LoaderCircle className="spin" size={15} /> : allowance < parsedAmount ? `APPROVE ${side === 'buy' ? 'USDG' : tokenSymbol}` : `${side.toUpperCase()} ${tokenSymbol}`}</button>
            </form>}
            {tx.stage !== 'idle' && <div className={`transaction-message ${tx.stage}`}>{tx.stage === 'success' && <CheckCircle2 size={15} />}{(tx.stage === 'signing' || tx.stage === 'confirming') && <LoaderCircle className="spin" size={15} />}<span>{tx.message}</span>{tx.hash && <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={12} /></a>}</div>}
          </div>
          <p className="rwa-disclosure">Robinhood Tokens are tokenized financial instruments with issuer, market, liquidity, smart-contract, and regulatory risk. They may not provide identical rights to directly held shares. QUEN does not issue, custody, or guarantee these assets.</p>
        </div>
      </section>
    </main>
  </div>;
}