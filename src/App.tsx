import { useState } from 'react'
import { useAccount } from 'wagmi'
import { Plus, Bot } from 'lucide-react'
import { NetworkBanner } from '@/components/NetworkBanner'
import { WalletButton } from '@/components/WalletButton'
import { CreateJobSheet } from '@/components/CreateJobSheet'
import { JobList } from '@/components/JobList'
import { useAllJobs, ARC_CHAIN_ID } from '@/hooks/useJobEscrow'
import { TokenUSDC } from '@web3icons/react'
import { JOB_ESCROW_MAINNET_ADDRESS } from '@/contracts/jobEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'

const ESCROW_EXPLORER = buildAddressExplorerUrl(ARC_CHAIN_ID, JOB_ESCROW_MAINNET_ADDRESS)
const ESCROW_SHORT = JOB_ESCROW_MAINNET_ADDRESS.slice(0, 6) + '…' + JOB_ESCROW_MAINNET_ADDRESS.slice(-4)

export default function App() {
  const { isConnected } = useAccount()
  const [sheetOpen, setSheetOpen] = useState(false)
  const { jobs, loading, error, refresh } = useAllJobs(ARC_CHAIN_ID)

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div
              className="flex size-8 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent)' }}
            >
              <Bot className="size-4 text-white" />
            </div>
            <div>
              <p className="display text-sm leading-tight" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                Agent Job Escrow
              </p>
              <p className="text-xs leading-tight" style={{ color: 'var(--subtle)' }}>
                Arc
              </p>
            </div>
          </div>
          <WalletButton />
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-5">
        <NetworkBanner />

        {/* Hero card */}
        <section className="glass-card rounded-3xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="mb-2 flex items-center gap-1.5">
                <TokenUSDC variant="branded" size={18} />
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                  USDC Escrow
                </span>
              </div>
              <h1 className="display text-2xl leading-tight" style={{ color: 'var(--ink)', fontWeight: 700, letterSpacing: '-0.03em' }}>
                Pay AI agents<br />for completed jobs
              </h1>
              <p className="mt-2 max-w-64 text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>
                USDC is held until you approve the result. Funds return if the deadline passes with no submission.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs" style={{ color: 'var(--subtle)' }}>
            <div className="rounded-xl p-2.5" style={{ background: 'var(--surface-muted)' }}>
              <p className="font-semibold" style={{ color: 'var(--ink)' }}>Create</p>
              <p>Fund escrow</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: 'var(--surface-muted)' }}>
              <p className="font-semibold" style={{ color: 'var(--ink)' }}>Submit</p>
              <p>Agent delivers</p>
            </div>
            <div className="rounded-xl p-2.5" style={{ background: 'var(--surface-muted)' }}>
              <p className="font-semibold" style={{ color: 'var(--ink)' }}>Approve</p>
              <p>Funds released</p>
            </div>
          </div>

          {isConnected && (
            <button
              onClick={() => setSheetOpen(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--accent)' }}
            >
              <Plus className="size-4" />
              Create Job
            </button>
          )}

          {!isConnected && (
            <div
              className="mt-4 flex items-center justify-center rounded-2xl py-3.5 text-sm"
              style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}
            >
              Connect your wallet to create jobs
            </div>
          )}
        </section>

        {/* Contract info — address derived from config, never hardcoded */}
        <div className="rounded-2xl px-4 py-3 text-xs" style={{ background: 'var(--surface-muted)' }}>
          <p style={{ color: 'var(--muted)' }}>
            Contract:{' '}
            <a
              href={ESCROW_EXPLORER}
              target="_blank"
              rel="noreferrer"
              className="mono underline"
              style={{ color: 'var(--accent-hover)' }}
            >
              {ESCROW_SHORT}
            </a>
            {' · '}
            Arc
          </p>
        </div>

        {/* Job list */}
        <JobList jobs={jobs} loading={loading} error={error} onRefresh={refresh} />
      </main>

      <CreateJobSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={() => {
          setSheetOpen(false)
          setTimeout(refresh, 2000)
        }}
      />
    </div>
  )
}
