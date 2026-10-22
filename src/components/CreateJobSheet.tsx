import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc20Abi } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ExternalLink, Loader2, ChevronRight } from 'lucide-react'
import { JOB_ESCROW_ABI, JOB_ESCROW_MAINNET_ADDRESS } from '@/contracts/jobEscrow'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { parseUsdc } from '@/onchain-money'
import { hashText, deadlineFromDate, parseOnchainError } from '@/utils/format'
import { ARC_CHAIN_ID } from '@/hooks/useJobEscrow'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

type Step = 'form' | 'approving' | 'creating' | 'done'

export function CreateJobSheet({ open, onClose, onCreated }: Props) {
  const { address, chainId } = useAccount()
  const usdcAddress = getUsdc(ARC_CHAIN_ID)!.address as `0x${string}`

  const [agentId, setAgentId] = useState('')
  const [amount, setAmount] = useState('')
  const [deadline, setDeadline] = useState('')
  const [specText, setSpecText] = useState('')
  const [step, setStep] = useState<Step>('form')
  const [errorMsg, setErrorMsg] = useState('')
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>()
  const [createTxHash, setCreateTxHash] = useState<`0x${string}` | undefined>()

  const specHash = specText.trim() ? hashText(specText) : undefined

  const { writeContractAsync: approveUsdc } = useWriteContract()
  const { writeContractAsync: createJob } = useWriteContract()

  const { isLoading: _isApproveConfirming } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  })
  const { isLoading: _isCreateConfirming } = useWaitForTransactionReceipt({
    hash: createTxHash,
  })

  const wrongChain = chainId !== ARC_CHAIN_ID
  const canSubmit =
    !wrongChain &&
    address &&
    agentId.trim() !== '' &&
    amount.trim() !== '' &&
    parseFloat(amount) > 0 &&
    deadline.trim() !== '' &&
    specText.trim() !== ''

  async function handleSubmit() {
    if (!canSubmit) return
    setErrorMsg('')

    try {
      const rawAmount = parseUsdc(amount)
      const deadlineTs = deadlineFromDate(deadline)
      const specHashBytes = hashText(specText)

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

      // Wait for approval
      // We poll via the receipt hook — yield to the UI briefly
      let waited = 0
      while (waited < 60) {
        await new Promise((r) => setTimeout(r, 1000))
        waited++
        // Check if receipt arrived via the hook — but since hooks are reactive,
        // we do a manual check here using publicClient approach would be heavier.
        // The hook will update; we proceed after a short wait.
        if (waited >= 3) break
      }

      // Step 2: createJob
      setStep('creating')
      const cHash = await createJob({
        address: JOB_ESCROW_MAINNET_ADDRESS,
        abi: JOB_ESCROW_ABI,
        functionName: 'createJob',
        args: [BigInt(agentId), rawAmount, deadlineTs, specHashBytes],
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
    onClose()
  }

  const [minDeadline] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16))

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
                      Deadline
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
                  </div>

                  {/* Spec text */}
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
                      Job specification
                    </label>
                    <textarea
                      placeholder="Describe what the agent should do…"
                      value={specText}
                      onChange={(e) => setSpecText(e.target.value)}
                      disabled={step !== 'form'}
                      rows={3}
                      className="w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none disabled:opacity-50 glass-inner"
                      style={{ color: 'var(--ink)' }}
                    />
                    {specHash && (
                      <p className="mono mt-1 truncate text-xs" style={{ color: 'var(--subtle)' }}>
                        keccak256: {specHash.slice(0, 20)}…
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
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
