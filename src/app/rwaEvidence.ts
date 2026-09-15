import type { Address } from 'viem';

export const RWA_REGISTRY_URL = 'https://docs.robinhood.com/chain/contracts';
export const RWA_DISCLOSURE_URL = 'https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/';
export const MAX_ORACLE_AGE_SECONDS = 86_400;
export const MAX_ROUND_TRIP_LOSS_BPS = 200;

/**
 * These are the only tokenized-equity feeds whose pair and standard
 * AggregatorV3 interface are pinned by the official Chainlink catalog used
 * by this application. Do not infer feeds for other registry assets.
 */
export const PROVEN_CHAINLINK_FEEDS: Readonly<Record<string, Address>> = {
  AAPL: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0',
  AMD: '0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72',
  AMZN: '0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C',
  ASML: '0xB4106147E8cce40b7d46124090d373A71b70f87D',
  BABA: '0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984',
  CLSK: '0x810c12D3a554Bc47fd39597Fe3b3AAC4941F50eF',
  COIN: '0xA3a468A452940B7D6b69991207B508c609a98Ef2',
  CRCL: '0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a',
};

export const EIP1967_SLOTS = {
  implementation: '0x360894A13BA1A3210667C828492DB98DCA3E2076CC3735A920A3CA505D382BBC',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6104',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d51',
} as const;

export const TOKENISED_EQUITY_LEGAL_WORDING =
  'tokenised debt security issued by Robinhood Assets (Jersey) Limited; economic exposure; no legal or beneficial rights against underlying issuer.';