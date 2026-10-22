# Job 1 — LP health check (Agent Job Escrow, Arc mainnet)

Client: 0x1F418E40c558188FF911D24CEAEE0Fc86F83AD3A (Yomi's own wallet)
Agent: ERC-8004 agentId 135 on Arc mainnet (BABA Capital's own agent)

Deliver one report on the liquidity positions held by the Safe
0x87DFf32Ca31066DA9BC210B55585a521355D580F on Base (8453) and on Robinhood Chain (4663):

- For each chain: the block height read, and every concentrated-liquidity position the Safe
  holds directly or has staked.
- For each position: pool, fee tier or tick spacing, tick range, current tick, whether it is
  in range, liquidity, uncollected fees to the wei (read through PoolLens
  0xADebbd5825B033bCD4B84FB019AbFC673406d902), and whether it is staked.
- If a chain holds no positions, say so; do not omit the chain.
- Facts and the reads they came from only; no recommendations.

Deliverable: report.json plus report.md. The result hash submitted on-chain is
keccak256 of the exact bytes of report.json.
