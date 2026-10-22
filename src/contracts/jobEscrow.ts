/**
 * JobEscrow contract addresses, ABI, and related constants.
 *
 * Active deployment: Arc Mainnet (chainId 5042).
 * Testnet address kept as a documented constant for reference only.
 */
import artifact from '../../contracts/out/JobEscrow.sol/JobEscrow.json'

export const JOB_ESCROW_ABI = artifact.abi

/**
 * Arc Mainnet v2 (current) — deployed at block 27337887.
 * Constructor args: USDC 0x3600000000000000000000000000000000000000,
 *                   IdentityRegistry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 */
export const JOB_ESCROW_MAINNET_ADDRESS = '0x9795C1E25d27976Ef5A888bc05ff224eCf9034da' as const
export const JOB_ESCROW_MAINNET_DEPLOY_BLOCK = 27337887n

/** Arc Testnet v2 — kept for reference; app uses mainnet. */
export const JOB_ESCROW_TESTNET_ADDRESS = '0x5e43e923fe88709f37f4ea3143922181e38b8584' as const

export const IDENTITY_REGISTRY_MAINNET = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const
export const IDENTITY_REGISTRY_TESTNET = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const

export const REVIEW_WINDOW_SECONDS = 72n * 3600n // 72 hours

export type JobStatus = 'Open' | 'Submitted' | 'Approved' | 'Refunded' | 'Released'

export const JOB_STATUS_LABELS: JobStatus[] = ['Open', 'Submitted', 'Approved', 'Refunded', 'Released']

export function getJobEscrowAddress(chainId: number): `0x${string}` {
  if (chainId === 5042) return JOB_ESCROW_MAINNET_ADDRESS
  if (chainId === 5042002) return JOB_ESCROW_TESTNET_ADDRESS
  throw new Error(`JobEscrow is not configured for chain ${chainId}`)
}
