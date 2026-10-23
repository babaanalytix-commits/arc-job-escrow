/**
 * Hooks for reading JobEscrow state via viem publicClient.multicall.
 * No eth_getLogs — Arc RPC rejects log ranges >= 10 000 blocks.
 * All calldata is encoded from JOB_ESCROW_ABI by viem — no literal function signatures.
 */
import { usePublicClient, useReadContract } from 'wagmi'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Abi } from 'viem'
import { JOB_ESCROW_ABI, JOB_ESCROW_MAINNET_ADDRESS, JOB_STATUS_LABELS, type JobStatus } from '@/contracts/jobEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'

export const ARC_CHAIN_ID = 5042
export const ARC_MAINNET_CHAIN_ID = 5042

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const BATCH_SIZE = 20
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Retry delays in ms: 3 attempts total (initial + 2 retries: 0.5 s, 1.5 s). Target: feedback under 10 s.
const RETRY_DELAYS = [500, 1500]

export interface Job {
  jobId: bigint
  client: string
  agentId: bigint
  amount: bigint
  deadline: bigint
  specHash: string
  status: JobStatus
  resultHash: string
  payee: string
  submittedAt: bigint
  /** tx hash for jobs created in this browser session; otherwise undefined */
  createTxHash?: string
  /** explorer link for the job (escrow address page when no session tx hash) */
  explorerLink: string
}

/** Jobs created in this browser session: jobId -> txHash */
const sessionTxHashes = new Map<string, string>()

export function recordSessionJob(jobId: bigint, txHash: string) {
  sessionTxHashes.set(jobId.toString(), txHash)
}

export function useJobContract(chainId: number) {
  const address = JOB_ESCROW_MAINNET_ADDRESS
  return { address, abi: JOB_ESCROW_ABI, chainId }
}

export function useGetJob(jobId: bigint | undefined, chainId: number) {
  const { address, abi } = useJobContract(chainId)
  return useReadContract({
    address,
    abi,
    functionName: 'getJob',
    args: jobId !== undefined ? [jobId] : undefined,
    query: { enabled: jobId !== undefined },
    chainId,
  })
}

/** Struct returned by getJob(uint256) */
interface JobStruct {
  client: string
  agentId: bigint
  amount: bigint
  deadline: bigint
  specHash: `0x${string}`
  status: number
  resultHash: `0x${string}`
  payee: string
  submittedAt: bigint
}

type MulticallContracts = { address: `0x${string}`; abi: Abi; functionName: string; args: [bigint] }[]

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Run a single multicall batch with up to 3 attempts (delays: 0.5 s, 1.5 s).
 * Throws if all attempts fail, propagating the last error.
 */
async function fetchBatchWithRetry(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  contracts: MulticallContracts,
): Promise<Awaited<ReturnType<typeof publicClient.multicall>>> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS[attempt - 1])
    try {
      const results = await publicClient.multicall({
        contracts,
        allowFailure: true,
        multicallAddress: MULTICALL3_ADDRESS,
      })
      // getJob never reverts for an unknown id — it returns an empty struct (client = 0x0).
      // A failure result therefore means a real RPC error; throw to trigger the retry.
      for (const r of results) {
        if (r.status === 'failure') throw r.error
      }
      return results
    } catch (err) {
      lastErr = err
      // Will retry unless this was the last attempt
    }
  }
  throw lastErr
}

/** Fetches jobs by polling getJob(1), getJob(2), … via publicClient.multicall in batches of 20.
 *  Stops as soon as any slot in a batch has client == 0x0 (empty), without fetching further batches.
 *  Retries each batch up to 3 times (delays: 0.5 s, 1.5 s) before giving up.
 *  On a refresh failure, keeps the last good list and sets a soft notice instead of the hard error state.
 *  Shows the hard error state only when no list has ever loaded successfully. */
export function useAllJobs(chainId: number): {
  jobs: Job[]
  loading: boolean
  error: string | null
  softError: string | null
  refresh: () => void
} {
  const publicClient = usePublicClient({ chainId })
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [softError, setSoftError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // Track whether we have ever completed a successful load
  const hasLoadedOnce = useRef(false)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const escrowExplorerBase = buildAddressExplorerUrl(ARC_CHAIN_ID, JOB_ESCROW_MAINNET_ADDRESS)

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false

    async function load() {
      if (!publicClient) return
      setLoading(true)
      setError(null)
      setSoftError(null)

      const collected: Job[] = []
      let batchStart = 1 // job IDs start at 1

      try {
        outer: while (true) {
          const ids = Array.from({ length: BATCH_SIZE }, (_, i) => BigInt(batchStart + i))

          // viem encodes calldata from JOB_ESCROW_ABI — no literal function signatures needed.
          const contracts: MulticallContracts = ids.map((id) => ({
            address: JOB_ESCROW_MAINNET_ADDRESS as `0x${string}`,
            abi: JOB_ESCROW_ABI as Abi,
            functionName: 'getJob',
            args: [id] as [bigint],
          }))

          // 3 total attempts per batch (retries after 1 s and 2 s)
          const results = await fetchBatchWithRetry(publicClient, contracts)

          if (cancelled) return

          // Stop at the first empty slot (client == 0x0): job IDs are sequential from 1,
          // so an empty slot means there are no more jobs beyond this point.
          let foundEmptySlot = false
          for (let i = 0; i < results.length; i++) {
            const r = results[i] as { status: 'success'; result: unknown } | { status: 'failure'; error: Error }
            if (r.status === 'failure') continue // type guard; already thrown in fetchBatchWithRetry

            const job = (r as { status: 'success'; result: unknown }).result as JobStruct
            if (!job || job.client === ZERO_ADDRESS) {
              foundEmptySlot = true
              break // stop scanning this batch; no further batch is needed
            }

            const jobId = ids[i]
            const status: JobStatus = JOB_STATUS_LABELS[job.status] ?? 'Open'
            const txHash = sessionTxHashes.get(jobId.toString())

            collected.push({
              jobId,
              client: job.client,
              agentId: job.agentId,
              amount: job.amount,
              deadline: job.deadline,
              specHash: job.specHash,
              status,
              resultHash: job.resultHash,
              payee: job.payee,
              submittedAt: job.submittedAt,
              createTxHash: txHash,
              explorerLink: escrowExplorerBase,
            })
          }

          if (foundEmptySlot) break outer // an empty slot ends the scan
          batchStart += BATCH_SIZE
        }

        if (!cancelled) {
          hasLoadedOnce.current = true
          setJobs(collected.reverse()) // newest first
        }
      } catch (err) {
        console.error('useAllJobs: failed to load jobs from chain', err)
        if (!cancelled) {
          if (hasLoadedOnce.current) {
            // We have a good list — show a soft non-blocking notice, keep the list visible.
            const now = new Date()
            const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            setSoftError(t)
            // Auto-retry once after 5 s. If it succeeds the notice clears; if it fails it stays.
            setTimeout(() => {
              if (!cancelled) setTick((prev) => prev + 1)
            }, 5000)
          } else {
            // Never loaded before — show the hard error state
            setError('Could not load jobs from the chain.')
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [publicClient, chainId, tick, escrowExplorerBase])

  return { jobs, loading, error, softError, refresh }
}
