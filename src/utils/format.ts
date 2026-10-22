import { keccak256, toBytes } from 'viem'
import { buildTxExplorerUrl } from '@/onchain-facts'

export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatUSDC(raw: bigint): string {
  const n = Number(raw) / 1_000_000
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(n)
}

export function hashText(text: string): `0x${string}` {
  return keccak256(toBytes(text))
}

export function deadlineFromDate(dt: string): bigint {
  return BigInt(Math.floor(new Date(dt).getTime() / 1000))
}

export function deadlineToDisplay(deadline: bigint): string {
  const d = new Date(Number(deadline) * 1000)
  return d.toLocaleString()
}

export function txUrl(chainId: number, hash: string): string {
  return buildTxExplorerUrl(chainId, hash)
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as Error)?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('zeroa')) return 'Amount must be greater than zero.'
  if (msg.includes('deadlinepast')) return 'Deadline must be in the future.'
  if (msg.includes('unknownagent')) return 'Agent ID not found in the registry.'
  if (msg.includes('transferfailed')) return 'USDC transfer failed. Check your balance and allowance.'
  if (msg.includes('notopen')) return 'Job is not in Open status.'
  if (msg.includes('deadlineexpired')) return 'The job deadline has passed.'
  if (msg.includes('notagentowner')) return 'You are not the current owner of this agent.'
  if (msg.includes('zeroresulthash')) return 'Result hash cannot be empty.'
  if (msg.includes('notclient')) return 'Only the job client can perform this action.'
  if (msg.includes('notsubmitted')) return 'Job is not in Submitted status.'
  if (msg.includes('deadlinenotexpired')) return 'The deadline has not yet passed.'
  if (msg.includes('notcancellable')) return 'Job is not in Submitted status.'
  if (msg.includes('jobnotfound')) return 'Job not found.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
    return 'Insufficient balance.'
  }
  if (msg.includes('reverted')) return 'Transaction reverted. Check the inputs and try again.'
  return 'Something went wrong. Please try again.'
}
