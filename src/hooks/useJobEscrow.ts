/**
 * Hooks for reading JobEscrow state via viem publicClient.multicall.
 * No eth_getLogs — Arc RPC rejects log ranges >= 10 000 blocks.
 * All calldata is encoded from JOB_ESCROW_ABI by viem — no literal function signatures.
 */
import { usePublicClient, useReadContract } from 'wagmi'
import { useCallback, useEffect, useState } from 'react'
import type { Abi } from 'viem'
import { JOB_ESCROW_ABI, JOB_ESCROW_MAINNET_ADDRESS, JOB_STATUS_LABELS, type JobStatus } from '@/contracts/jobEscrow'
import { buildAddressExplorerUrl } from '@/onchain-facts'

export const ARC_CHAIN_ID = 5042
export const ARC_MAINNET_CHAIN_ID = 5042

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const BATCH_SIZE = 20
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

/** Fetches jobs by polling getJob(1), getJob(2), … via publicClient.multicall in batches of 20.
 *  Stops at the first id whose client is the zero address (slot is empty).
 *  Shows a visible error if the RPC call itself fails. */
export function useAllJobs(chainId: number): {
  jobs: Job[]
  loading: boolean
  error: string | null
  refresh: () => void
} {
  const publicClient = usePublicClient({ chainId })
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const escrowExplorerBase = buildAddressExplorerUrl(ARC_CHAIN_ID, JOB_ESCROW_MAINNET_ADDRESS)

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false

    async function load() {
      if (!publicClient) return
      setLoading(true)
      setError(null)

      const collected: Job[] = []
      let batchStart = 1 // job IDs start at 1

      try {
        outer: while (true) {
          const ids = Array.from({ length: BATCH_SIZE }, (_, i) => BigInt(batchStart + i))

          // viem encodes calldata from JOB_ESCROW_ABI — no literal function signatures needed.
          const contracts = ids.map((id) => ({
            address: JOB_ESCROW_MAINNET_ADDRESS as `0x${string}`,
            abi: JOB_ESCROW_ABI as Abi,
            functionName: 'getJob',
            args: [id],
          }))
          const results = await publicClient.multicall({
            contracts,
            allowFailure: true,
            multicallAddress: MULTICALL3_ADDRESS,
          })

          if (cancelled) return

          // getJob never reverts for an unknown id — it returns an empty struct (client = 0x0).
          // A failure result therefore means a real RPC error; throw so the catch sets the error state.
          for (const r of results) {
            if (r.status === 'failure') throw r.error
          }

          let anyFound = false
          for (let i = 0; i < results.length; i++) {
            const r = results[i]
            if (r.status === 'failure') continue // already thrown above; guard for type narrowing

            const job = r.result as JobStruct
            if (!job || job.client === ZERO_ADDRESS) continue

            anyFound = true
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

          if (!anyFound) break outer // no more jobs in this batch
          batchStart += BATCH_SIZE
        }

        if (!cancelled) setJobs(collected.reverse()) // newest first
      } catch (err) {
        console.error('useAllJobs: failed to load jobs from chain', err)
        if (!cancelled) {
          setError('Could not load jobs from the chain.')
          // Keep any previously loaded jobs visible rather than clearing them
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

  return { jobs, loading, error, refresh }
}
