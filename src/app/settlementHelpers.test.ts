// @ts-expect-error Bun provides this module at test runtime without requiring Node test typings.
import { expect, test } from 'bun:test';
import { makePaymentRequestUri, makePaymentRequestUriFromAmount, validateSettlement } from './settlementHelpers';

const account = '0x1111111111111111111111111111111111111111';
test('validates transfer inputs and canonicalizes recipient', () => {
  const result = validateSettlement('0x2222222222222222222222222222222222222222', '12.5', account, 20_000_000n);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.units).toBe(12_500_000n);
});
test('rejects self, zero, and over-balance transfers', () => {
  expect(validateSettlement(account, '1', account, 2_000_000n).ok).toBe(false);
  expect(validateSettlement('0x2222222222222222222222222222222222222222', '0', account, 2_000_000n).ok).toBe(false);
  expect(validateSettlement('0x2222222222222222222222222222222222222222', '3', account, 2_000_000n).ok).toBe(false);
});
test('creates an EIP-681 ERC20 request URI', () => {
  expect(makePaymentRequestUri(account, 1_250_000n)).toContain('ethereum:0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168@4663/transfer?address=');
  expect(makePaymentRequestUri(account, 1_250_000n)).toContain('uint256=1250000');
  expect(makePaymentRequestUriFromAmount(account, '1.000001')).toContain('uint256=1000001');
});