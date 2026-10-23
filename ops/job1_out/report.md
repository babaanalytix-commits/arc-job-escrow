# LP health report — Safe 0x87DFf32Ca31066DA9BC210B55585a521355D580F

Job 1 on the Agent Job Escrow (Arc mainnet). Facts and the reads they came from; no recommendations.
Every number below is in report.json with the contract, function and block it was read at.

## The job

Job 1 on the Agent Job Escrow `0x9795C1E25d27976Ef5A888bc05ff224eCf9034da` (Arc mainnet, chain 5042), created in tx `0x4db11e45967a55cc5d729eb54029253d92e91a9ff0b50b36d457499b017fcd66` (block 27408632): client `0x1F418E40c558188FF911D24CEAEE0Fc86F83AD3A`, ERC-8004 agent 135, 1.5 USDC, deadline 1793358000 (2026-10-30 11:00 UTC).

Spec: `ops/job1_spec.md`, keccak256 of its exact bytes = `0xdbb92f517ea052ad744bf2ea46f7f49f6940e9c9334a4fa190b691849305eb57`. The on-chain specHash is `0xb40f01b872fd873a553861cfb9fafe13e9124a6f57e71390902e021bd1948f28` = keccak256 of that 32-byte value. The app hashes the contents of its spec field, and the field held the file's hash, so the spec is hashed twice. job1_report.py checks this derivation exactly and fails on any other value.

## Base (chain 8453) — block 52973234

Block hash `0x46a784cf7ef95388cab55fa12038de2d3cb57eab0660753d2a88c36a7e28777a`, timestamp 1792735815. Reads via `https://base.drpc.org`.
Same PoolLens position reads repeated on `https://mainnet.base.org` at the same block: identical.

Discovery: 10 ERC-721 tokens ever transferred to the Safe between blocks 51545084 and 52973234 (eth_getLogs on `https://base.gateway.tenderly.co`).

- NPM balanceOf(Safe) == positions found held directly: expected 0, read 0 at `0x4857DB576eE0e45F10525eC59527BfD10beeC60b` → pass
- NPM balanceOf(Safe) == positions found held directly: expected 4, read 4 at `0x827922686190790b37229fd06084350E74485b72` → pass
- NPM balanceOf(Safe) == positions found held directly: expected 4, read 4 at `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` → pass
- gauge stakedValues(Safe) == positions found staked there: expected [8623], read [8623] at `0x74a30B3357121a822aDB91A539F4B11b5fb7cb3F` → pass
- gauge stakedValues(Safe) == positions found staked there: expected [8622], read [8622] at `0xAbb3fb6659e05847631896cB87A6D1b8bc0c6D8C` → pass

### Summary (human units; USD is an estimate)

| Position | Pair | In range | Staked | Principal if withdrawn | Uncollected fees | Est. USD principal | Est. USD fees |
|---|---|---|---|---|---|---|---|
| #8622 † | WETH/cbBTC | yes | yes | 0.019885969122337016 WETH + 0.00043128 cbBTC | not read | ≈ $83.04 | n/a |
| #8623 † | USDC/cbBTC | yes | yes | 97.420485 USDC + 0.00220145 cbBTC | not read | ≈ $277.41 | n/a |
| #75616840 | WETH/cbBTC | yes | no | 0.000000000000040478 WETH + 0 cbBTC | 0.000000000000000333 WETH + 0 cbBTC | < $0.01 | < $0.01 |
| #76798832 | WETH/cbBTC | yes | no | 0.000000000000040478 WETH + 0 cbBTC | 0.000000000000000331 WETH + 0 cbBTC | < $0.01 | < $0.01 |
| #76803517 | WETH/cbBTC | yes | no | 0.000000000000056517 WETH + 0 cbBTC | 0.00000000000000033 WETH + 0 cbBTC | < $0.01 | < $0.01 |
| #76808821 | WETH/cbBTC | no | no | 0 WETH + 0 cbBTC | 0 WETH + 0 cbBTC | $0 | $0 |
| #6933532 | USDC/cbBTC | yes | no | 0 USDC + 0 cbBTC | 0 USDC + 0 cbBTC | $0 | $0 |
| #6933533 | WETH/cbBTC | no | no | 0 WETH + 0 cbBTC | 0 WETH + 0 cbBTC | $0 | $0 |
| #7997423 | WETH/cbBTC | no | no | 0 WETH + 0 cbBTC | 0 WETH + 0 cbBTC | $0 | $0 |
| #8410363 | WETH/cbBTC | no | no | 0 WETH + 0 cbBTC | 0 WETH + 0 cbBTC | $0 | $0 |
| **Total** | | | | | | **≈ $360.45** | **< $0.01** (excludes the 2 † positions; fees not read) |

USD figures are estimates for the reader, not reads: each position's amounts are converted at its own pool's price at the pinned block (`sqrt_price_x96` in report.json), then to USD with: USDC ≈ $1.00 (taken as $1); WETH ≈ $2,402.38 (pool `0xeC3c3755…` price at the pinned block); cbBTC ≈ $81,760.76 (pool `0x42609aA1…` price at the pinned block). Not used for anything on chain.

† Read directly, not through PoolLens: PoolLens v1 returns NO_DATA (pool_shape) for this position manager (`0x4857DB57…`, #8622, #8623). Ticks and liquidity come from `positions()`, price and current tick from the pool's `slot0()`, both at the pinned block. Principal is computed from those reads with Uniswap v3 math (`ops/clmath.py`, checked against PoolLens to the wei on every readable position). Uncollected fees were not read for these positions.

### Reads (raw, as in report.json)

| NPM / id | Pool | Fee / spacing | Range | Tick | In range | Liquidity | Uncollected fees (wei) | Staked |
|---|---|---|---|---|---|---|---|---|
| `0x4857DB…` #8622 | WETH/cbBTC `0xeC3c37…` | 85 / 1 | -265664 … -265384 | -265546 | yes | 4247372172355 | not read  /   | yes |
| `0x4857DB…` #8623 | USDC/cbBTC `0x42609a…` | 190 / 50 | -68700 … -66200 | -67068 | yes | 80297516 | not read  /   | yes |
| `0x827922…` #75616840 | WETH/cbBTC `0x70aCDF…` | 2500 / 100 | -265800 … -264100 | -265539 | yes | 1 | 333 WETH / 0 cbBTC | no |
| `0x827922…` #76798832 | WETH/cbBTC `0x70aCDF…` | 2500 / 100 | -265800 … -264100 | -265539 | yes | 1 | 331 WETH / 0 cbBTC | no |
| `0x827922…` #76803517 | WETH/cbBTC `0x70aCDF…` | 2500 / 100 | -265800 … -263500 | -265539 | yes | 1 | 330 WETH / 0 cbBTC | no |
| `0x827922…` #76808821 | WETH/cbBTC `0x70aCDF…` | 2500 / 100 | -265300 … -263600 | -265539 | no | 0 | 0 WETH / 0 cbBTC | no |
| `0xe1f8cd…` #6933532 | USDC/cbBTC `0x160D7E…` | 190 / 50 | -68700 … -66200 | -67067 | yes | 0 | 0 USDC / 0 cbBTC | no |
| `0xe1f8cd…` #6933533 | WETH/cbBTC `0x7C7420…` | 85 / 1 | -265124 … -264322 | -265546 | no | 0 | 0 WETH / 0 cbBTC | no |
| `0xe1f8cd…` #7997423 | WETH/cbBTC `0x7C7420…` | 85 / 1 | -265319 … -265179 | -265546 | no | 0 | 0 WETH / 0 cbBTC | no |
| `0xe1f8cd…` #8410363 | WETH/cbBTC `0x7C7420…` | 85 / 1 | -265444 … -265304 | -265546 | no | 0 | 0 WETH / 0 cbBTC | no |

Staked positions: swap fees on staked liquidity are paid to the gauge, not to the NFT, so the uncollected fees PoolLens reports for them are what `collect` would return. Gauge rewards earned: #8622 not read: earned(address,uint256) reverts on this gauge; #8623 not read: earned(address,uint256) reverts on this gauge.

Held with zero liquidity: #76808821, #6933532, #6933533, #7997423, #8410363.

## Robinhood Chain (chain 4663) — block 95724869

Block hash `0x7d40c660522bd8106b011ac9fe36ded16b35a26b362323f3c5f61c3d43f5ffe9`, timestamp 1792735934. Reads via `https://rpc.mainnet.chain.robinhood.com`.

Discovery: 4 ERC-721 tokens ever transferred to the Safe between blocks 74604384 and 95724869 (eth_getLogs on `https://rpc.mainnet.chain.robinhood.com`).

- NPM balanceOf(Safe) == positions found held directly: expected 4, read 4 at `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` → pass

### Summary (human units; USD is an estimate)

| Position | Pair | In range | Staked | Principal if withdrawn | Uncollected fees | Est. USD principal | Est. USD fees |
|---|---|---|---|---|---|---|---|
| #1328145 | WETH/USDG | no | no | 0 WETH + 0 USDG | 0 WETH + 0 USDG | $0 | $0 |
| #1458323 | WETH/USDG | no | no | 0 WETH + 0 USDG | 0 WETH + 0 USDG | $0 | $0 |
| #1461606 | WETH/USDG | yes | no | 0 WETH + 0 USDG | 0 WETH + 0 USDG | $0 | $0 |
| #1467408 | WETH/USDG | yes | no | 0.06480055368230142 WETH + 21.715541 USDG | 0.000291979405739472 WETH + 0.751966 USDG | ≈ $177.02 | ≈ $1.45 |
| **Total** | | | | | | **≈ $177.02** | **≈ $1.45** |

USD figures are estimates for the reader, not reads: each position's amounts are converted at its own pool's price at the pinned block (`sqrt_price_x96` in report.json), then to USD with: USDG ≈ $1.00 (taken as $1); WETH ≈ $2,396.72 (pool `0xa9188730…` price at the pinned block). Not used for anything on chain.

### Reads (raw, as in report.json)

| NPM / id | Pool | Fee / spacing | Range | Tick | In range | Liquidity | Uncollected fees (wei) | Staked |
|---|---|---|---|---|---|---|---|---|
| `0x73991a…` #1328145 | WETH/USDG `0xa91887…` | 3000 / 60 | -198180 … -196860 | -198502 | no | 0 | 0 WETH / 0 USDG | no |
| `0x73991a…` #1458323 | WETH/USDG `0xa91887…` | 3000 / 60 | -198360 … -197040 | -198502 | no | 0 | 0 WETH / 0 USDG | no |
| `0x73991a…` #1461606 | WETH/USDG `0xa91887…` | 3000 / 60 | -198540 … -197220 | -198502 | yes | 0 | 0 WETH / 0 USDG | no |
| `0x73991a…` #1467408 | WETH/USDG `0xa91887…` | 3000 / 60 | -198660 … -197340 | -198502 | yes | 56226066133165 | 291979405739472 WETH / 751966 USDG | no |

Held with zero liquidity: #1328145, #1458323, #1461606.

## Reproduce

`python3 ops/job1_report.py --base-block 52973234 --rh-block 95724869 --out DIR` rewrites report.json byte for byte while the RPCs still serve state at those blocks. The Base leg re-reads from any node with state at that block. Robinhood's public RPC keeps state for about 10 minutes (measured 2026-10-19: 6,202 blocks, 633 s), so the Robinhood leg can be re-read on it only in that window; after that it needs an archive node for chain 4663.

resultHash = keccak256(exact bytes of report.json).
