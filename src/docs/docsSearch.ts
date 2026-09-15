export type DocsTopic = { id: string; title: string; keywords: string[] };

export const docsTopics: DocsTopic[] = [
  { id: 'overview', title: 'Overview', keywords: ['thesis', 'verified execution', 'markets'] },
  { id: 'quick-start', title: 'Quick start', keywords: ['connect', 'wallet', 'begin'] },
  { id: 'network', title: 'Network setup', keywords: ['chain', 'rpc', 'explorer', 'usdg'] },
  { id: 'product-map', title: 'Product map', keywords: ['gateway', 'settlement', 'liquidity'] },
  { id: 'rwa-gateway', title: 'RWA Gateway', keywords: ['buy', 'sell', 'quote', 'gates', 'trade'] },
  { id: 'settlement', title: 'Settlement Rails', keywords: ['send', 'request', 'payment', 'transfer'] },
  { id: 'liquidity', title: 'Unified Liquidity', keywords: ['route', 'qualified', 'blocked', 'vault'] },
  { id: 'wallet', title: 'Wallet lifecycle', keywords: ['non-custodial', 'sign', 'receipt', 'allowance'] },
  { id: 'data', title: 'Data & price model', keywords: ['chainlink', 'reference', 'twap', 'dex'] },
  { id: 'safety', title: 'Safety model', keywords: ['verification', 'simulation', 'controls'] },
  { id: 'contracts', title: 'Reference addresses', keywords: ['address', 'router', 'factory', 'quoter'] },
  { id: 'troubleshooting', title: 'Troubleshooting', keywords: ['error', 'unavailable', 'blocked'] },
  { id: 'faq', title: 'FAQ', keywords: ['questions', 'answers'] },
  { id: 'risks', title: 'Risk disclosures', keywords: ['risk', 'legal', 'tax', 'ownership'] },
];

export function searchDocs(query: string, topics = docsTopics): DocsTopic[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return topics;
  return topics.filter((topic) =>
    [topic.title, ...topic.keywords].some((value) => value.toLowerCase().includes(normalized)),
  );
}