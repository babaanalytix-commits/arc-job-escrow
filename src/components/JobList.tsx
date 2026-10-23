import { useReadContract } from 'wagmi'
import { RefreshCw, Loader2, Inbox, AlertTriangle, WifiOff } from 'lucide-react'
import { JobCard } from './JobCard'
import type { Job } from '@/hooks/useJobEscrow'
import { ARC_CHAIN_ID } from '@/hooks/useJobEscrow'
import { IDENTITY_REGISTRY_MAINNET } from '@/contracts/jobEscrow'

const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

interface Props {
  jobs: Job[]
  loading: boolean
  error: string | null
  /** Soft error: set to the time string (HH:MM:SS) when a refresh fails but a prior list is available. */
  softError: string | null
  onRefresh: () => void
}

export function JobList({ jobs, loading, error, softError, onRefresh }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="display text-base font-700" style={{ color: 'var(--ink)', fontWeight: 700 }}>
          All Jobs
        </h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:scale-[1.01] disabled:opacity-40"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </button>
      </div>

      {/* Hard error state — shown only when no list has ever loaded */}
      {error && !loading && (
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3 text-sm"
          style={{ background: 'rgba(186,43,76,0.07)', border: '1px solid rgba(186,43,76,0.2)', color: 'var(--danger)' }}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Could not load jobs from the chain.</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>Check your connection and try again.</p>
          </div>
          <button
            onClick={onRefresh}
            className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
            style={{ background: 'var(--danger)' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Soft error notice — shown above a stale list when a refresh fails.
          Hidden while an auto-retry is in flight (loading=true and jobs are present). */}
      {softError && !(loading && jobs.length > 0) && !error && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
          style={{ background: 'rgba(186,43,76,0.05)', border: '1px solid rgba(186,43,76,0.15)', color: 'var(--muted)' }}
        >
          <WifiOff className="size-3.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <span className="flex-1">
            Could not refresh from the chain. Showing the list loaded at {softError}.
          </span>
          <button
            onClick={onRefresh}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
          >
            Retry
          </button>
        </div>
      )}

      {loading && jobs.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--subtle)' }}>
          <Loader2 className="size-4 animate-spin" />
          Loading jobs…
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-sm" style={{ color: 'var(--subtle)' }}>
          <Inbox className="size-8 opacity-40" />
          <span>No jobs yet. Create the first one.</span>
        </div>
      )}

      {jobs.map((job) => (
        <JobCardWithAgent key={job.jobId.toString()} job={job} onRefresh={onRefresh} />
      ))}
    </div>
  )
}

function JobCardWithAgent({ job, onRefresh }: { job: Job; onRefresh: () => void }) {
  const { data: agentOwner } = useReadContract({
    address: IDENTITY_REGISTRY_MAINNET,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'ownerOf',
    args: [job.agentId],
    chainId: ARC_CHAIN_ID,
  })

  return <JobCard job={job} agentOwner={agentOwner} onRefresh={onRefresh} />
}
