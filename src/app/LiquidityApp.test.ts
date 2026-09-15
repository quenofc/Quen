// @ts-expect-error Bun provides this module at test runtime without requiring Node test typings.
import { afterEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import apyResponseFixture from './__fixtures__/morpho-vault-apy.json';
import stateResponseFixture from './__fixtures__/morpho-vault-state.json';
import LiquidityApp, { parseMorphoEnvelope, validateVaultPayload, VAULT_UNAVAILABLE_NOTICE } from './LiquidityApp';

const NOW = 1_800_000_000;
const VAULT = '0xBeEff033F34C046626B8D0A041844C5d1A5409dd';
let renderedRoot: Root | null = null;
let testWindow: Window | null = null;

afterEach(async () => {
  if (renderedRoot) {
    await act(async () => renderedRoot?.unmount());
    renderedRoot = null;
  }
  testWindow?.close();
  testWindow = null;
});

const validState = () => ({
  chain_id: 4663,
  address: VAULT,
  total_assets: '100000000',
  withdrawable_assets: '40000000',
  share_price_ray: '1020000000000000000000000000',
  last_indexed_block: '123456',
  last_accrual_timestamp: NOW - 30,
});

const validApy = () => ({
  chain_id: 4663,
  vault_address: VAULT,
  apy: '0.0525',
  last_indexed_block: '123450',
});

describe('Morpho vault payload validation', () => {
  it('parses the checked-in complete Morpho response fixtures', () => {
    const state = parseMorphoEnvelope(stateResponseFixture);
    const apy = parseMorphoEnvelope(apyResponseFixture);

    expect(state).not.toBeNull();
    expect(apy).not.toBeNull();
    expect(validateVaultPayload(state!, apy!, NOW)).toEqual({
      totalAssets: 100,
      withdrawableAssets: 40,
      sharePrice: 1.02,
      apy: 0.0525,
      indexedBlock: '123456',
      updatedAt: NOW - 30,
    });
  });

  it.each([
    ['missing data', {}],
    ['renamed data', { result: stateResponseFixture.data }],
    ['null data', { data: null }],
    ['array data', { data: [stateResponseFixture.data] }],
  ])('rejects a response envelope with %s', (_name, response) => {
    expect(parseMorphoEnvelope(response)).toBeNull();
  });

  it('accepts a fresh, internally consistent response', () => {
    expect(validateVaultPayload(validState(), validApy(), NOW)).toEqual({
      totalAssets: 100,
      withdrawableAssets: 40,
      sharePrice: 1.02,
      apy: 0.0525,
      indexedBlock: '123456',
      updatedAt: NOW - 30,
    });
  });

  it.each([
    ['wrong state chain', { state: { chain_id: 1 } }],
    ['wrong APY chain', { apy: { chain_id: 1 } }],
    ['wrong vault address', { state: { address: '0x0000000000000000000000000000000000000000' } }],
    ['wrong APY vault address', { apy: { vault_address: '0x0000000000000000000000000000000000000000' } }],
    ['stale timestamp', { state: { last_accrual_timestamp: NOW - 600 } }],
    ['future timestamp', { state: { last_accrual_timestamp: NOW + 1 } }],
    ['inconsistent blocks', { apy: { last_indexed_block: '123405' } }],
    ['malformed block', { state: { last_indexed_block: 'not-a-block' } }],
    ['negative assets', { state: { total_assets: '-1' } }],
    ['invalid withdrawable assets', { state: { withdrawable_assets: 'NaN' } }],
    ['negative APY', { apy: { apy: '-0.01' } }],
    ['invalid share price', { state: { share_price_ray: 'Infinity' } }],
    ['zero share price', { state: { share_price_ray: '0' } }],
    ['impossible liquidity', { state: { withdrawable_assets: '100000001' } }],
  ])('rejects %s', (_name, overrides) => {
    expect(validateVaultPayload(
      { ...validState(), ...overrides.state },
      { ...validApy(), ...overrides.apy },
      NOW,
    )).toBeNull();
  });

  it.each([
    ['APY', { apy: { apy: null } }],
    ['total assets', { state: { total_assets: '' } }],
    ['withdrawable assets', { state: { withdrawable_assets: false } }],
    ['share price', { state: { share_price_ray: [] } }],
    ['state block', { state: { last_indexed_block: null }, apy: { last_indexed_block: null } }],
    ['timestamp', { state: { last_accrual_timestamp: '   ' } }],
    ['chain identity', { state: { chain_id: [4663] } }],
  ])('rejects zero-coercible malformed %s values', (_name, overrides) => {
    expect(validateVaultPayload(
      { ...validState(), ...overrides.state },
      { ...validApy(), ...overrides.apy },
      NOW,
    )).toBeNull();
  });
});

describe('fail-closed presentation', () => {
  it('clears rendered fixture metrics after a successful response has a malformed envelope', async () => {
    testWindow = new Window({ url: 'https://quen.test/app' });
    const intervals: Array<() => void> = [];
    let stateRequests = 0;
    const originalDateNow = Date.now;
    const originalFetch = globalThis.fetch;

    Object.assign(globalThis, {
      window: testWindow,
      document: testWindow.document,
      navigator: testWindow.navigator,
      sessionStorage: testWindow.sessionStorage,
      HTMLElement: testWindow.HTMLElement,
      Node: testWindow.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    Date.now = () => NOW * 1000;
    testWindow.setInterval = ((callback: TimerHandler) => {
      intervals.push(callback as () => void);
      return intervals.length;
    }) as unknown as typeof testWindow.setInterval;
    testWindow.clearInterval = (() => undefined) as typeof testWindow.clearInterval;
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes('/state')) {
        stateRequests += 1;
        return Response.json(stateRequests === 1 ? stateResponseFixture : { result: stateResponseFixture.data });
      }
      if (url.includes('/apy-averages')) return Response.json(apyResponseFixture);

      const body = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = body.method === 'eth_chainId' ? '0x1237' : '0x1e240';
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    }) as typeof fetch;

    try {
      const container = testWindow.document.createElement('div');
      testWindow.document.body.append(container);
      renderedRoot = createRoot(container);

      await act(async () => renderedRoot?.render(createElement(LiquidityApp)));
      await act(async () => await Promise.resolve());

      expect(container.textContent).toContain('$100 USDG');
      expect(container.textContent).toContain('5.25%');

      await act(async () => {
        intervals.forEach((callback) => callback());
        await Promise.resolve();
      });

      expect(container.textContent).not.toContain(VAULT_UNAVAILABLE_NOTICE);
      expect(container.textContent).not.toContain('$100 USDG');
      expect(container.textContent).not.toContain('5.25%');
      expect(container.textContent).toContain('No cached value');
    } finally {
      Date.now = originalDateNow;
      globalThis.fetch = originalFetch;
    }
  });

  it('uses no stale state after validation fails without rendering the unavailable notice', () => {
    const previouslyLive = validateVaultPayload(validState(), validApy(), NOW);
    expect(previouslyLive).not.toBeNull();

    const current = validateVaultPayload(
      { ...validState(), total_assets: 'malformed' },
      validApy(),
      NOW,
    );

    expect(current).toBeNull();
    expect(VAULT_UNAVAILABLE_NOTICE).toContain('No cached APY or TVL is shown');
  });

});