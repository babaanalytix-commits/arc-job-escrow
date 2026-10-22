/**
 * wagmi configuration — Arc Mainnet only, injected wallet only.
 * No WalletConnect, no Reown, no ENS.
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected } from '@wagmi/core'

/** Arc Mainnet — USDC is the native gas token (18 dec gas view, 6 dec ERC-20 view). */
export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://explorer.arc.io' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

// registerChain posts chain metadata to the Studio parent frame for trace labels.
// Only run inside the Studio iframe — dynamic import guards the side-effect.
if (window.self !== window.top) {
  void import('./tracing').then(({ registerChain }) => {
    registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])
  })
}

export const config = createConfig({
  chains: [arcMainnet],
  connectors: [injected()],
  transports: {
    [arcMainnet.id]: http('https://rpc.mainnet.arc.io'),
  },
})
