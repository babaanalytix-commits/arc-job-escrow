/**
 * Minimal wallet connect/disconnect button.
 * Uses wagmi hooks only — no ConnectKit, no WalletConnect, no Reown.
 */
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from '@wagmi/core'
import { Wallet, LogOut, AlertCircle } from 'lucide-react'

function shortenAddress(addr: string): string {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, isPending, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()

  // Detect whether an injected provider is available
  const hasInjected = typeof window !== 'undefined' && Boolean((window as Window & { ethereum?: unknown }).ethereum)

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="mono rounded-xl px-3 py-1.5 text-xs font-semibold"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
        >
          {shortenAddress(address)}
        </span>
        <button
          onClick={() => disconnect()}
          title="Disconnect"
          className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-colors hover:opacity-75"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
        >
          <LogOut className="size-3.5" />
          <span className="hidden sm:inline">Disconnect</span>
        </button>
      </div>
    )
  }

  if (!hasInjected) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs"
        style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
        title="No browser wallet detected — install MetaMask or a compatible extension"
      >
        <AlertCircle className="size-3.5 shrink-0" />
        <span>No wallet found</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() => connect({ connector: injected() })}
        disabled={isPending}
        className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        <Wallet className="size-3.5" />
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {connectError && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {connectError.message.split('\n')[0]}
        </span>
      )}
    </div>
  )
}
