# Agent Job Escrow — mainnet signing sequence (Thursday 22 Oct)

Rehearsed end to end on an `arc-anvil` fork of Arc mainnet (18 Oct, fork head 26,603,426): all five
steps succeeded and the expected states below are the measured ones. Yomi signs every transaction
in his browser wallet (`--browser`): no key leaves the wallet, no agent broadcasts.

Constants: chain 5042 · USDC `0x3600000000000000000000000000000000000000` (ERC-20, 6 dp) ·
ERC-8004 IdentityRegistry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` · builder (deployer, agent 135
owner) `0xcCf8f9e4c7Ce491f379a3Fe26718b036AC752De8` · client `0x1F418E40c558188FF911D24CEAEE0Fc86F83AD3A`
· job: agent 135, 1.5 USDC (`1500000`), deadline `1793361600` (2026-10-30 12:00 UTC),
specHash `0xdbb92f517ea052ad744bf2ea46f7f49f6940e9c9334a4fa190b691849305eb57` = keccak256 of the exact
bytes of `ops/job1_spec.md`.

**The predicted escrow address `0x9795C1E25d27976Ef5A888bc05ff224eCf9034da` holds only if the builder
wallet's nonce is still 12 when Step 1 is signed.** Any other transaction from that wallet first moves
it; then re-read the address from Step 1's output and regenerate the fallback file.

Steps 2–5 are done in the live app (`babacapital.app/arc/job-escrow/`) — the round requires the USDC
to move "through your contract and app". The commands below are the fallback for the same calls.
Set `R=https://rpc.mainnet.arc.io` and `E=<escrow address from Step 1>`.

| # | Signer | Action | Expected state after (check before the next step) |
|---|---|---|---|
| 1 | builder | Deploy | Code at E (4,841 bytes, masked runtime sha256 `6b0a12e1…dac5` = FREEZE_v2.json); `usdc()` = USDC; `identityRegistry()` = registry above; `REVIEW_WINDOW()` = 259200; builder nonce 12 → 13; builder USDC −~0.024 (gas). |
| 2 | client | USDC `approve(E, 1500000)` (nonce 0) | `allowance(client, E)` = 1500000; client nonce 0 → 1; client USDC −~0.0012 (gas). |
| 3 | client | `createJob(135, 1500000, 1793361600, specHash)` (nonce 1) | One `JobCreated(1, client, 135, 1500000, 1793361600, specHash)`; `getJob(1)`: status 0 (Open), payee 0x0; E holds 1500000; client nonce 1 → 2; client USDC −1.5 −~0.0044. |
| 4 | builder | `submitResult(1, resultHash)` | `ResultSubmitted(1, 135, builder, resultHash)`; `getJob(1)`: status 1 (Submitted), resultHash set, payee = builder, submittedAt = block time; builder −~0.0023 (gas). resultHash = keccak256 of the exact bytes of the published `report.json`. |
| 5 | client | `approve(1)` | `JobApproved(1, builder, 1500000)`; `getJob(1)` status 2 (Approved); E holds 0; builder +1.5 USDC; client −~0.0014 (gas). |

Commands (signing opens a local page; approve in the browser wallet; `--constructor-args` must be LAST):

```bash
# 1 — builder wallet, from ~/Projects/arc-job-escrow
arc-forge create contracts/JobEscrow.sol:JobEscrow --rpc-url $R --browser --broadcast --constructor-args 0x3600000000000000000000000000000000000000 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
# 2 — client wallet
arc-cast send 0x3600000000000000000000000000000000000000 "approve(address,uint256)" $E 1500000 --rpc-url $R --browser
# 3 — client wallet
arc-cast send $E "createJob(uint256,uint256,uint64,bytes32)" 135 1500000 1793361600 0xdbb92f517ea052ad744bf2ea46f7f49f6940e9c9334a4fa190b691849305eb57 --rpc-url $R --browser
# 4 — builder wallet (resultHash computed from the published report.json)
arc-cast send $E "submitResult(uint256,bytes32)" 1 $(arc-cast keccak 0x$(xxd -p report.json | tr -d '\n')) --rpc-url $R --browser
# 5 — client wallet
arc-cast send $E "approve(uint256)" 1 --rpc-url $R --browser
```

Before Step 4 (read-only, ~1 min with the log cache in `ops/.logscan/`):

```bash
python3 ops/job1_report.py --out ops/job1_out
```

It must end with `all completeness and cross-RPC checks pass` and exit 0 (exit 3 = a check failed: do not
submit). It prints the `report.json` keccak256 — that is the resultHash, identical to the `$(arc-cast keccak …)`
in Step 4. Publish `ops/job1_out/report.json` + `report.md` unchanged before signing Step 4. The Base leg can be
re-derived later with `--base-block`; Robinhood's public RPC keeps state only ~10 minutes, so that leg is
checkable on it only right after the run.

Reads to check (no signing):

```bash
arc-cast code $E --rpc-url $R | wc -c
arc-cast call $E "getJob(uint256)((address,uint256,uint256,uint64,bytes32,uint8,bytes32,address,uint64))" 1 --rpc-url $R
arc-cast call 0x3600000000000000000000000000000000000000 "balanceOf(address)(uint256)" $E --rpc-url $R
arc-cast call 0x3600000000000000000000000000000000000000 "allowance(address,address)(uint256)" 0x1F418E40c558188FF911D24CEAEE0Fc86F83AD3A $E --rpc-url $R
```

Unsigned fallback for Steps 2–3 (client, nonces 0 and 1): `ops/fallback_unsigned_client_txs.json`,
replayed on a fresh fork: both succeeded (gas 55,438 and 205,060).
