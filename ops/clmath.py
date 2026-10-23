"""Uniswap v3 / Slipstream position math, integer-exact, for positions PoolLens v1 cannot read.

Ports TickMath.getSqrtRatioAtTick and SqrtPriceMath.getAmount{0,1}Delta with roundUp = false (what burn
pays). Tested against PoolLens amount0/amount1 on readable positions in test_clmath.py.
"""

Q96 = 1 << 96
MAX_TICK = 887272


def sqrt_ratio_at_tick(tick):
    a = -tick if tick < 0 else tick
    if a > MAX_TICK:
        raise ValueError("tick out of range")
    r = 0xfffcb933bd6fad37aa2d162d1a594001 if a & 0x1 else 0x100000000000000000000000000000000
    for bit, m in ((0x2, 0xfff97272373d413259a46990580e213a), (0x4, 0xfff2e50f5f656932ef12357cf3c7fdcc),
                   (0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0), (0x10, 0xffcb9843d60f6159c9db58835c926644),
                   (0x20, 0xff973b41fa98c081472e6896dfb254c0), (0x40, 0xff2ea16466c96a3843ec78b326b52861),
                   (0x80, 0xfe5dee046a99a2a811c461f1969c3053), (0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4),
                   (0x200, 0xf987a7253ac413176f2b074cf7815e54), (0x400, 0xf3392b0822b70005940c7a398e4b70f3),
                   (0x800, 0xe7159475a2c29b7443b29c7fa6e889d9), (0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825),
                   (0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5), (0x4000, 0x70d869a156d2a1b890bb3df62baf32f7),
                   (0x8000, 0x31be135f97d08fd981231505542fcfa6), (0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9),
                   (0x20000, 0x5d6af8dedb81196699c329225ee604), (0x40000, 0x2216e584f5fa1ea926041bedfe98),
                   (0x80000, 0x48a170391f7dc42444e8fa2)):
        if a & bit:
            r = (r * m) >> 128
    if tick > 0:
        r = ((1 << 256) - 1) // r
    return (r >> 32) + (0 if r % (1 << 32) == 0 else 1)


def amount0_delta(sa, sb, liq):
    if sa > sb:
        sa, sb = sb, sa
    return ((liq << 96) * (sb - sa) // sb) // sa


def amount1_delta(sa, sb, liq):
    if sa > sb:
        sa, sb = sb, sa
    return liq * (sb - sa) // Q96


def amounts_for_liquidity(sqrt_price, tick, tick_lower, tick_upper, liq):
    """(amount0, amount1) a full burn would return, rounded down. Branches on the current TICK, as
    Pool._modifyPosition does (not on the sqrt price)."""
    sl, su = sqrt_ratio_at_tick(tick_lower), sqrt_ratio_at_tick(tick_upper)
    if tick < tick_lower:
        return amount0_delta(sl, su, liq), 0
    if tick < tick_upper:
        return amount0_delta(sqrt_price, su, liq), amount1_delta(sl, sqrt_price, liq)
    return 0, amount1_delta(sl, su, liq)
