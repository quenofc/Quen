import { getAddress, isAddress, parseUnits } from 'viem';

export const SETTLEMENT_CHAIN_ID = 4663;
export const SETTLEMENT_TOKEN = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;

export type SettlementValidation = { ok: true; recipient: `0x${string}`; units: bigint } | { ok: false; message: string };

export function validateSettlement(recipientInput: string, amountInput: string, account: string | null, balance: bigint, decimals = 6): SettlementValidation {
  const recipient = recipientInput.trim();
  if (!isAddress(recipient)) return { ok: false, message: 'Enter a valid recipient address.' };
  let checksummed: `0x${string}`;
  try { checksummed = getAddress(recipient); } catch { return { ok: false, message: 'Address checksum is invalid.' }; }
  if (checksummed.toLowerCase() === account?.toLowerCase()) return { ok: false, message: 'Self transfers are not allowed.' };
  if (!amountInput.trim()) return { ok: false, message: 'Enter a USDG amount.' };
  let units: bigint;
  try { units = parseUnits(amountInput.trim(), decimals); } catch { return { ok: false, message: 'Enter a valid USDG amount.' }; }
  if (units <= 0n) return { ok: false, message: 'Amount must be greater than zero.' };
  if (units > balance) return { ok: false, message: 'Amount exceeds your USDG balance.' };
  return { ok: true, recipient: checksummed, units };
}

export function makePaymentRequestUri(recipient: string, units: bigint, chainId = SETTLEMENT_CHAIN_ID, token = SETTLEMENT_TOKEN) {
  return `ethereum:${token}@${chainId}/transfer?address=${encodeURIComponent(getAddress(recipient))}&uint256=${units.toString()}`;
}

export function makePaymentRequestUriFromAmount(recipient: string, amount: string, decimals = 6) {
  const units = parseUnits(amount.trim(), decimals);
  if (units <= 0n) throw new Error('Amount must be greater than zero.');
  return makePaymentRequestUri(recipient, units);
}