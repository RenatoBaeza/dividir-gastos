"""Decimal money helpers.

Every amount in the system is quantised to two decimal places. That keeps the
arithmetic predictable across the API, the database (``numeric(18,4)``) and the
frontend; zero-decimal currencies such as JPY are simply stored with a trailing
``.00``.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
TOLERANCE = Decimal("0.01")


def money(value: Decimal | float | int | str) -> Decimal:
    """Round a value to the nearest cent, half away from zero."""
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def convert(amount: Decimal, rate_to_base: Decimal) -> Decimal:
    return money(Decimal(amount) * Decimal(rate_to_base))


def allocate(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Split ``total`` across ``weights`` so the parts sum back to ``total``.

    Uses largest-remainder: everyone gets their floored share and the leftover
    cents go to the participants with the biggest truncated remainder. That
    avoids the classic "10.00 split three ways loses a cent" problem.
    """
    n = len(weights)
    if n == 0:
        return []

    total = money(total)
    weights = [Decimal(w) for w in weights]
    weight_sum = sum(weights)
    if weight_sum <= 0:
        weights = [Decimal(1)] * n
        weight_sum = Decimal(n)

    cents_total = int((total / CENT).to_integral_value(rounding=ROUND_HALF_UP))
    exact = [Decimal(cents_total) * w / weight_sum for w in weights]
    floors = [int(e.to_integral_value(rounding="ROUND_FLOOR")) for e in exact]
    remainder = cents_total - sum(floors)

    order = sorted(
        range(n), key=lambda i: (-(exact[i] - floors[i]), -weights[i], i)
    )
    for k in range(remainder):
        floors[order[k % n]] += 1

    return [Decimal(c) * CENT for c in floors]


def sums_to(parts: list[Decimal], total: Decimal, tolerance: Decimal = TOLERANCE) -> bool:
    return abs(sum(money(p) for p in parts) - money(total)) <= tolerance
