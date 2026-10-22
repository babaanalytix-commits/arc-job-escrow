import { useAccount } from 'wagmi'
import { ARC_CHAIN_ID } from '@/hooks/useJobEscrow'
import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

/** Prompt the wallet to add / switch to Arc Mainnet via wallet_addEthereumChain.
 *  Falls back gracefully if the wallet does not support the method. */
async function switchToArc(): Promise<void> {
  const provider = (window as Window & { ethereum?: { request: (r: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum
  if (!provider) return
  try {
    // Try switch first — works if the wallet already knows the chain.
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x13b2' }], // 5042 in hex
    })
  } catch (switchErr) {
    // 4902 = chain not added; add it.
    if ((switchErr as { code?: number }).code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0x13b2',
          chainName: 'Arc',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: ['https://rpc.mainnet.arc.io'],
          blockExplorerUrls: ['https://explorer.arc.io'],
        }],
      })
    }
    // Other errors (user rejection, etc.) are silently ignored.
  }
}

export function NetworkBanner() {
  const { chainId, isConnected } = useAccount()
  const [pending, setPending] = useState(false)

  if (!isConnected || chainId === ARC_CHAIN_ID) return null

  function handleSwitch() {
    setPending(true)
    void switchToArc().finally(() => setPending(false))
  }

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium"
      style={{ background: 'rgba(186, 43, 76, 0.08)', border: '1px solid rgba(186, 43, 76, 0.25)', color: 'var(--danger)' }}
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span>Switch to Arc to use this app.</span>
      <button
        onClick={handleSwitch}
        disabled={pending}
        className="ml-auto rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
        style={{ background: 'var(--danger)' }}
      >
        {pending ? 'Switching…' : 'Switch'}
      </button>
    </div>
  )
}
