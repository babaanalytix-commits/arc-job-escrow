# Agent Job Escrow

USDC escrow for paying AI agents registered in the ERC-8004 Identity Registry, on Arc. Built in
[Arc Studio](https://studio.arc.io) and deployed on Arc mainnet.

- **Live app:** https://babacapital.app/arc/job-escrow/
- **Contract (Arc mainnet, chain 5042):** [`0x9795C1E25d27976Ef5A888bc05ff224eCf9034da`](https://explorer.arc.io/address/0x9795C1E25d27976Ef5A888bc05ff224eCf9034da)
- **First job on mainnet:** see [Job 1](#job-1-on-mainnet) below

## How it works

A client locks USDC for a specific agent (an ERC-8004 agent id) with a deadline and a hash of the job spec. The
current owner of that agent's NFT delivers by submitting a hash of the result. Money moves in one of three ways:

| Path | Who can call | When | Where the USDC goes |
|---|---|---|---|
| `approve(jobId)` | the client | after a result is submitted | the agent's payee |
| `release(jobId)` | anyone | 72 hours after submission, if the client has not approved | the agent's payee |
| `refund(jobId)` | the client | after the deadline, only if nothing was submitted | back to the client |

Once a result is submitted, the client can no longer take the money back: either they approve, or anyone can
release it after the 72-hour review window. Before submission, the client can only recover funds after the
deadline passes.

Other functions:
- `createJob(agentId, amount, deadline, specHash)` checks that the agent id exists in the registry (`ownerOf`
  must not revert or return the zero address), then pulls the USDC from the client.
- `submitResult(jobId, resultHash)` is accepted only from the agent NFT's **current** owner, before the deadline,
  with a non-zero hash. The caller becomes the payee.
- `updatePayee(jobId, newPayee)`: while a job is submitted, the current agent owner can change the payout
  address. This is the recovery path if the original payee cannot receive USDC (for example, a blocklisted
  address).

The contract has no owner, no admin functions, no fee, and is not upgradeable. Its constructor takes only the
USDC and Identity Registry addresses, both stored as immutables.

### What changed from v1
Studio's first version had a `cancelSubmission` function. With it, a client could cancel a delivered result,
wait for the deadline and refund, so the agent would deliver and never be paid. v2 removes the function and
adds `release` (the 72-hour window) and `updatePayee`. `ExploitPreventionTest` in the suite checks that the path
is closed: no refund after submission (before or after the deadline), `cancelSubmission` does not exist, and
`release` pays the agent after 72 hours. The suite has 76 unit tests and 1 invariant (escrow balance equals the
sum of open and submitted jobs).

## Deployments

| Version | Network | Address | Notes |
|---|---|---|---|
| v2 | Arc mainnet (5042) | `0x9795C1E25d27976Ef5A888bc05ff224eCf9034da` | deploy tx [`0xee9348b1…3864`](https://explorer.arc.io/tx/0xee9348b159691ba8a0d2fb23991956637562d9195ccef95387f30320baff3864), block 27,337,887 |
| v2 | Arc testnet (5042002) | `0x5e43e923fe88709f37f4ea3143922181e38b8584` | built and deployed from Studio |
| v1 | Arc testnet (5042002) | `0xbcc39efc316dc03666be1ada7428a9bc5c12f073` | superseded (see above) |

Constructor arguments on mainnet: USDC `0x3600000000000000000000000000000000000000`, Identity Registry
`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`.

The mainnet bytecode matches the frozen build in [`FREEZE_v2.json`](FREEZE_v2.json): creation bytecode sha256
`3806138c…6dfb`, and runtime sha256 `6b0a12e1…dac5` with immutables and metadata masked. The reads and hashes
are recorded in [`ops/MAINNET_DEPLOY_RECORD.json`](ops/MAINNET_DEPLOY_RECORD.json).

## Job 1 on mainnet

The first job is real work, done by our own agent for our own wallet; both sides belong to BABA Capital.

- **Client:** `0x1F418E40c558188FF911D24CEAEE0Fc86F83AD3A`, Yomi's own wallet.
- **Agent:** ERC-8004 agent id **135** (BABA Capital's agent), owned by `0xcCf8f9e4c7Ce491f379a3Fe26718b036AC752De8`.
- **Job:** 1.5 USDC for an LP health report on the Safe `0x87DFf32Ca31066DA9BC210B55585a521355D580F` on Base and
  Robinhood Chain. Spec: [`ops/job1_spec.md`](ops/job1_spec.md).
- **specHash on chain:** `0xb40f01b872fd873a553861cfb9fafe13e9124a6f57e71390902e021bd1948f28`. This is
  keccak256 of the 32-byte value `0xdbb92f517ea052ad744bf2ea46f7f49f6940e9c9334a4fa190b691849305eb57`, which is
  itself keccak256 of the spec file's exact bytes. The spec is hashed twice because the app hashes whatever is typed
  into its spec field, and the file's hash was typed there. `ops/job1_report.py` checks exactly this derivation and
  fails on anything else.
- **Deadline:** `1793358000` = 2026-10-30 11:00 UTC. We intended 12:00 UTC, but the app's date field reads local
  time (CET), so 12:00 was entered as 11:00 UTC.
- **Deliverable:** [`report.json`](https://babacapital.app/arc/job-escrow/job1/report.json) and
  [`report.md`](https://babacapital.app/arc/job-escrow/job1/report.md). Copies are in this repo under
  `ops/job1_out/`. resultHash `0xeef3fb17a588441c3d31a984b1098dbe335e55513e608d92d0e36ef5d4fb4d5d` = keccak256 of `report.json`'s exact bytes.
  The report is produced by [`ops/job1_report.py`](ops/job1_report.py) at one pinned block per chain. Positions
  are read through PoolLens (`0xADebbd5825B033bCD4B84FB019AbFC673406d902`). PoolLens v1 cannot read Aerodrome's
  Slipstream V3 position manager, so the Safe's two staked V3 positions are read directly (`positions()`, the
  pool's `slot0()`), with principal computed by [`ops/clmath.py`](ops/clmath.py). That math is checked against
  PoolLens to the wei on every position PoolLens can read (`ops/test_clmath.py`). The report marks these
  positions and states that their uncollected fees were not read.

| Step | Transaction |
|---|---|
| USDC approve (client) | [`0xfa95c23b…7cae`](https://explorer.arc.io/tx/0xfa95c23b11c914b1bf0cbd33a4dcc5999e86745d51be1cba37acf68fc4637cae), block 27,408,615 |
| `createJob` (client, through the app) | [`0x4db11e45…cd66`](https://explorer.arc.io/tx/0x4db11e45967a55cc5d729eb54029253d92e91a9ff0b50b36d457499b017fcd66), block 27,408,632 |
| `submitResult` (agent owner, command line; see below) | [`0x235f5254…1b96`](https://explorer.arc.io/tx/0x235f52543dcbf10d3d329e32e22a120687b2a701e988158678655f06889c1b96), block 27,412,021 |
| `approve` (client, through the app): 1.5 USDC paid to the agent | [`0xea4f8d8c…f857b`](https://explorer.arc.io/tx/0xea4f8d8c2bbd4b2f72eea19d0d84983e700ffe855844d0a989410c5a3f9f857b), block 27,412,275 |

`submitResult` was sent with `arc-cast send … --browser` rather than the app, because the app's result box hashes
whatever is typed (the same behaviour as the spec field). Sending the report hash through the box would have stored
keccak256 of the hash. Now `getJob(1)` reads status 2 (Approved), resultHash
`0xeef3fb17a588441c3d31a984b1098dbe335e55513e608d92d0e36ef5d4fb4d5d`, payee
`0xcCf8f9e4c7Ce491f379a3Fe26718b036AC752De8`, and the escrow's USDC balance is 0.

## Built with Arc Studio

The contract, its 77 tests and the app were written in Arc Studio (session `baba-job-escrow`). Studio deployed
v1 and v2 to Arc testnet. The mainnet deploy used Arc Foundry (`arc-forge create --browser`), signed in the
owner's browser wallet. The prompts for the app hardening and mainnet turns are in
[`ops/studio-prompts/`](ops/studio-prompts/).

We checked each Studio turn outside Studio. That found three problems, all fixed before mainnet:
1. The v1 `cancelSubmission` path described above.
2. The first version of the job list used a hand-encoded function selector for `getJob` that did not exist on the
   contract, so the list was always empty. It now uses viem's `multicall` with the contract ABI, and a failed read
   shows an error instead of an empty list.
3. One turn added a Foundry remapping that changed the contract's creation bytecode (solc includes remappings in
   its metadata). It was reverted before deploy, and the deployed bytecode matches the frozen build.

## The app

Known UX issues, for the next Studio turn:
- The spec field hashes its contents, and its label does not say so. Pasting a file hash there produces keccak256
  of the hash, as happened in job 1. Planned fix: label the field, or accept a file and hash its bytes directly.
- The deadline field takes local time and does not show a time zone. Planned fix: show the time zone, or take UTC.
- The job card's result box hashes its input in the same way. Planned fix: the same as the spec field.

React + Vite + wagmi/viem. It connects to browser-extension wallets only (no WalletConnect) and talks to one RPC,
`https://rpc.mainnet.arc.io`, over HTTPS. Jobs are listed by reading `getJob(1..n)` through Multicall3, not by
scanning logs, because the public Arc RPC rejects log queries of 10,000 blocks or more.

## Run it yourself

Contracts (Foundry; Arc's fork `arc-forge` was used for the deploy, but stock `forge` also runs the tests):

```bash
git clone --recurse-submodules https://github.com/babaanalytix-commits/arc-job-escrow
cd arc-job-escrow
forge test        # 77 tests
```

Check that a local build matches the frozen bytecode: compare the sha256 of `bytecode.object` in
`contracts/out/JobEscrow.sol/JobEscrow.json` with `creation_bytecode_sha256` in `FREEZE_v2.json`
(solc 0.8.28, optimizer 200 runs, EVM paris, the `foundry.toml` and `remappings.txt` in this repo).

App:

```bash
forge build       # the app imports the ABI from contracts/out/
bun install
bunx vite build --base /arc/job-escrow/
```

Job 1 report (read-only):

```bash
python3 ops/job1_report.py --out out_dir --base-block <B> --rh-block <R>
```

With the same block numbers as the published report, this writes `report.json` byte for byte. The Base leg can be
re-read from any node with state at that block. The Robinhood Chain public RPC keeps state for about 10 minutes,
so that leg needs an archive node for chain 4663 after that.

## What this does not cover

- The contract has not had an external audit.
- The registry check only confirms that an agent id exists. It says nothing about who the agent is or the quality
  of its work.
- Whoever owns the agent NFT when `submitResult` is called receives the payment. Transferring the NFT moves that
  right.
- USDC on Arc has a blocklist. If the payee is blocklisted, `approve` and `release` revert until the agent owner
  calls `updatePayee`.

## License

The contract source is MIT (SPDX header in `contracts/JobEscrow.sol`).
