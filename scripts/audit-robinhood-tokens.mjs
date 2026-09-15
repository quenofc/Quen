#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { decodeAbiParameters, encodeAbiParameters, keccak256, toBytes } from 'viem';

const ROOT = process.cwd();
const SOURCE_FILE = process.env.ROBINHOOD_TOKEN_SOURCE
  ? path.resolve(ROOT, process.env.ROBINHOOD_TOKEN_SOURCE)
  : path.resolve(ROOT, 'research/sources/stablecoin-robinhood-contracts.md');
const JSON_FILE = path.resolve(ROOT, 'research/generated/rwa-control-audit.json');
const MARKDOWN_FILE = path.resolve(ROOT, 'research/generated/rwa-control-audit.md');
const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const EXPECTED_CHAIN_ID = 4663;
const CONCURRENCY = 3;
const MIN_BATCH_START_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 30_000;
const ZERO = '0x0000000000000000000000000000000000000000';
const MULTICALL = '0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1';

const text = await fs.readFile(SOURCE_FILE, 'utf8');
const registryPattern = /^\| (.+?) • Robinhood Token \| ([^|]+?) \| .*?`(0x[a-fA-F0-9]{40})`/gm;
const tokens = Array.from(text.matchAll(registryPattern), (match) => ({
  name: match[1].trim(),
  symbol: match[2].trim(),
  address: match[3],
}));

if (tokens.length === 0) {
  throw new Error(`No canonical Robinhood Token rows found in ${SOURCE_FILE}`);
}

const selector = (signature) => keccak256(toBytes(signature)).slice(0, 10);
const selectors = {
  name: selector('name()'),
  symbol: selector('symbol()'),
  decimals: selector('decimals()'),
  paused: selector('paused()'),
  oraclePaused: selector('oraclePaused()'),
  owner: selector('owner()'),
  beaconImplementation: selector('implementation()'),
  tryAggregate: selector('tryAggregate(bool,(address,bytes)[])'),
};
const slots = {
  implementation: `0x${(BigInt(keccak256(toBytes('eip1967.proxy.implementation'))) - 1n).toString(16).padStart(64, '0')}`,
  admin: `0x${(BigInt(keccak256(toBytes('eip1967.proxy.admin'))) - 1n).toString(16).padStart(64, '0')}`,
  beacon: `0x${(BigInt(keccak256(toBytes('eip1967.proxy.beacon'))) - 1n).toString(16).padStart(64, '0')}`,
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const isHex = (value) => typeof value === 'string' && /^0x[0-9a-f]*$/i.test(value);
const isAddress = (value) => /^0x[0-9a-f]{40}$/i.test(value);
const normalizeAddress = (value) => `0x${value.slice(-40).toLowerCase()}`;
const isZeroWord = (value) => /^0x0{64}$/i.test(value);
const errorMessage = (error) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
};

class RateLimitedRpc {
  #nextStart = 0;
  #schedule = Promise.resolve();
  #requestId = 1;

  constructor(url, intervalMs) {
    this.url = url;
    this.intervalMs = intervalMs;
  }

  async send(requests) {
    const ids = requests.map(() => this.#requestId++);
    const payload = requests.map((request, index) => ({ jsonrpc: '2.0', id: ids[index], ...request }));
    let response;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const turn = this.#schedule.then(async () => {
        const wait = Math.max(0, this.#nextStart - Date.now());
        if (wait) await sleep(wait);
        this.#nextStart = Date.now() + this.intervalMs;
      });
      this.#schedule = turn.catch(() => {});
      await turn;
      try {
        response = await fetch(this.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.ok) break;
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) await sleep(500 * 2 ** attempt);
    }
    if (!response?.ok) {
      const message = errorMessage(lastError || new Error('RPC request failed'));
      return new Map(ids.map((id) => [id, { error: { code: -1, message } }]));
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      const message = `Invalid JSON-RPC response: ${errorMessage(error)}`;
      return new Map(ids.map((id) => [id, { error: { code: -1, message } }]));
    }
    const replies = Array.isArray(body) ? body : [body];
    const byId = new Map(replies.map((reply) => [reply.id, reply]));
    return new Map(ids.map((id) => [id, byId.get(id) || { error: { code: -1, message: 'Missing response for JSON-RPC request.' } }]));
  }

  request(request) {
    return this.send([request]).then((results) => results.values().next().value);
  }
}

const rpc = new RateLimitedRpc(RPC_URL, MIN_BATCH_START_INTERVAL_MS);

const rpcError = (reply) => {
  if (!reply?.error) return null;
  if (typeof reply.error === 'string') return reply.error;
  return String(reply.error.message || `RPC error ${reply.error.code}`);
};
const unknown = (error, extra = {}) => ({ status: 'unknown', error: error || 'unknown', ...extra });
const ok = (value, extra = {}) => ({ status: 'ok', value, ...extra });
const absent = (extra = {}) => ({ status: 'absent', ...extra });

const codeObservation = (reply) => {
  const error = rpcError(reply);
  if (error) return unknown(error);
  if (!isHex(reply?.result)) return unknown('RPC response did not contain hex bytecode.');
  if (reply.result === '0x') return absent({ codeHash: null, byteLength: 0 });
  return ok({
    codeHash: keccak256(reply.result),
    byteLength: Math.max(0, (reply.result.length - 2) / 2),
  });
};

const wordObservation = (reply, decode) => {
  const error = rpcError(reply);
  if (error) return unknown(error);
  if (!isHex(reply?.result) || reply.result.length < 66) return unknown('RPC call returned no complete ABI word.');
  try {
    return ok(decode(reply.result));
  } catch (decodeError) {
    return unknown(`ABI decode failed: ${errorMessage(decodeError)}`);
  }
};

const decodeUint = (result) => BigInt(`0x${result.slice(2, 66)}`).toString();
const decodeBool = (result) => {
  const value = BigInt(`0x${result.slice(2, 66)}`);
  if (value !== 0n && value !== 1n) throw new Error(`Invalid boolean word ${value.toString()}`);
  return value === 1n;
};
const decodeAddress = (result) => normalizeAddress(result);
const decodeString = (result) => {
  const bytes = Buffer.from(result.slice(2), 'hex');
  if (bytes.length >= 64) {
    const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
    if (offset >= 0 && offset + 32 <= bytes.length) {
      const length = Number(BigInt(`0x${bytes.subarray(offset, offset + 32).toString('hex')}`));
      if (length >= 0 && offset + 32 + length <= bytes.length) {
        return bytes.subarray(offset + 32, offset + 32 + length).toString('utf8');
      }
    }
  }
  if (bytes.length === 32) return bytes.toString('utf8').replace(/\0+$/g, '');
  throw new Error('Invalid dynamic string encoding');
};

const callRequest = (address, data, blockTag) => ({
  method: 'eth_call',
  params: [{ to: address, data }, blockTag],
});
const multicallRequest = (token, blockTag) => {
  const calls = [
    selectors.name,
    selectors.symbol,
    selectors.decimals,
    selectors.paused,
    selectors.oraclePaused,
    selectors.owner,
  ].map((data) => ({ target: token.address, callData: data }));
  const data = `${selectors.tryAggregate}${encodeAbiParameters([
    {
      type: 'bool',
    },
    {
      type: 'tuple[]',
      components: [
        { name: 'target', type: 'address' },
        { name: 'callData', type: 'bytes' },
      ],
    },
  ], [false, calls]).slice(2)}`;
  return callRequest(MULTICALL, data, blockTag);
};
const codeRequest = (address, blockTag) => ({
  method: 'eth_getCode',
  params: [address, blockTag],
});
const storageRequest = (address, slot, blockTag) => ({
  method: 'eth_getStorageAt',
  params: [address, slot, blockTag],
});

const blockReply = await rpc.send([
  { method: 'eth_chainId', params: [] },
  { method: 'eth_blockNumber', params: [] },
]);
const chainReply = [...blockReply.values()][0];
const blockNumberReply = [...blockReply.values()][1];
const chainId = (() => {
  const error = rpcError(chainReply);
  if (error || !isHex(chainReply?.result)) return unknown(error || 'Chain ID was not returned.');
  try { return ok(Number(BigInt(chainReply.result))); } catch (error_) { return unknown(errorMessage(error_)); }
})();
const blockNumber = (() => {
  const error = rpcError(blockNumberReply);
  if (error || !isHex(blockNumberReply?.result)) return unknown(error || 'Block number was not returned.');
  try { return ok(Number(BigInt(blockNumberReply.result))); } catch (error_) { return unknown(errorMessage(error_)); }
})();
const blockTag = blockNumber.status === 'ok' ? `0x${blockNumber.value.toString(16)}` : 'latest';
const blockDetailsReply = await rpc.request({ method: 'eth_getBlockByNumber', params: [blockTag, false] });
const blockDetailsError = rpcError(blockDetailsReply);
const blockDetails = (() => {
  if (blockDetailsError) return unknown(blockDetailsError);
  if (!blockDetailsReply?.result || !isHex(blockDetailsReply.result.timestamp)) return unknown('Block timestamp was not returned.');
  try {
    const timestamp = Number(BigInt(blockDetailsReply.result.timestamp));
    return ok({ unix: timestamp, iso: new Date(timestamp * 1000).toISOString() });
  } catch (error) {
    return unknown(`Invalid block timestamp: ${errorMessage(error)}`);
  }
})();

const initialRequests = (token) => {
  return [
    multicallRequest(token, blockTag),
    codeRequest(token.address, blockTag),
    storageRequest(token.address, slots.implementation, blockTag),
    storageRequest(token.address, slots.admin, blockTag),
    storageRequest(token.address, slots.beacon, blockTag),
  ];
};

const decodeMulticall = (reply) => {
  const error = rpcError(reply);
  if (error) return Array.from({ length: 6 }, () => ({ error }));
  if (!isHex(reply?.result)) return Array.from({ length: 6 }, () => ({ error: 'Multicall returned no ABI data.' }));
  try {
    const decoded = decodeAbiParameters([{
      type: 'tuple[]',
      components: [{ name: 'success', type: 'bool' }, { name: 'returnData', type: 'bytes' }],
    }], reply.result)[0];
    if (!Array.isArray(decoded) || decoded.length !== 6) throw new Error(`Expected 6 multicall results, received ${decoded?.length ?? 0}`);
    return decoded.map((result) => result.success ? { result: result.returnData } : { error: 'eth_call subcall reverted' });
  } catch (decodeError) {
    return Array.from({ length: 6 }, () => ({ error: `Multicall ABI decode failed: ${errorMessage(decodeError)}` }));
  }
};

const initialResults = [];
let nextToken = 0;
const worker = async () => {
  while (nextToken < tokens.length) {
    const index = nextToken++;
    const replies = await rpc.send(initialRequests(tokens[index]));
    const values = [...replies.values()];
    const subcalls = decodeMulticall(values[0]);
    initialResults[index] = new Map([
      ...subcalls.map((reply, offset) => [offset, reply]),
      [6, values[2]],
      [7, values[3]],
      [8, values[4]],
      [9, values[1]],
    ]);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tokens.length) }, () => worker()));

const replyAt = (map, index) => [...map.values()][index];
const slotObservation = (reply) => {
  const error = rpcError(reply);
  if (error) return { slot: unknown(error), address: unknown(error) };
  if (!isHex(reply?.result) || reply.result.length < 66) {
    const issue = 'Storage RPC response did not contain a complete 32-byte word.';
    return { slot: unknown(issue), address: unknown(issue) };
  }
  const raw = reply.result.toLowerCase();
  if (isZeroWord(raw)) return { slot: absent({ raw }), address: absent({ value: ZERO }) };
  const address = normalizeAddress(raw);
  return { slot: ok({ raw }), address: ok(address) };
};

const observations = initialResults.map((results, index) => {
  const token = tokens[index];
  const code = codeObservation(replyAt(results, 9));
  const metadata = {
    name: wordObservation(replyAt(results, 0), decodeString),
    symbol: wordObservation(replyAt(results, 1), decodeString),
    decimals: wordObservation(replyAt(results, 2), decodeUint),
  };
  const controls = {
    paused: wordObservation(replyAt(results, 3), decodeBool),
    oraclePaused: wordObservation(replyAt(results, 4), decodeBool),
    owner: wordObservation(replyAt(results, 5), decodeAddress),
  };
  const implementation = slotObservation(replyAt(results, 6));
  const admin = slotObservation(replyAt(results, 7));
  const beacon = slotObservation(replyAt(results, 8));
  return {
    ...token,
    blockNumber: blockNumber.status === 'ok' ? blockNumber.value : null,
    blockTimestamp: blockDetails.status === 'ok' ? blockDetails.value : null,
    chainId,
    bytecode: code,
    metadata,
    controls,
    eip1967: {
      implementation: { slot: slots.implementation, ...implementation },
      admin: { slot: slots.admin, ...admin },
      beacon: { slot: slots.beacon, ...beacon },
    },
    errors: [],
  };
});

const beaconAddresses = [...new Set(observations
  .map((item) => item.eip1967.beacon.address.status === 'ok' ? item.eip1967.beacon.address.value : null)
  .filter((address) => address && address !== ZERO))];
const beaconImplementationReplies = beaconAddresses.length
  ? await rpc.send(beaconAddresses.map((address) => callRequest(address, selectors.beaconImplementation, blockTag)))
  : new Map();
const beaconResolution = new Map(beaconAddresses.map((address, index) => [address, wordObservation(replyAt(beaconImplementationReplies, index), decodeAddress)]));

const codeTargets = new Set();
for (const item of observations) {
  for (const address of [
    item.eip1967.implementation.address.status === 'ok' ? item.eip1967.implementation.address.value : null,
    item.eip1967.beacon.address.status === 'ok' ? item.eip1967.beacon.address.value : null,
    item.eip1967.beacon.address.status === 'ok' ? beaconResolution.get(item.eip1967.beacon.address.value)?.status === 'ok'
      ? beaconResolution.get(item.eip1967.beacon.address.value).value : null : null,
  ]) {
    if (address && address !== ZERO) codeTargets.add(address);
  }
}
const codeTargetList = [...codeTargets];
const targetCodeReplies = codeTargetList.length
  ? await rpc.send(codeTargetList.map((address) => codeRequest(address, blockTag)))
  : new Map();
const targetCode = new Map(codeTargetList.map((address, index) => [address, codeObservation(replyAt(targetCodeReplies, index))]));

const codeForAddress = (addressObservation) => {
  if (addressObservation.status === 'unknown') return unknown(addressObservation.error);
  if (addressObservation.status === 'absent') return absent({ codeHash: null, byteLength: 0 });
  return targetCode.get(addressObservation.value) || unknown('Code lookup was not returned for resolved address.');
};

for (const item of observations) {
  const implementation = item.eip1967.implementation;
  implementation.resolvedCode = codeForAddress(implementation.address);
  const beacon = item.eip1967.beacon;
  beacon.resolvedImplementation = beacon.address.status === 'ok'
    ? (beaconResolution.get(beacon.address.value) || unknown('Beacon implementation() was not returned.'))
    : beacon.address.status === 'absent'
      ? absent({ value: ZERO })
      : unknown(beacon.address.error);
  beacon.resolvedCode = codeForAddress(beacon.resolvedImplementation);
  const fields = [
    item.chainId,
    item.bytecode,
    ...Object.values(item.metadata),
    ...Object.values(item.controls),
    item.eip1967.implementation.slot,
    item.eip1967.implementation.address,
    item.eip1967.implementation.resolvedCode,
    item.eip1967.admin.slot,
    item.eip1967.admin.address,
    item.eip1967.beacon.slot,
    item.eip1967.beacon.address,
    item.eip1967.beacon.resolvedImplementation,
    item.eip1967.beacon.resolvedCode,
  ];
  for (const field of fields) if (field.status === 'unknown' && field.error) item.errors.push(field.error);
  item.errors = [...new Set(item.errors)];
}

const statusCount = (items, getStatus) => items.reduce((counts, item) => {
  const status = getStatus(item);
  counts[status] = (counts[status] || 0) + 1;
  return counts;
}, {});
const summary = {
  tokensParsed: tokens.length,
  tokensAudited: observations.length,
  bytecode: statusCount(observations, (item) => item.bytecode.status),
  metadataComplete: observations.filter((item) => Object.values(item.metadata).every((field) => field.status === 'ok')).length,
  controls: {
    paused: statusCount(observations, (item) => item.controls.paused.status),
    oraclePaused: statusCount(observations, (item) => item.controls.oraclePaused.status),
    owner: statusCount(observations, (item) => item.controls.owner.status),
  },
  eip1967: {
    implementationSlots: statusCount(observations, (item) => item.eip1967.implementation.slot.status),
    adminSlots: statusCount(observations, (item) => item.eip1967.admin.slot.status),
    beaconSlots: statusCount(observations, (item) => item.eip1967.beacon.slot.status),
    resolvedImplementationCode: statusCount(observations, (item) => item.eip1967.implementation.resolvedCode.status),
    resolvedBeaconImplementationCode: statusCount(observations, (item) => item.eip1967.beacon.resolvedCode.status),
  },
  tokensWithErrors: observations.filter((item) => item.errors.length > 0).length,
};

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    file: path.relative(ROOT, SOURCE_FILE),
    parser: 'Rows matching the app registry pattern: | Name • Robinhood Token | SYMBOL | ... `0x...`',
    canonicalTokenCount: tokens.length,
  },
  policy: {
    readOnly: true,
    transactionsSent: 0,
    concurrency: CONCURRENCY,
    minBatchStartIntervalMs: MIN_BATCH_START_INTERVAL_MS,
    rpcBatching: true,
    unknownOrRevertedIsNotAbsent: true,
  },
  network: {
    rpcUrl: RPC_URL,
    expectedChainId: EXPECTED_CHAIN_ID,
    chainId,
    blockNumber,
    blockTag,
    blockTimestamp: blockDetails,
  },
  selectors,
  eip1967Slots: slots,
  summary,
  tokens: observations,
  errors: [
    ...[chainId, blockNumber, blockDetails].filter((field) => field.status === 'unknown').map((field) => field.error),
  ],
};

const markdown = `# Robinhood Token Control Audit

Generated: ${report.generatedAt}

## Method

- Source: \`${report.source.file}\`; ${tokens.length} canonical token rows were parsed using the same row shape as the app registry.
- Read-only JSON-RPC calls only; no transaction, signing, state-changing method, or wallet call was used. The report records \`transactionsSent: 0\`.
- RPC endpoint: \`${RPC_URL}\`. Requests used JSON-RPC batches, at most ${CONCURRENCY} token workers, and a ${MIN_BATCH_START_INTERVAL_MS} ms minimum interval between batch starts to reduce 429 risk.
- Calls were pinned to block \`${blockTag}\` where the block number was available. The report records the block number and timestamp (or an explicit unknown error).
- Each token was checked for chain ID context, deployed bytecode and keccak code hash, name/symbol/decimals, \`paused()\`, \`oraclePaused()\`, \`owner()\`, and EIP-1967 implementation/admin/beacon storage slots.
- Nonzero implementation and beacon addresses were resolved with \`eth_getCode\`; beacon addresses were also queried for \`implementation()\` and the resolved implementation was code-checked. RPC errors, reverts, malformed responses, and empty ABI call results remain \`status: "unknown"\`; only an explicit zero code/slot result is \`absent\`.

## Result

- Tokens parsed/audited: **${summary.tokensParsed}/${summary.tokensAudited}**
- Token bytecode: **${summary.bytecode.ok || 0} present**, **${summary.bytecode.absent || 0} absent**, **${summary.bytecode.unknown || 0} unknown**
- Complete metadata reads: **${summary.metadataComplete}/${summary.tokensAudited}**
- \`paused()\`: **${summary.controls.paused.ok || 0} ok**, ${summary.controls.paused.unknown || 0} unknown
- \`oraclePaused()\`: **${summary.controls.oraclePaused.ok || 0} ok**, ${summary.controls.oraclePaused.unknown || 0} unknown
- \`owner()\`: **${summary.controls.owner.ok || 0} ok**, ${summary.controls.owner.unknown || 0} unknown
- EIP-1967 slots: implementation **${summary.eip1967.implementationSlots.absent || 0} zero/${summary.eip1967.implementationSlots.ok || 0} nonzero**, admin **${summary.eip1967.adminSlots.absent || 0} zero/${summary.eip1967.adminSlots.ok || 0} nonzero**, beacon **${summary.eip1967.beaconSlots.absent || 0} zero/${summary.eip1967.beaconSlots.ok || 0} nonzero**; unknown slot reads remain unknown.
- Tokens with one or more recorded unknown/errors: **${summary.tokensWithErrors}**

The machine-readable per-token observations, code hashes, resolved-address checks, block/timestamp, and exact errors are in [rwa-control-audit.json](./rwa-control-audit.json).
`;

await fs.mkdir(path.dirname(JSON_FILE), { recursive: true });
await fs.writeFile(JSON_FILE, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(MARKDOWN_FILE, markdown);
console.log(JSON.stringify({
  json: path.relative(ROOT, JSON_FILE),
  markdown: path.relative(ROOT, MARKDOWN_FILE),
  tokens: summary.tokensAudited,
  bytecode: summary.bytecode,
  metadataComplete: summary.metadataComplete,
  paused: summary.controls.paused,
  oraclePaused: summary.controls.oraclePaused,
  owner: summary.controls.owner,
  errors: summary.tokensWithErrors,
}, null, 2));