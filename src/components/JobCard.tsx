import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ExternalLink, Loader2, CheckCircle, RotateCcw, Send, Unlock, Edit2 } from 'lucide-react'
import { JOB_ESCROW_ABI, JOB_ESCROW_MAINNET_ADDRESS, REVIEW_WINDOW_SECONDS } from '@/contracts/jobEscrow'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatAddress, formatUSDC, deadlineToDisplay, hashText, parseOnchainError } from '@/utils/format'
import { ARC_CHAIN_ID } from '@/hooks/useJobEscrow'
import type { Job } from '@/hooks/useJobEscrow'

interface Props {
  job: Job
  agentOwner: string | undefined
  onRefresh: () => void
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  Open:      { bg: 'rgba(26,92,138,0.1)',   color: 'var(--status-open)',      label: 'Open' },
  Submitted: { bg: 'rgba(122,77,0,0.1)',    color: 'var(--status-submitted)', label: 'Submitted' },
  Approved:  { bg: 'rgba(26,128,71,0.1)',   color: 'var(--status-approved)',  label: 'Approved' },
  Refunded:  { bg: 'rgba(107,101,128,0.1)', color: 'var(--status-refunded)',  label: 'Refunded' },
  Released:  { bg: 'rgba(26,128,71,0.08)', color: 'var(--success)',          label: 'Released' },
}

export function JobCard({ job, agentOwner, onRefresh }: Props) {
  const { address } = useAccount()
  const [resultText, setResultText] = useState('')
  const [newPayeeText, setNewPayeeText] = useState('')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [action, setAction] = useState<'submit' | 'approve' | 'refund' | 'release' | 'updatePayee' | null>(null)

  const { writeContractAsync } = useWriteContract()
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash })

  const isClient = address?.toLowerCase() === job.client.toLowerCase()
  const isAgentOwner = agentOwner != null && address?.toLowerCase() === agentOwner.toLowerCase()

  // Deadline & review-window state — computed once at mount to avoid impure-render lint
  const [nowSec] = useState(() => BigInt(Math.floor(Date.now() / 1000)))
  const deadlinePassed = nowSec > job.deadline
  const releaseTime = job.submittedAt > 0n ? job.submittedAt + REVIEW_WINDOW_SECONDS : null
  const releaseReady = releaseTime !== null && nowSec >= releaseTime

  /** Seconds remaining until release is allowed (0 if already ready). */
  const releaseSecondsLeft = releaseTime !== null && !releaseReady
    ? Number(releaseTime - nowSec)
    : 0

  function formatCountdown(secs: number): string {
    if (secs <= 0) return ''
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  const statusStyle = STATUS_STYLES[job.status] ?? STATUS_STYLES.Open

  async function runAction(
    fn: 'submitResult' | 'approve' | 'refund' | 'release' | 'updatePayee',
    args: unknown[],
  ) {
    setError('')
    try {
      const hash = await writeContractAsync({
        address: JOB_ESCROW_MAINNET_ADDRESS,
        abi: JOB_ESCROW_ABI,
        functionName: fn,
        args: args,
        chainId: ARC_CHAIN_ID,
      })
      setTxHash(hash)
      setTimeout(onRefresh, 3000)
    } catch (err) {
      setError(parseOnchainError(err))
    } finally {
      setAction(null)
    }
  }

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="display text-base tabular-nums" style={{ color: 'var(--ink)', fontWeight: 700 }}>
              Job #{job.jobId.toString()}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: statusStyle.bg, color: statusStyle.color }}
            >
              {statusStyle.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
            Agent ID: <span className="mono tabular-nums">{job.agentId.toString()}</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="display text-lg tabular-nums" style={{ color: 'var(--ink)', fontWeight: 700 }}>
            {formatUSDC(job.amount)}
          </p>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>USDC</p>
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1.5 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)' }}>
        <MetaRow label="Client" value={formatAddress(job.client)} mono />
        <MetaRow
          label="Deadline"
          value={`${deadlineToDisplay(job.deadline)}${deadlinePassed ? ' (passed)' : ''}`}
        />
        <MetaRow label="Spec hash" value={job.specHash.slice(0, 18) + '…'} mono />
        {(job.status === 'Submitted' || job.status === 'Approved' || job.status === 'Released') && (
          <>
            <MetaRow label="Payee" value={formatAddress(job.payee)} mono />
            <MetaRow label="Result hash" value={job.resultHash.slice(0, 18) + '…'} mono />
          </>
        )}
        {job.status === 'Submitted' && releaseTime !== null && (
          <MetaRow
            label={releaseReady ? 'Release window' : 'Release available in'}
            value={releaseReady ? 'Now' : formatCountdown(releaseSecondsLeft)}
          />
        )}
      </div>

      {/* Job explorer link — tx if we have it (session job), contract page otherwise */}
      <a
        href={job.createTxHash ? buildTxExplorerUrl(ARC_CHAIN_ID, job.createTxHash) : job.explorerLink}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: 'var(--accent-hover)' }}
      >
        {job.createTxHash ? 'View creation tx' : 'View contract'} <ExternalLink className="size-3" />
      </a>

      {/* Actions */}
      <div className="space-y-2.5 pt-1">

        {/* Submit result — agent owner, Open, before deadline */}
        {isAgentOwner && job.status === 'Open' && !deadlinePassed && (
          <div className="space-y-2">
            <textarea
              placeholder="Describe your result (will be hashed)…"
              value={resultText}
              onChange={(e) => setResultText(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl px-3 py-2 text-xs outline-none glass-inner"
              style={{ color: 'var(--ink)' }}
            />
            {resultText.trim() && (
              <p className="mono text-xs truncate" style={{ color: 'var(--subtle)' }}>
                keccak256: {hashText(resultText).slice(0, 22)}…
              </p>
            )}
            <ActionButton
              label="Submit Result"
              icon={<Send className="size-3.5" />}
              disabled={!resultText.trim() || confirming || action === 'submit'}
              loading={action === 'submit' || confirming}
              color="var(--status-open)"
              onClick={() => {
                setAction('submit')
                void runAction('submitResult', [job.jobId, hashText(resultText)])
              }}
            />
          </div>
        )}

        {/* Update payout address — agent owner, Submitted */}
        {isAgentOwner && job.status === 'Submitted' && (
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
              Update payout address
            </label>
            <input
              placeholder="0x… new payee address"
              value={newPayeeText}
              onChange={(e) => setNewPayeeText(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-xs outline-none glass-inner mono"
              style={{ color: 'var(--ink)' }}
            />
            <ActionButton
              label="Update Payout Address"
              icon={<Edit2 className="size-3.5" />}
              disabled={!newPayeeText.startsWith('0x') || newPayeeText.length !== 42 || confirming || action === 'updatePayee'}
              loading={action === 'updatePayee' || confirming}
              color="var(--status-submitted)"
              variant="ghost"
              onClick={() => {
                setAction('updatePayee')
                void runAction('updatePayee', [job.jobId, newPayeeText])
              }}
            />
            <p className="text-xs" style={{ color: 'var(--subtle)' }}>
              If your current payee address can't receive USDC, enter a new one here.
            </p>
          </div>
        )}

        {/* Approve — client, Submitted */}
        {isClient && job.status === 'Submitted' && (
          <ActionButton
            label="Approve & Pay Agent"
            icon={<CheckCircle className="size-3.5" />}
            disabled={confirming || action === 'approve'}
            loading={action === 'approve' || confirming}
            color="var(--success)"
            onClick={() => {
              setAction('approve')
              void runAction('approve', [job.jobId])
            }}
          />
        )}

        {/* Release payment — anyone, Submitted, review window elapsed */}
        {job.status === 'Submitted' && (
          <ActionButton
            label={
              releaseReady
                ? 'Release Payment'
                : `Release Payment (available in ${formatCountdown(releaseSecondsLeft)})`
            }
            icon={<Unlock className="size-3.5" />}
            disabled={!releaseReady || confirming || action === 'release'}
            loading={action === 'release' || confirming}
            color="var(--accent)"
            variant="ghost"
            onClick={() => {
              setAction('release')
              void runAction('release', [job.jobId])
            }}
          />
        )}

        {/* Refund — client, Open, deadline passed */}
        {isClient && job.status === 'Open' && deadlinePassed && (
          <ActionButton
            label="Refund (no result submitted)"
            icon={<RotateCcw className="size-3.5" />}
            disabled={confirming || action === 'refund'}
            loading={action === 'refund' || confirming}
            color="var(--subtle)"
            variant="ghost"
            onClick={() => {
              setAction('refund')
              void runAction('refund', [job.jobId])
            }}
          />
        )}

        {error && (
          <p className="rounded-xl px-3 py-2 text-xs font-medium" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        {txHash && (
          <a
            href={buildTxExplorerUrl(ARC_CHAIN_ID, txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: 'var(--accent-hover)' }}
          >
            {confirming ? (
              <><Loader2 className="size-3 animate-spin" /> Confirming…</>
            ) : (
              <>Transaction confirmed <ExternalLink className="size-3" /></>
            )}
          </a>
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span className={mono ? 'mono' : ''} style={{ color: 'var(--ink-2)' }}>{value}</span>
    </div>
  )
}

interface ActionButtonProps {
  label: string
  icon: React.ReactNode
  disabled: boolean
  loading: boolean
  color: string
  variant?: 'solid' | 'ghost'
  onClick: () => void
}

function ActionButton({ label, icon, disabled, loading, color, variant = 'solid', onClick }: ActionButtonProps) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      style={
        variant === 'solid'
          ? { background: color, color: 'white' }
          : { background: 'transparent', border: `1px solid ${color}`, color }
      }
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {label}
    </button>
  )
}
