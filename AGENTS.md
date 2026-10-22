# Agent Job Escrow

> Built with Arc Studio — money-powered apps in minutes

USDC escrow for paying ERC-8004-registered AI agents for completed jobs on Arc.

---

## What This App Does

Clients create escrow jobs (funding USDC, specifying an ERC-8004 agent and a deadline). The agent's current NFT owner submits a result hash. The client approves to release funds immediately. If the client does not approve within 72 hours of submission, anyone can call `release` to pay the agent. The client can only recover funds if no result was submitted and the deadline has passed.

## Contract Deployments

| Version | Chain | Address | Explorer |
|---|---|---|---|
| v2 (current) | Arc (5042) | 0x9795C1E25d27976Ef5A888bc05ff224eCf9034da | https://explorer.arc.io/address/0x9795C1E25d27976Ef5A888bc05ff224eCf9034da |
| v2 (testnet) | Arc Testnet (5042002) | 0x5e43e923fe88709f37f4ea3143922181e38b8584 | https://explorer.testnet.arc.io/address/0x5e43e923fe88709f37f4ea3143922181e38b8584 |
| v1 (superseded) | Arc Testnet (5042002) | 0xbcc39efc316dc03666be1ada7428a9bc5c12f073 | https://explorer.testnet.arc.io/address/0xbcc39efc316dc03666be1ada7428a9bc5c12f073 |

## Constructor Args

### Mainnet (active)
- USDC: `0x3600000000000000000000000000000000000000`
- IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`

### Testnet
- USDC: `0x3600000000000000000000000000000000000000`
- IdentityRegistry: `0x8004A818BFB912233c491871b3d84c89A494BD9e`

## Mainnet Deploy Block
- JobEscrow v2: block 27337887 (Arc mainnet)

## Demo Agents (Testnet IdentityRegistry)

| Agent ID | Owner |
|---|---|
| 0 | 0xb7ACAC0ffe24A867f86D2DE5e03e98c839A41553 |
| 1 | 0xb7ACAC0ffe24A867f86D2DE5e03e98c839A41553 |

## Key Contract Functions (v2)
- `createJob(agentId, amountUSDC, deadline, specHash)` — client funds job
- `submitResult(jobId, resultHash)` — current agent-NFT owner only, before deadline
- `updatePayee(jobId, newPayee)` — current agent-NFT owner only, while Submitted (recovery path for blocklisted payee)
- `approve(jobId)` — client approves and pays agent immediately
- `release(jobId)` — anyone, once 72h have elapsed since submission (REVIEW_WINDOW)
- `refund(jobId)` — client only, if no result submitted AND deadline passed

## Settlement Rules
- After a result is submitted, the client CANNOT recover funds.
- The agent is guaranteed payment: either approve (client) or release (anyone, after 72h).
- `cancelSubmission` was removed in v2 — it created an exploit path.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, Arc Light design
- Web3: wagmi v2 + viem v2 with an injected (browser-extension) connector only; no ConnectKit and no WalletConnect
- Contracts: Solidity 0.8.20+ (compiled with 0.8.28), Foundry
- Tests: 77 Foundry tests in `contracts/test/JobEscrow.t.sol` (all pass)
- Chain: Arc (Chain ID: 5042)
- Token: USDC ERC-20 6 decimals

## Job List

Jobs are read by calling `getJob(1)`, `getJob(2)`, … through Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) in batches of 20, stopping at the first empty slot (client = 0x0). Not event-sourced — no `eth_getLogs` calls.

## Key Files

- `src/App.tsx` — Main app shell
- `src/components/CreateJobSheet.tsx` — USDC approve + createJob bottom sheet
- `src/components/JobCard.tsx` — Per-job card (submit, approve, release, updatePayee, refund)
- `src/components/JobList.tsx` — Job list (Multicall3-backed, not event-sourced)
- `src/components/NetworkBanner.tsx` — Wrong-network guard (wallet_addEthereumChain for Arc)
- `src/hooks/useJobEscrow.ts` — Multicall3 batch reads of getJob(1..n)
- `src/contracts/jobEscrow.ts` — Contract addresses / ABI config
- `contracts/JobEscrow.sol` — Solidity source (v2)
- `contracts/test/JobEscrow.t.sol` — Foundry unit + invariant tests (77 tests)
