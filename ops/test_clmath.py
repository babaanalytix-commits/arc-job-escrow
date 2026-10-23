"""clmath must reproduce PoolLens amount0/amount1 to the wei on every readable position in a report.json."""
import json, sys
from clmath import amounts_for_liquidity

rep = json.load(open(sys.argv[1]))
n = bad = 0
for chain in rep["chains"].values():
    for e in chain["positions"]:
        if e.get("read_via") == "direct":
            continue
        got = amounts_for_liquidity(int(e["sqrt_price_x96"]), e["current_tick"], e["tick_lower"],
                                    e["tick_upper"], int(e["liquidity"]))
        want = (int(e["principal_if_withdrawn_wei"]["token0"]), int(e["principal_if_withdrawn_wei"]["token1"]))
        n += 1
        if got != want:
            bad += 1
            print("MISMATCH #%d: clmath %s, PoolLens %s" % (e["token_id"], got, want))
print("%d positions compared, %d mismatches" % (n, bad))
sys.exit(1 if bad or n == 0 else 0)
