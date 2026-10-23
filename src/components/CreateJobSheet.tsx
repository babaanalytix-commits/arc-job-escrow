import { useRef, useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc20Abi } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink, Loader2, ChevronRight, Paperclip, AlertTriangle } from 'lucide-react'
import { JOB_ESCROW_ABI, JOB_ESCROW_MAINNET_ADDRESS } from '@/contracts/jobEscrow'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { hashText, hashBytes, deadlineFromDate, parseOnchainError } from '@/utils/format'
import { parseUsdc } from '@/onchain-money'
import { ARC_CHAIN_ID } from '@/hooks/useJobEscrow'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

type Step = 'form' | 'approving' | 'creating' | 'done'

/** Returns the UTC offset string e.g. "UTC+05:30" or "UTC-07:00". */
function getUtcOffsetLabel(): string {
  const off = -new Date().getTimezoneOffset() // minutes, positive = ahead of UTC
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  const h = String(Math.floor(abs / 60)).padStart(2, '0')
  const m = String(abs % 60).padStart(2, '0')
  return `UTC${sign}${h}:${m}`
}

/** Returns UTC datetime string and unix timestamp for a datetime-local value, or nulls. */
function deadlineDetails(dt: string): { utc: string; unix: bigint } | null {
  if (!dt) return null
  const d = new Date(dt)
  if (isNaN(d.getTime())) return null
  return {
    utc: d.toUTCString(),
    unix: BigInt(Math.floor(d.getTime() / 1000)),
  }
}

/** True when the string looks like 0x followed by exactly 64 hex chars (a bytes32 hash). */
function looksLikeHash(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s.trim())
}

export function CreateJobSheet({ open, onClose, onCreated }: Props) {
  const { address, chainId } = useAccount()
  const usdcAddress = getUsdc(ARC_CHAIN_ID)!.address as `0x${string}`

  const [agentId, setAgentId] = useState('')
  const [amount, setAmount] = useState('')
  const [deadline, setDeadline] = useState('')
  const [specText, setSpecText] = useState('')
  const [fileHash, setFileHash] = useState<`0x${string}` | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('form')
  const [errorMsg, setErrorMsg] = useState('')
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>()
  const [createTxHash, setCreateTxHash] = useState<`0x${string}` | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // specHash: prefer file hash when a file is loaded, else hash the text
  const specHash: `0x${string}` | undefined = fileHash
    ? fileHash
    : specText.trim()
      ? hashText(specText)
      : undefined

  const { writeContractAsync: approveUsdc } = useWriteContract()
  const { writeContractAsync: createJob } = useWriteContract()

  const { isLoading: _isApproveConfirming } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isLoading: _isCreateConfirming } = useWaitForTransactionReceipt({ hash: createTxHash })

  const wrongChain = chainId !== ARC_CHAIN_ID
  const canSubmit =
    !wrongChain &&
    address &&
    agentId.trim() !== '' &&
    amount.trim() !== '' &&
    parseFloat(amount) > 0 &&
    deadline.trim() !== '' &&
    specHash !== undefined

  async function handleSubmit() {
    if (!canSubmit || !specHash) return
    setErrorMsg('')

    try {
      const rawAmount = parseUsdc(amount)
      const deadlineTs = deadlineFromDate(deadline)

      // Step 1: approve USDC
      setStep('approving')
      const appHash = await approveUsdc({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [JOB_ESCROW_MAINNET_ADDRESS, rawAmount],
        chainId: ARC_CHAIN_ID,
      })
      setApproveTxHash(appHash)

      // Brief wait for the approval to land
      let waited = 0
      while (waited < 60) {
        await new Promise((r) => setTimeout(r, 1000))
        waited++
        if (waited >= 3) break
      }

      // Step 2: createJob
      setStep('creating')
      const cHash = await createJob({
        address: JOB_ESCROW_MAINNET_ADDRESS,
        abi: JOB_ESCROW_ABI,
        functionName: 'createJob',
        args: [BigInt(agentId), rawAmount, deadlineTs, specHash],
        chainId: ARC_CHAIN_ID,
      })
      setCreateTxHash(cHash)
      setStep('done')
      onCreated()
    } catch (err) {
      setErrorMsg(parseOnchainError(err))
      setStep('form')
    }
  }

  function handleClose() {
    setStep('form')
    setErrorMsg('')
    setApproveTxHash(undefined)
    setCreateTxHash(undefined)
    setAgentId('')
    setAmount('')
    setDeadline('')
    setSpecText('')
    setFileHash(null)
    setFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setFileHash(null)
      setFileName(null)
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const buf = ev.target?.result
      if (buf instanceof ArrayBuffer) {
        const hash = hashBytes(new Uint8Array(buf))
        setFileHash(hash)
        setFileName(file.name)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function clearFile() {
    setFileHash(null)
    setFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const [minDeadline] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16))
  const utcOffsetLabel = getUtcOffsetLabel()
  const dlDetails = deadlineDetails(deadline)

  const showDoubleHashWarning = !fileHash && looksLikeHash(specText)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-lg overflow-hidden rounded-t-3xl"
            style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(40px) saturate(200%)', WebkitBackdropFilter: 'blur(40px) saturate(200%)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* spectral strip */}
            <div className="h-1" style={{ background: 'linear-gradient(90deg, #1061a6, #36b6d4, #1a8047)' }} />
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: '85vh' }}>
              <div className="px-6 pb-8 pt-3">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="display text-xl font-700" style={{ color: 'var(--ink)', fontWeight: 700 }}>
                    Create Job
                  </h2>
                  <button
                    onClick={handleClose}
                    className="flex size-8 items-center justify-center rounded-full transition-colors"
                    style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                  >
                    <X className="size-4" />
                  </button>
                </div>

                {step === 'done' ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl p-4 glass-inner">
                      <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
                        Job created successfully
                      </p>
                      {createTxHash && (
                        <a
                          href={buildTxExplorerUrl(ARC_CHAIN_ID, createTxHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
                          style={{ color: 'var(--accent-hover)' }}
                        >
                          View on ArcScan <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    <button
                      onClick={handleClose}
                      className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white"
                      style={{ background: 'var(--accent)' }}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Agent ID */}
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        Agent ID
                      </label>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 1"
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                        disabled={step !== 'form'}
                        className="w-full rounded-2xl px-4 py-3 text-sm outline-none transition-all disabled:opacity-50 glass-inner"
                        style={{ color: 'var(--ink)' }}
                      />
                      <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
                        ERC-8004 agent token ID in the identity registry
                      </p>
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        Amount (USDC)
                      </label>
                      <div className="relative glass-inner rounded-2xl">
                        <input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9.]/g, '')
                            if (v === '' || /^\d*\.?\d*$/.test(v)) setAmount(v)
                          }}
                          disabled={step !== 'form'}
                          className="w-full rounded-2xl bg-transparent px-4 py-3 pr-16 text-sm outline-none disabled:opacity-50 tabular-nums"
                          style={{ color: 'var(--ink)' }}
                        />
                        <span
                          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold"
                          style={{ color: 'var(--subtle)' }}
                        >
                          USDC
                        </span>
                      </div>
                    </div>

                    {/* Deadline */}
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        Deadline (your local time, {utcOffsetLabel})
                      </label>
                      <input
                        type="datetime-local"
                        min={minDeadline}
                        value={deadline}
                        onChange={(e) => setDeadline(e.target.value)}
                        disabled={step !== 'form'}
                        className="w-full rounded-2xl px-4 py-3 text-sm outline-none disabled:opacity-50 glass-inner"
                        style={{ color: 'var(--ink)' }}
                      />
                      {dlDetails && (
                        <div className="mt-1 space-y-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
                          <p>UTC: {dlDetails.utc}</p>
                          <p className="mono">Unix: {dlDetails.unix.toString()}</p>
                        </div>
                      )}
                    </div>

                    {/* Spec field */}
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                        Job specification (text). The app stores keccak256 of exactly what you type.
                      </label>
                      <textarea
                        placeholder="Describe what the agent should do…"
                        value={specText}
                        onChange={(e) => setSpecText(e.target.value)}
                        disabled={step !== 'form' || !!fileHash}
                        rows={3}
                        className="w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none disabled:opacity-50 glass-inner"
                        style={{ color: 'var(--ink)' }}
                      />

                      {/* Double-hash warning */}
                      {showDoubleHashWarning && (
                        <div
                          className="mt-1.5 flex items-start gap-2 rounded-xl px-3 py-2 text-xs"
                          style={{ background: 'rgba(180,100,0,0.07)', border: '1px solid rgba(180,100,0,0.2)', color: 'rgba(140,80,0,1)' }}
                        >
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            This looks like a hash. It will be hashed again: the stored specHash will be keccak256 of these 32 bytes. To use a file's hash as the specHash, choose the file instead.
                          </span>
                        </div>
                      )}

                      {/* File hash option */}
                      <div className="mt-2 flex items-center gap-2">
                        <label
                          className="flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors"
                          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                        >
                          <Paperclip className="size-3.5" />
                          Hash a file instead
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="sr-only"
                            disabled={step !== 'form'}
                            onChange={handleFileChange}
                          />
                        </label>
                        {fileHash && fileName && (
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs glass-inner">
                            <Paperclip className="size-3 shrink-0" style={{ color: 'var(--accent)' }} />
                            <span className="min-w-0 truncate font-medium" style={{ color: 'var(--ink)' }}>{fileName}</span>
                            <button
                              onClick={clearFile}
                              className="ml-auto shrink-0 rounded-full p-0.5 hover:bg-black/10"
                              style={{ color: 'var(--muted)' }}
                              type="button"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Always show the exact bytes32 that will be sent */}
                      {specHash ? (
                        <div className="mt-1.5">
                          <p className="text-xs" style={{ color: 'var(--subtle)' }}>specHash to be sent:</p>
                          <p className="mono mt-0.5 break-all text-xs" style={{ color: 'var(--ink)' }}>
                            {specHash}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
                          Type text or choose a file to see the specHash.
                        </p>
                      )}
                    </div>

                    {errorMsg && (
                      <p className="rounded-xl px-3 py-2 text-xs font-medium" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
                        {errorMsg}
                      </p>
                    )}

                    {/* Progress indicator */}
                    {(step === 'approving' || step === 'creating') && (
                      <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background: 'rgba(16,97,166,0.08)', color: 'var(--accent-hover)' }}>
                        <Loader2 className="size-3.5 animate-spin" />
                        {step === 'approving' ? 'Step 1/2 — Approving USDC spend…' : 'Step 2/2 — Creating job…'}
                      </div>
                    )}

                    <button
                      disabled={!canSubmit || step !== 'form'}
                      onClick={() => { void handleSubmit() }}
                      className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 flex items-center justify-center gap-2"
                      style={{ background: 'var(--accent)' }}
                    >
                      {wrongChain ? 'Switch to Arc' : 'Approve USDC + Create Job'}
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}


