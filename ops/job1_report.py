#!/usr/bin/env python3
"""Job 1 deliverable: LP health report for the Safe 0x87DF… on Base (8453) and Robinhood Chain (4663).

Read-only. Nothing is signed or sent. Every fact in report.json names the read it came from
(contract, function, block), and every read on a chain is made at ONE pinned block.

Discovery (no hard-coded position list):
  1. eth_getLogs for ERC-721 Transfer(_, Safe, tokenId) from the Safe's creation block to H.
     ERC-721 Transfers carry 4 topics; ERC-20 Transfers carry 3, so they are excluded by shape.
  2. Each (contract, tokenId) is read through PoolLens.position(npm, tokenId) at H.
     status NO_DATA reason "positions"/"npm_no_code" -> not a concentrated-liquidity NFT;
     reason "ownerOf" -> burned. Neither is a position the Safe holds.
  3. Held directly: PoolLens owner == Safe.
     Staked: PoolLens staked == true (owner is the pool's gauge) AND gauge.stakedContains(Safe, id).
     Anything else (transferred away) is not held.

Output bytes are deterministic: no wall-clock time, sorted keys, fixed indent, one trailing newline.
Re-running with the same --base-block/--rh-block reproduces report.json byte for byte while the
RPCs still serve that state (Robinhood's public RPC prunes history; see report.md).

Usage:
  python3 ops/job1_report.py --out ops/job1_out            # pins latest-finalized-ish heads
  python3 ops/job1_report.py --base-block N --rh-block M --out DIR
"""
import argparse
from decimal import Decimal, getcontext
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import eth_abi
from eth_utils import function_signature_to_4byte_selector, keccak, to_checksum_address

sys.path.insert(0, str(Path(__file__).resolve().parent))
from clmath import amounts_for_liquidity  # noqa: E402

SAFE = "0x87DFf32Ca31066DA9BC210B55585a521355D580F"
LENS = "0xADebbd5825B033bCD4B84FB019AbFC673406d902"
TRANSFER = "0x" + keccak(text="Transfer(address,address,uint256)").hex()

CHAINS = {
    "base": {
        "chain_id": 8453,
        "name": "Base",
        "rpcs": ["https://base.drpc.org", "https://mainnet.base.org"],
        "safe_created": 51545084,  # first block with code at SAFE (binary search on eth_getCode)
        # Public Base RPCs refuse wide eth_getLogs (mainnet.base.org: always 429; drpc free plan:
        # rejected; tenderly public gateway: 1,000 blocks max). Logs only; state reads use "rpcs".
        "log_rpc": "https://base.gateway.tenderly.co",
        "log_span": 1000,
        "head_lag": 30,
    },
    "robinhood": {
        "chain_id": 4663,
        "name": "Robinhood Chain",
        "rpcs": ["https://rpc.mainnet.chain.robinhood.com"],  # the only RPC that serves state at a block
        "safe_created": 74604384,  # Safe deploy tx 0xffa95cd1…5380
        "log_rpc": "https://rpc.mainnet.chain.robinhood.com",
        "log_span": 30000,
        "head_lag": 30,
    },
}

getcontext().prec = 60
LOG_CACHE = Path(__file__).resolve().parent / ".logscan"
CACHE_DEPTH = 5000  # blocks below head treated as final for the log cache

STATUS = ["OK", "NO_DATA", "NOT_SUPPORTED"]
KIND = ["UNKNOWN", "UNIV3", "SLIPSTREAM"]

POSITION_T = ("(uint8,bytes32,uint8,address,uint256,address,address,address,address,int24,int24,"
              "uint128,int24,uint160,bool,bool,uint256,uint256,uint256,uint256,uint256,uint256,"
              "uint256,uint256)")
POSITION_F = ["status", "reason", "kind", "npm", "tokenId", "owner", "pool", "token0", "token1",
              "tickLower", "tickUpper", "liquidity", "tick", "sqrtPriceX96", "inRange", "staked",
              "amount0", "amount1", "fees0", "fees1", "feeGrowthInside0X128", "feeGrowthInside1X128",
              "blockNumber", "blockTimestamp"]
POOL_T = ("(uint8,bytes32,uint8,address,address,address,address,uint8,uint8,uint24,int24,uint160,"
          "int24,uint16,uint128,uint128,address,uint256,uint256,uint256,uint256)")
POOL_F = ["status", "reason", "kind", "pool", "factory", "token0", "token1", "decimals0", "decimals1",
          "fee", "tickSpacing", "sqrtPriceX96", "tick", "observationCardinality", "liquidity",
          "stakedLiquidity", "gauge", "feeGrowthGlobal0X128", "feeGrowthGlobal1X128", "blockNumber",
          "blockTimestamp"]


class Reverted(Exception):
    pass


class Rpc:
    def __init__(self, url):
        self.url = url

    def _post(self, method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(self.url, data=body, headers={
            "content-type": "application/json", "user-agent": "baba-job1-report/1"})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read())
        if "error" in d:
            msg = str(d["error"].get("message") if isinstance(d["error"], dict) else d["error"])
            if "revert" in msg.lower() or (isinstance(d["error"], dict) and d["error"].get("code") == 3):
                raise Reverted(msg)
            raise RuntimeError(msg)
        return d["result"]

    def req(self, method, params, tries=10):
        last = None
        for i in range(tries):
            try:
                return self._post(method, params)
            except Reverted:
                raise
            except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as e:
                last = e
                time.sleep(min(2 ** i, 60))
        raise RuntimeError("%s %s failed on %s: %s" % (method, params[:1], self.url, last))

    def call(self, to, data, block):
        return self.req("eth_call", [{"to": to, "data": data}, hex(block)])


def enc(sig, types, args):
    return "0x" + (function_signature_to_4byte_selector(sig) + eth_abi.encode(types, args)).hex()


def read(rpc, to, sig, types, args, out_types, block):
    """One eth_call, returned with its citation."""
    raw = rpc.call(to, enc(sig, types, args), block)
    vals = eth_abi.decode(out_types, bytes.fromhex(raw[2:]))
    cite = {"to": to_checksum_address(to), "call": "%s%s" % (sig.split("(")[0], _argstr(args)),
            "block": block}
    return vals, cite


def _argstr(args):
    return "(" + ",".join(to_checksum_address(a) if isinstance(a, str) and a.startswith("0x") and len(a) == 42
                          else str(a) for a in args) + ")"


def _jsonable(v):
    if isinstance(v, bytes):
        return "0x" + v.hex()
    if isinstance(v, str) and v.startswith("0x") and len(v) == 42:
        return to_checksum_address(v)
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) >= 2 ** 53:
        return str(v)  # keep big integers exact in JSON
    return v


def lens_position(rpc, npm, tid, block):
    (t,), cite = read(rpc, LENS, "position(address,uint256)", ["address", "uint256"], [npm, tid],
                      [POSITION_T], block)
    p = dict(zip(POSITION_F, t))
    p["status"] = STATUS[p["status"]]
    p["kind"] = KIND[p["kind"]]
    p["reason"] = p["reason"].rstrip(b"\0").decode()
    return p, cite


def lens_pool(rpc, pool, block):
    (t,), cite = read(rpc, LENS, "poolState(address)", ["address"], [pool], [POOL_T], block)
    s = dict(zip(POOL_F, t))
    s["status"] = STATUS[s["status"]]
    s["kind"] = KIND[s["kind"]]
    s["reason"] = s["reason"].rstrip(b"\0").decode()
    return s, cite


def symbol(rpc, token, block):
    try:
        (s,), cite = read(rpc, token, "symbol()", [], [], ["string"], block)
        return s, cite
    except Exception:
        return None, None


def pin(cfg, rpcs, forced):
    if forced:
        return forced
    heads = [int(r.req("eth_blockNumber", []), 16) for r in rpcs]
    return min(heads) - cfg["head_lag"]


def scan_received_nfts(rpc, cfg, H, a=None, found=None, calls=0):
    """Every ERC-721 Transfer with to == SAFE in [a or safe_created, H]. Returns sorted unique (contract, id)."""
    topic_to = "0x" + "0" * 24 + SAFE[2:].lower()
    found = set(found or ())
    a = cfg["safe_created"] if a is None else a
    while a <= H:
        b = min(a + cfg["log_span"] - 1, H)
        if calls and calls % 100 == 0:
            print("  %s logs: block %d / %d" % (cfg["name"], a, H), file=sys.stderr)
        time.sleep(0.2)  # the public RPCs rate-limit bursts (Robinhood: HTTP 429)
        logs = rpc.req("eth_getLogs", [{"fromBlock": hex(a), "toBlock": hex(b),
                                         "topics": [TRANSFER, None, topic_to]}])
        calls += 1
        for lg in logs:
            if len(lg["topics"]) == 4:
                found.add((to_checksum_address(lg["address"]), int(lg["topics"][3], 16)))
        a = b + 1
    return sorted(found), calls, H


def _words(raw):
    b = bytes.fromhex(raw[2:])
    return [int.from_bytes(b[i:i + 32], "big") for i in range(0, len(b), 32)]


def _int24(w):
    w &= (1 << 24) - 1
    return w - (1 << 24) if w >= 1 << 23 else w


def direct_position(rpc, npm, tid, H, lens_reason):
    """For an NFT PoolLens v1 returns NO_DATA on: decide ownership, and if the Safe holds or has staked it,
    read the position directly. Returns (entry or None, not_held record or None)."""
    def cite(to, call):
        return {"to": to_checksum_address(to), "call": call, "block": H}
    try:
        (owner,), ocite = read(rpc, npm, "ownerOf(uint256)", ["uint256"], [tid], ["address"], H)
    except Reverted:
        return None, {"lens_reason": lens_reason + "; ownerOf reverts (burned)"}
    owner = to_checksum_address(owner)
    held, extra = None, {}
    if owner.lower() == SAFE.lower():
        held = "direct"
    else:
        try:
            (yes,), scite = read(rpc, owner, "stakedContains(address,uint256)", ["address", "uint256"],
                                 [SAFE, tid], ["bool"], H)
        except Exception:
            yes = False
        if yes:
            held, extra = "staked", {"staked_contains_read": scite}
    if held is None:
        return None, {"lens_reason": "%s; owner is %s, not the Safe or its stake" % (lens_reason, owner),
                      "owner_read": ocite}
    pw = _words(rpc.call(npm, enc("positions(uint256)", ["uint256"], [tid]), H))
    if len(pw) != 12:
        raise RuntimeError("positions(%d) on %s returned %d words" % (tid, npm, len(pw)))
    t0, t1 = to_checksum_address("0x%040x" % pw[2]), to_checksum_address("0x%040x" % pw[3])
    tl, tu, liq = _int24(pw[5]), _int24(pw[6]), pw[7]
    if held == "staked":
        (pool,), pcite = read(rpc, owner, "pool()", [], [], ["address"], H)
    else:
        (fac,), _ = read(rpc, npm, "factory()", [], [], ["address"], H)
        (pool,), pcite = read(rpc, fac, "getPool(address,address,int24)", ["address", "address", "int24"],
                              [t0, t1, _int24(pw[4])], ["address"], H)
    sw = _words(rpc.call(pool, enc("slot0()", [], []), H))
    sqrt_p, tick = sw[0], _int24(sw[1])
    (fee,), _ = read(rpc, pool, "fee()", [], [], ["uint24"], H)
    (ts,), _ = read(rpc, pool, "tickSpacing()", [], [], ["int24"], H)
    dec = []
    for t in (t0, t1):
        (d,), _ = read(rpc, t, "decimals()", [], [], ["uint8"], H)
        dec.append(d)
    a0, a1 = amounts_for_liquidity(sqrt_p, tick, tl, tu, liq)
    entry = {
        "held": held, **extra,
        "read_via": "direct",
        "lens_status": "NO_DATA", "lens_reason": lens_reason,
        "npm": to_checksum_address(npm), "token_id": tid, "kind": "UNREAD_BY_LENS",
        "pool": to_checksum_address(pool),
        "token0": {"address": t0, "symbol": symbol(rpc, t0, H)[0], "decimals": dec[0]},
        "token1": {"address": t1, "symbol": symbol(rpc, t1, H)[0], "decimals": dec[1]},
        "fee": fee, "tick_spacing": ts, "tick_lower": tl, "tick_upper": tu, "current_tick": tick,
        "sqrt_price_x96": str(sqrt_p), "in_range": tl <= tick < tu, "liquidity": str(liq),
        "staked": held == "staked",
        "uncollected_fees_wei": None,
        "uncollected_fees_note": "not read: PoolLens v1 returns NO_DATA (%s) for this position manager" % lens_reason,
        "principal_if_withdrawn_wei": {"token0": str(a0), "token1": str(a1)},
        "principal_source": "computed by ops/clmath.py (Uniswap v3 TickMath/SqrtPriceMath, rounded down) from "
                            "the positions() and slot0() reads; not a PoolLens read",
        "owner": owner,
        "position_read": cite(npm, "positions(%d)" % tid), "owner_read": ocite,
        "pool_read": cite(pool, "slot0()"), "pool_from_read": pcite,
    }
    if held == "staked":
        entry["gauge"] = owner
        try:
            (earned,), ecite = read(rpc, owner, "earned(address,uint256)", ["address", "uint256"],
                                    [SAFE, tid], ["uint256"], H)
            entry["gauge_rewards_earned_wei"] = str(earned)
            entry["gauge_rewards_read"] = ecite
        except Reverted:
            entry["gauge_rewards_earned_wei"] = None
            entry["gauge_rewards_note"] = "not read: earned(address,uint256) reverts on this gauge"
    return entry, None


def chain_report(key, cfg, forced_block):
    rpcs = [Rpc(u) for u in cfg["rpcs"]]
    primary = rpcs[0]
    cid = int(primary.req("eth_chainId", []), 16)
    assert cid == cfg["chain_id"], "chain id %s != %s on %s" % (cid, cfg["chain_id"], primary.url)
    log_rpc = Rpc(cfg["log_rpc"])
    # Logs below (head - CACHE_DEPTH) are final and never change, so a scan of them is cached on disk
    # and only the tail is re-scanned. The cache changes nothing in report.json.
    cache_f = LOG_CACHE / ("%s.json" % key)
    cached = json.loads(cache_f.read_text()) if cache_f.exists() else None
    if cached and cached["safe"] == SAFE and cached["from_block"] == cfg["safe_created"]:
        start, seed = cached["to_block"] + 1, [tuple(x) for x in cached["found"]]
    else:
        start, seed = cfg["safe_created"], []
    head = pin(cfg, rpcs, None)
    final = head - CACHE_DEPTH
    if start <= final:
        seed, n, _ = scan_received_nfts(log_rpc, cfg, final, a=start, found=seed)
        print("  %s: scanned %d log requests up to final block %d" % (cfg["name"], n, final), file=sys.stderr)
        LOG_CACHE.mkdir(parents=True, exist_ok=True)
        cache_f.write_text(json.dumps({"safe": SAFE, "from_block": cfg["safe_created"], "to_block": final,
                                       "found": [list(x) for x in seed]}))
        start = final + 1
    if forced_block:
        H = forced_block
        if H < start - 1:
            received, log_calls, _ = scan_received_nfts(log_rpc, cfg, H)  # pinned below the cache: rescan
        else:
            received, log_calls, _ = scan_received_nfts(log_rpc, cfg, H, a=start, found=seed)
    else:
        # Scan the long history first, THEN pin H and scan the short remainder, so every state read
        # at H happens within seconds of H. Robinhood's public RPC keeps state for only ~10 minutes
        # (measured 2026-10-19: 6,202 blocks / 633 s); a scan after pinning would outlive it.
        pre = pin(cfg, rpcs, None)
        received, log_calls, _ = scan_received_nfts(log_rpc, cfg, pre, a=start, found=seed)
        H = pin(cfg, rpcs, None)
        received, log_calls, _ = scan_received_nfts(log_rpc, cfg, H, a=pre + 1, found=received, calls=log_calls)
    blk = primary.req("eth_getBlockByNumber", [hex(H), False])
    lens_code = primary.req("eth_getCode", [LENS, hex(H)])
    positions, not_held = [], []
    for npm, tid in received:
        p, pcite = lens_position(primary, npm, tid, H)
        if p["status"] != "OK":
            if p["reason"] in ("positions", "npm_no_code"):
                not_held.append({"contract": npm, "token_id": tid, "lens_status": p["status"],
                                 "lens_reason": p["reason"] + " (not a concentrated-liquidity position NFT)",
                                 "read": pcite})
                continue
            entry, nh = direct_position(primary, npm, tid, H, p["reason"])
            if entry is None:
                nh.update({"contract": npm, "token_id": tid, "lens_status": p["status"], "read": pcite})
                not_held.append(nh)
            else:
                entry["lens_read"] = pcite
                positions.append(entry)
            continue
        entry = None
        if p["owner"].lower() == SAFE.lower():
            entry = {"held": "direct"}
        elif p["staked"]:
            (yes,), scite = read(primary, p["owner"], "stakedContains(address,uint256)",
                                 ["address", "uint256"], [SAFE, tid], ["bool"], H)
            if yes:
                entry = {"held": "staked", "staked_contains_read": scite}
        if entry is None:
            not_held.append({"contract": npm, "token_id": tid, "lens_status": "OK",
                             "lens_reason": "owner is %s, not the Safe or its stake" %
                             to_checksum_address(p["owner"]), "read": pcite})
            continue
        s, scite = lens_pool(primary, p["pool"], H)
        sym0, _ = symbol(primary, p["token0"], H)
        sym1, _ = symbol(primary, p["token1"], H)
        entry.update({
            "npm": to_checksum_address(npm),
            "token_id": tid,
            "kind": p["kind"],
            "pool": to_checksum_address(p["pool"]),
            "token0": {"address": to_checksum_address(p["token0"]), "symbol": sym0, "decimals": s["decimals0"]},
            "token1": {"address": to_checksum_address(p["token1"]), "symbol": sym1, "decimals": s["decimals1"]},
            "fee": s["fee"],
            "tick_spacing": s["tickSpacing"],
            "tick_lower": p["tickLower"],
            "tick_upper": p["tickUpper"],
            "current_tick": p["tick"],
            "sqrt_price_x96": str(p["sqrtPriceX96"]),
            "in_range": p["inRange"],
            "liquidity": str(p["liquidity"]),
            "staked": p["staked"],
            "uncollected_fees_wei": {"token0": str(p["fees0"]), "token1": str(p["fees1"])},
            "principal_if_withdrawn_wei": {"token0": str(p["amount0"]), "token1": str(p["amount1"])},
            "owner": to_checksum_address(p["owner"]),
            "position_read": pcite,
            "pool_read": scite,
        })
        if p["staked"]:
            entry["gauge"] = to_checksum_address(p["owner"])
            try:
                (earned,), ecite = read(primary, p["owner"], "earned(address,uint256)",
                                        ["address", "uint256"], [SAFE, tid], ["uint256"], H)
                entry["gauge_rewards_earned_wei"] = str(earned)
                entry["gauge_rewards_read"] = ecite
                (rt,), rcite = read(primary, p["owner"], "rewardToken()", [], [], ["address"], H)
                rsym, _ = symbol(primary, rt, H)
                entry["gauge_reward_token"] = {"address": to_checksum_address(rt), "symbol": rsym, "read": rcite}
            except Reverted:
                entry["gauge_rewards_earned_wei"] = None
        positions.append(entry)

    # Completeness, read from chain at H independently of the log scan: every NPM that ever sent the
    # Safe a position must report balanceOf(Safe) == the number found held directly, and every gauge
    # holding one of the Safe's positions must list exactly the ids found staked (stakedValues).
    completeness = []
    npms = sorted({e["npm"] for e in positions} | {
        n["contract"] for n in not_held
        if not n["lens_reason"].startswith(("positions", "npm_no_code"))})  # every position manager seen
    for npm in npms:
        (bal,), bcite = read(primary, npm, "balanceOf(address)", ["address"], [SAFE], ["uint256"], H)
        direct = sum(1 for e in positions if e["npm"] == npm and e["held"] == "direct")
        completeness.append({"check": "NPM balanceOf(Safe) == positions found held directly",
                             "expected": direct, "read_value": bal, "pass": bal == direct, "read": bcite})
    for g in sorted({e["gauge"] for e in positions if e["held"] == "staked"}):
        (ids,), gcite = read(primary, g, "stakedValues(address)", ["address"], [SAFE], ["uint256[]"], H)
        mine = sorted(e["token_id"] for e in positions if e.get("gauge") == g)
        completeness.append({"check": "gauge stakedValues(Safe) == positions found staked there",
                             "expected": mine, "read_value": sorted(ids), "pass": sorted(ids) == mine,
                             "read": gcite})

    # Cross-check every PoolLens position read on the other RPCs at the same block.
    cross = []
    for r in rpcs[1:]:
        same = True
        for e in positions:
            if e.get("read_via") == "direct":
                pw = _words(r.call(e["npm"], enc("positions(uint256)", ["uint256"], [e["token_id"]]), H))
                sw = _words(r.call(e["pool"], enc("slot0()", [], []), H))
                if (str(pw[7]), str(sw[0]), _int24(sw[1])) != (e["liquidity"], e["sqrt_price_x96"], e["current_tick"]):
                    same = False
                continue
            p2, _ = lens_position(r, e["npm"], e["token_id"], H)
            if (str(p2["fees0"]), str(p2["fees1"]), p2["tick"], str(p2["liquidity"])) != (
                    e["uncollected_fees_wei"]["token0"], e["uncollected_fees_wei"]["token1"],
                    e["current_tick"], e["liquidity"]):
                same = False
        cross.append({"rpc": r.url, "positions_identical": same})

    positions.sort(key=lambda e: (e["npm"].lower(), e["token_id"]))
    not_held.sort(key=lambda e: (e["contract"].lower(), e["token_id"]))
    return {
        "chain_id": cfg["chain_id"],
        "name": cfg["name"],
        "block": H,
        "block_hash": blk["hash"],
        "block_timestamp": int(blk["timestamp"], 16),
        "rpc": primary.url,
        "cross_checked_on": cross,
        "lens": {"address": LENS, "runtime_keccak256": "0x" + keccak(hexstr=lens_code).hex(),
                 "code_bytes": (len(lens_code) - 2) // 2},
        "discovery": {
            "method": "eth_getLogs Transfer(address,address,uint256) with topic2 = Safe and 4 topics (ERC-721)",
            "from_block": cfg["safe_created"],
            "to_block": H,
            "log_rpc": cfg["log_rpc"],
            "nfts_ever_received": len(received),
        },
        "completeness_checks": completeness,
        "positions_held": len(positions),
        "positions": positions,
        "nfts_received_not_held": not_held,
    }


STABLES_USD1 = {"USDC", "USDbC", "USDG", "USDT", "DAI"}  # report.md estimate only: taken as $1


def human(raw, d):
    """Exact token amount in human units (no rounding): raw / 10**d."""
    if raw is None:
        return "n/a"
    q = Decimal(int(raw)) / (Decimal(10) ** d)
    t = ("{:.%df}" % d).format(q).rstrip("0").rstrip(".") if d else str(q)
    return t or "0"


def usd(x):
    if x is None:
        return "n/a"
    if x == 0:
        return "$0"
    if x < Decimal("0.01"):
        return "< $0.01"
    return "≈ ${:,.2f}".format(x)


def pool_price(e):
    """Human token1 per token0 from the position's own pool sqrtPriceX96 at the pinned block."""
    sp = Decimal(int(e["sqrt_price_x96"])) / (Decimal(2) ** 96)
    return sp * sp * (Decimal(10) ** (e["token0"]["decimals"] - e["token1"]["decimals"]))


def usd_prices(positions):
    """USD per token for report.md, from the Safe's own pools only: a stablecoin is $1; a token paired with a
    priced token takes the price of the pool where the Safe holds the most liquidity. Returns {symbol: (price,
    source)}; tokens with no such pool are absent (shown as n/a)."""
    px = {}
    for e in positions:
        for t in ("token0", "token1"):
            if e[t]["symbol"] in STABLES_USD1:
                px[e[t]["symbol"]] = (Decimal(1), "taken as $1")
    while True:
        # Price one new token per step, from the eligible pool where the Safe holds the most liquidity
        # (positions with no liquidity never set a price).
        best = None
        for e in positions:
            s0, s1, P, L = e["token0"]["symbol"], e["token1"]["symbol"], pool_price(e), int(e["liquidity"])
            if P == 0 or L <= 1 or (s0 in px) == (s1 in px):
                continue
            if best is None or L > best[0]:
                best = (L, e, s0, s1, P)
        if best is None:
            return px
        _, e, s0, s1, P = best
        src = "pool `%s…` price at the pinned block" % e["pool"][:10]
        if s1 in px:
            px[s0] = (P * px[s1][0], src)
        else:
            px[s1] = (px[s0][0] / P, src)


def pos_usd(e, raw0, raw1, px):
    """USD of (raw0 token0, raw1 token1): amounts converted at the position's own pool price, then token1 (or
    token0) to USD. None when neither token has a price."""
    a0 = Decimal(int(raw0)) / (Decimal(10) ** e["token0"]["decimals"])
    a1 = Decimal(int(raw1)) / (Decimal(10) ** e["token1"]["decimals"])
    P = pool_price(e)
    s0, s1 = e["token0"]["symbol"], e["token1"]["symbol"]
    if s1 in px:
        return (a0 * P + a1) * px[s1][0]
    if s0 in px and P:
        return (a0 + a1 / P) * px[s0][0]
    return None


def to_md(rep):
    L = ["# LP health report — Safe %s" % rep["safe"], "",
         "Job 1 on the Agent Job Escrow (Arc mainnet). Facts and the reads they came from; no recommendations.",
         "Every number below is in report.json with the contract, function and block it was read at.", ""]
    j = rep.get("job")
    if j and "create_tx" in j:
        L += ["## The job", "",
              "Job %d on the Agent Job Escrow `%s` (Arc mainnet, chain %d), created in tx `%s` (block %d): client "
              "`%s`, ERC-8004 agent %d, %s USDC, deadline %d (%s UTC)." % (
                  j["job_id"], j["escrow"], j["escrow_chain_id"], j["create_tx"], j["create_block"], j["client"],
                  j["agent_id"], human(j["amount_usdc_raw"], 6), j["deadline"],
                  time.strftime("%Y-%m-%d %H:%M", time.gmtime(j["deadline"]))), "",
              "Spec: `%s`, keccak256 of its exact bytes = `%s`. The on-chain specHash is `%s` = keccak256 of that "
              "32-byte value. The app hashes the contents of its spec field, and the field held the file's hash, "
              "so the spec is hashed twice. job1_report.py checks this derivation exactly and fails on any other value." % (
                  j["spec_file"], j["spec_file_keccak256"], j["spec_hash_onchain"]), ""]
    for key in ("base", "robinhood"):
        if key not in rep["chains"]:
            continue
        c = rep["chains"][key]
        L += ["## %s (chain %d) — block %d" % (c["name"], c["chain_id"], c["block"]), "",
              "Block hash `%s`, timestamp %d. Reads via `%s`." % (c["block_hash"], c["block_timestamp"], c["rpc"])]
        for x in c["cross_checked_on"]:
            L.append("Same PoolLens position reads repeated on `%s` at the same block: %s." %
                     (x["rpc"], "identical" if x["positions_identical"] else "DIFFERENT"))
        d = c["discovery"]
        L += ["", "Discovery: %d ERC-721 tokens ever transferred to the Safe between blocks %d and %d "
              "(eth_getLogs on `%s`)." % (d["nfts_ever_received"], d["from_block"], d["to_block"],
                                         d["log_rpc"]), ""]
        for k in c["completeness_checks"]:
            L.append("- %s: expected %s, read %s at `%s` → %s" % (k["check"], k["expected"], k["read_value"],
                                                                  k["read"]["to"], "pass" if k["pass"] else "FAIL"))
        if c["completeness_checks"]:
            L.append("")
        if not c["positions"]:
            L += ["**The Safe holds no concentrated-liquidity positions on %s at this block.**" % c["name"], ""]
        else:
            px = usd_prices(c["positions"])
            tot_p = tot_f = Decimal(0)
            L += ["### Summary (human units; USD is an estimate)", "",
                  "| Position | Pair | In range | Staked | Principal if withdrawn | Uncollected fees | Est. USD principal | Est. USD fees |",
                  "|---|---|---|---|---|---|---|---|"]
            for e in c["positions"]:
                t0, t1 = e["token0"], e["token1"]
                pr, fe = e["principal_if_withdrawn_wei"], e["uncollected_fees_wei"]
                vp = pos_usd(e, pr["token0"], pr["token1"], px)
                vf = pos_usd(e, fe["token0"], fe["token1"], px) if fe else None
                tot_p += vp or 0
                tot_f += vf or 0
                mark = " †" if e.get("read_via") == "direct" else ""
                fees_txt = ("%s %s + %s %s" % (human(fe["token0"], t0["decimals"]), t0["symbol"],
                                               human(fe["token1"], t1["decimals"]), t1["symbol"]) if fe else "not read")
                L.append("| #%d%s | %s/%s | %s | %s | %s %s + %s %s | %s | %s | %s |" % (
                    e["token_id"], mark, t0["symbol"], t1["symbol"], "yes" if e["in_range"] else "no",
                    "yes" if e["staked"] else "no",
                    human(pr["token0"], t0["decimals"]), t0["symbol"], human(pr["token1"], t1["decimals"]), t1["symbol"],
                    fees_txt, usd(vp), usd(vf) if fe else "n/a"))
            nd = sum(1 for e in c["positions"] if not e["uncollected_fees_wei"])
            L += ["| **Total** | | | | | | **%s** | **%s**%s |" % (
                      usd(tot_p), usd(tot_f), " (excludes the %d † position%s; fees not read)" % (nd, "s" * (nd > 1))
                      if nd else ""), "",
                  "USD figures are estimates for the reader, not reads: each position's amounts are converted at its "
                  "own pool's price at the pinned block (`sqrt_price_x96` in report.json), then to USD with: " +
                  "; ".join("%s %s (%s)" % (sym, usd(v[0]).replace("≈ ", "≈ ") if v[0] >= 1 else "≈ $%s" % v[0].quantize(Decimal("0.0001")), v[1])
                            for sym, v in sorted(px.items())) + ". Not used for anything on chain.", ""]
            direct = [e for e in c["positions"] if e.get("read_via") == "direct"]
            if direct:
                L += ["† Read directly, not through PoolLens: PoolLens v1 returns NO_DATA (%s) for this position "
                      "manager (`%s…`, %s). Ticks and liquidity come from `positions()`, price and current tick from "
                      "the pool's `slot0()`, both at the pinned block. Principal is computed from those reads with "
                      "Uniswap v3 math (`ops/clmath.py`, checked against PoolLens to the wei on every readable "
                      "position). Uncollected fees were not read for these positions." % (
                          direct[0]["lens_reason"], direct[0]["npm"][:10],
                          ", ".join("#%d" % e["token_id"] for e in direct)), ""]
            L += ["### Reads (raw, as in report.json)", ""]
            L += ["| NPM / id | Pool | Fee / spacing | Range | Tick | In range | Liquidity | Uncollected fees (wei) | Staked |",
                  "|---|---|---|---|---|---|---|---|---|"]
            for e in c["positions"]:
                pair = "%s/%s" % (e["token0"]["symbol"], e["token1"]["symbol"])
                L.append("| `%s…` #%d | %s `%s…` | %d / %d | %d … %d | %d | %s | %s | %s %s / %s %s | %s |" % (
                    e["npm"][:8], e["token_id"], pair, e["pool"][:8], e["fee"], e["tick_spacing"],
                    e["tick_lower"], e["tick_upper"], e["current_tick"], "yes" if e["in_range"] else "no",
                    e["liquidity"],
                    *((e["uncollected_fees_wei"]["token0"], e["token0"]["symbol"],
                       e["uncollected_fees_wei"]["token1"], e["token1"]["symbol"]) if e["uncollected_fees_wei"]
                      else ("not read", "", "", "")),
                    "yes" if e["staked"] else "no"))
            L.append("")
            staked = [e for e in c["positions"] if e["staked"]]
            if staked:
                def _rw(e):
                    if e.get("gauge_rewards_earned_wei") is None:
                        return "#%d %s" % (e["token_id"], e.get("gauge_rewards_note", "not read"))
                    sym = (e.get("gauge_reward_token") or {}).get("symbol")
                    return "#%d %s %s (%s wei)%s" % (
                        e["token_id"], human(e["gauge_rewards_earned_wei"], 18), sym, e["gauge_rewards_earned_wei"],
                        "" if sym in px else ", no USD estimate: no pool for this token among the Safe's positions")
                L += ["Staked positions: swap fees on staked liquidity are paid to the gauge, not to the NFT, "
                      "so the uncollected fees PoolLens reports for them are what `collect` would return. "
                      "Gauge rewards earned: " + "; ".join(_rw(e) for e in staked) + ".", ""]
            empty = [e for e in c["positions"] if e["liquidity"] == "0"]
            if empty:
                L += ["Held with zero liquidity: " + ", ".join("#%d" % e["token_id"] for e in empty) + ".", ""]
        if c["nfts_received_not_held"]:
            L += ["Received but not held at this block: " + ", ".join(
                "`%s…` #%d (%s)" % (n["contract"][:8], n["token_id"], n["lens_reason"] or n["lens_status"])
                for n in c["nfts_received_not_held"]) + ".", ""]
    L += ["## Reproduce", "",
          "`python3 ops/job1_report.py --base-block %s --rh-block %s --out DIR` rewrites report.json byte for "
          "byte while the RPCs still serve state at those blocks. The Base leg re-reads from any node with "
          "state at that block. Robinhood's public RPC keeps state for about 10 minutes (measured "
          "2026-10-19: 6,202 blocks, 633 s), so the Robinhood leg can be re-read on it only in that window; "
          "after that it needs an archive node for chain 4663." % (
              rep["chains"].get("base", {}).get("block"), rep["chains"].get("robinhood", {}).get("block")), "",
          "resultHash = keccak256(exact bytes of report.json).", ""]
    return "\n".join(L)


ARC_RPC = "https://rpc.mainnet.arc.io"
ESCROW = "0x9795C1E25d27976Ef5A888bc05ff224eCf9034da"
JOB_ID = 1
CREATE_TX = "0x4db11e45967a55cc5d729eb54029253d92e91a9ff0b50b36d457499b017fcd66"
SPEC_FILE = Path(__file__).resolve().parent / "job1_spec.md"
JOB_T = "(address,uint256,uint256,uint64,bytes32,uint8,bytes32,address,uint64)"


def job_binding():
    """Bind the report to job 1 on Arc mainnet, read at the createJob block. The app hashes the contents of its
    spec field, and the spec field held keccak256(job1_spec.md) as a bytes32, so the on-chain specHash must be
    exactly keccak256(bytes32 keccak256(exact bytes of job1_spec.md)). Any other value fails the check."""
    rpc = Rpc(ARC_RPC)
    rcpt = rpc.req("eth_getTransactionReceipt", [CREATE_TX])
    blk = int(rcpt["blockNumber"], 16)
    (j,), jcite = read(rpc, ESCROW, "getJob(uint256)", ["uint256"], [JOB_ID], [JOB_T], blk)
    client, agent, amount, deadline, spec_onchain, status = j[0], j[1], j[2], j[3], j[4], j[5]
    file_hash = keccak(SPEC_FILE.read_bytes())
    expected = keccak(file_hash)  # keccak256 of the 32-byte value, not of its hex text
    checks = [
        {"check": "createJob tx status == 1 and sent to the escrow",
         "pass": rcpt["status"] == "0x1" and (rcpt["to"] or "").lower() == ESCROW.lower()},
        {"check": "on-chain specHash == keccak256(bytes32 keccak256(job1_spec.md))",
         "expected": "0x" + expected.hex(), "read_value": "0x" + spec_onchain.hex(),
         "pass": spec_onchain == expected},
        {"check": "agentId == 135", "read_value": agent, "pass": agent == 135},
    ]
    return {
        "escrow_chain_id": 5042, "escrow": ESCROW, "job_id": JOB_ID, "create_tx": CREATE_TX, "create_block": blk,
        "client": to_checksum_address(client), "agent_id": agent, "amount_usdc_raw": amount,
        "deadline": deadline, "status_at_create_block": status,
        "spec_file": "ops/job1_spec.md",
        "spec_file_keccak256": "0x" + file_hash.hex(),
        "spec_hash_onchain": "0x" + spec_onchain.hex(),
        "spec_hash_derivation": "spec_hash_onchain = keccak256(spec_file_keccak256 as 32 bytes). The app hashes "
                                "the contents of its spec field, and that field held spec_file_keccak256.",
        "get_job_read": jcite,
        "checks": checks,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-block", type=int)
    ap.add_argument("--rh-block", type=int)
    ap.add_argument("--out", required=True)
    ap.add_argument("--chains", default="base,robinhood", help="testing only: a subset changes report.json")
    ap.add_argument("--render-md", metavar="REPORT_JSON", help="re-render report.md from an existing report.json; no reads")
    a = ap.parse_args()
    if a.render_md:
        rep = json.loads(Path(a.render_md).read_text())
        Path(a.out).mkdir(parents=True, exist_ok=True)
        (Path(a.out) / "report.md").write_text(to_md(rep))
        print("report.md rendered from %s (keccak256 of that report.json: 0x%s)" % (
            a.render_md, keccak(Path(a.render_md).read_bytes()).hex()))
        return 0
    rep = {
        "job": job_binding(),
        "safe": SAFE,
        "lens": LENS,
        "chains": {k: chain_report(k, CHAINS[k], {"base": a.base_block, "robinhood": a.rh_block}[k])
                   for k in a.chains.split(",")},
    }
    rep = json.loads(json.dumps(rep, default=_jsonable), parse_int=int)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(rep, sort_keys=True, indent=2, ensure_ascii=True) + "\n").encode()
    (out / "report.json").write_bytes(data)
    (out / "report.md").write_text(to_md(rep))
    h = "0x" + keccak(data).hex()
    print("report.json %d bytes  keccak256 %s" % (len(data), h))
    bad = 0
    for x in rep["job"]["checks"]:
        if not x["pass"]:
            bad += 1
            print("JOB CHECK FAILED: %s %s" % (x["check"], {k: v for k, v in x.items() if k != "check"}))
    for k, c in rep["chains"].items():
        print("%-9s block %d  positions held %d  received-not-held %d" % (
            k, c["block"], c["positions_held"], len(c["nfts_received_not_held"])))
        for x in c["completeness_checks"]:
            bad += not x["pass"]
        for x in c["cross_checked_on"]:
            bad += not x["positions_identical"]
    if bad:
        print("%d CHECK(S) FAILED — do not submit this report" % bad)
        return 3
    print("all completeness and cross-RPC checks pass")


if __name__ == "__main__":
    sys.exit(main())
