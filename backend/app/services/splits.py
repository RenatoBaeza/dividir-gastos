"""Turn a split definition into a concrete per-person amount."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal

from .money import ZERO, allocate, money, sums_to


class SplitError(ValueError):
    """The submitted split cannot be reconciled with the expense total."""


@dataclass(frozen=True)
class Participant:
    user_id: uuid.UUID
    # exact amount, percentage or number of shares, depending on split_type
    value: Decimal | None = None


@dataclass(frozen=True)
class Item:
    name: str
    amount: Decimal
    quantity: Decimal
    shared_with: list[uuid.UUID]


@dataclass(frozen=True)
class ComputedSplit:
    user_id: uuid.UUID
    amount: Decimal
    share_units: Decimal | None = None
    percent: Decimal | None = None


def _values(participants: list[Participant], label: str) -> list[Decimal]:
    out: list[Decimal] = []
    for p in participants:
        if p.value is None:
            raise SplitError(f"Every participant needs a {label}.")
        out.append(Decimal(str(p.value)))
    return out


def compute_splits(
    split_type: str,
    total: Decimal,
    participants: list[Participant],
    items: list[Item] | None = None,
) -> list[ComputedSplit]:
    total = money(total)

    if split_type != "items" and not participants:
        raise SplitError("An expense needs at least one participant.")

    seen: set[uuid.UUID] = set()
    for p in participants:
        if p.user_id in seen:
            raise SplitError("A participant appears twice in the split.")
        seen.add(p.user_id)

    if split_type == "equal":
        amounts = allocate(total, [Decimal(1)] * len(participants))
        return [
            ComputedSplit(p.user_id, a) for p, a in zip(participants, amounts, strict=True)
        ]

    if split_type == "exact":
        values = _values(participants, "exact amount")
        if any(v < 0 for v in values):
            raise SplitError("Exact amounts cannot be negative.")
        if not sums_to(values, total):
            raise SplitError(
                f"Exact amounts add up to {sum(money(v) for v in values)}, "
                f"but the expense is {total}."
            )
        # Absorb any sub-cent drift so the stored splits always tie out.
        amounts = allocate(total, values)
        return [
            ComputedSplit(p.user_id, a) for p, a in zip(participants, amounts, strict=True)
        ]

    if split_type == "percent":
        values = _values(participants, "percentage")
        if any(v < 0 for v in values):
            raise SplitError("Percentages cannot be negative.")
        if abs(sum(values) - Decimal(100)) > Decimal("0.01"):
            raise SplitError(f"Percentages add up to {sum(values)}%, not 100%.")
        amounts = allocate(total, values)
        return [
            ComputedSplit(p.user_id, a, percent=v)
            for p, a, v in zip(participants, amounts, values, strict=True)
        ]

    if split_type == "shares":
        values = _values(participants, "number of shares")
        if any(v < 0 for v in values):
            raise SplitError("Share counts cannot be negative.")
        if sum(values) <= 0:
            raise SplitError("The shares must add up to more than zero.")
        amounts = allocate(total, values)
        return [
            ComputedSplit(p.user_id, a, share_units=v)
            for p, a, v in zip(participants, amounts, values, strict=True)
        ]

    if split_type == "items":
        return _split_by_items(total, items or [])

    raise SplitError(f"Unknown split type {split_type!r}.")


def _split_by_items(total: Decimal, items: list[Item]) -> list[ComputedSplit]:
    """Itemised receipts.

    Each line is divided equally among the people who shared it. Whatever is
    left over between the sum of the lines and the receipt total (tax, tip,
    service) is spread proportionally to what each person consumed.
    """
    if not items:
        raise SplitError("An itemised expense needs at least one item.")

    subtotals: dict[uuid.UUID, Decimal] = {}
    order: list[uuid.UUID] = []
    items_total = ZERO

    for item in items:
        if not item.shared_with:
            raise SplitError(f"Nobody is assigned to item {item.name!r}.")
        line_total = money(Decimal(str(item.amount)) * Decimal(str(item.quantity or 1)))
        items_total += line_total
        for user_id, share in zip(
            item.shared_with,
            allocate(line_total, [Decimal(1)] * len(item.shared_with)),
            strict=True,
        ):
            if user_id not in subtotals:
                subtotals[user_id] = ZERO
                order.append(user_id)
            subtotals[user_id] += share

    if items_total > total:
        raise SplitError(
            f"The items add up to {items_total}, more than the expense total of {total}."
        )

    amounts = allocate(total, [subtotals[u] for u in order])
    return [
        ComputedSplit(u, a, share_units=subtotals[u])
        for u, a in zip(order, amounts, strict=True)
    ]
