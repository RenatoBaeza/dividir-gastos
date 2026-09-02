"""Net balances, the pairwise ledger, and debt simplification.

Everything in here is pure: it takes plain amounts and returns plain amounts, so
the settle-up plan can be unit-tested without a database.
"""

from __future__ import annotations

import heapq
import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from .money import ZERO, allocate, money


@dataclass
class MemberBalance:
    user_id: uuid.UUID
    paid: Decimal = ZERO          # what they put on the table for shared expenses
    owed: Decimal = ZERO          # their share of those expenses
    settled_out: Decimal = ZERO   # repayments they made
    settled_in: Decimal = ZERO    # repayments they received

    @property
    def net(self) -> Decimal:
        """Positive means the group owes them; negative means they owe."""
        return money(self.paid - self.owed + self.settled_out - self.settled_in)


@dataclass
class Transfer:
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal


@dataclass
class ExpenseFacts:
    """One expense reduced to the only two things a balance cares about."""

    payers: dict[uuid.UUID, Decimal] = field(default_factory=dict)
    splits: dict[uuid.UUID, Decimal] = field(default_factory=dict)


@dataclass
class SettlementFacts:
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal


def compute_balances(
    member_ids: list[uuid.UUID],
    expenses: list[ExpenseFacts],
    settlements: list[SettlementFacts],
) -> dict[uuid.UUID, MemberBalance]:
    balances: dict[uuid.UUID, MemberBalance] = {
        uid: MemberBalance(uid) for uid in member_ids
    }

    def slot(uid: uuid.UUID) -> MemberBalance:
        # A member can leave the group after paying for something; their balance
        # still has to show up or the ledger stops adding to zero.
        if uid not in balances:
            balances[uid] = MemberBalance(uid)
        return balances[uid]

    for expense in expenses:
        for uid, amount in expense.payers.items():
            slot(uid).paid += money(amount)
        for uid, amount in expense.splits.items():
            slot(uid).owed += money(amount)

    for s in settlements:
        slot(s.from_user_id).settled_out += money(s.amount)
        slot(s.to_user_id).settled_in += money(s.amount)

    return balances


def pairwise_debts(
    expenses: list[ExpenseFacts], settlements: list[SettlementFacts]
) -> list[Transfer]:
    """Who owes whom before simplification, netted per pair."""
    ledger: dict[tuple[uuid.UUID, uuid.UUID], Decimal] = {}

    def add(debtor: uuid.UUID, creditor: uuid.UUID, amount: Decimal) -> None:
        if debtor == creditor or amount == 0:
            return
        key = (debtor, creditor)
        ledger[key] = ledger.get(key, ZERO) + amount

    for expense in expenses:
        total_paid = sum(expense.payers.values())
        if total_paid <= 0:
            continue
        payer_ids = list(expense.payers)
        for debtor, share in expense.splits.items():
            if share == 0:
                continue
            # Attribute each person's share across the payers in proportion to
            # what each of them actually paid.
            portions = allocate(share, [expense.payers[p] for p in payer_ids])
            for creditor, portion in zip(payer_ids, portions, strict=True):
                add(debtor, creditor, portion)

    for s in settlements:
        add(s.to_user_id, s.from_user_id, money(s.amount))

    out: list[Transfer] = []
    for (a, b) in {tuple(sorted(k, key=str)) for k in ledger}:
        net = ledger.get((a, b), ZERO) - ledger.get((b, a), ZERO)
        net = money(net)
        if net > 0:
            out.append(Transfer(a, b, net))
        elif net < 0:
            out.append(Transfer(b, a, -net))

    out.sort(key=lambda t: (-t.amount, str(t.from_user_id)))
    return out


def simplify_debts(nets: dict[uuid.UUID, Decimal]) -> list[Transfer]:
    """Minimum cash flow settle-up.

    Classic greedy: repeatedly match the largest debtor against the largest
    creditor. Each pass zeroes out at least one person, so a group of n members
    settles in at most n-1 transfers instead of one per outstanding pair.
    """
    debtors: list[tuple[Decimal, str, uuid.UUID]] = []
    creditors: list[tuple[Decimal, str, uuid.UUID]] = []

    for uid, raw in nets.items():
        net = money(raw)
        if net < 0:
            # heapq is a min-heap; negate so the biggest debt pops first.
            heapq.heappush(debtors, (net, str(uid), uid))
        elif net > 0:
            heapq.heappush(creditors, (-net, str(uid), uid))

    transfers: list[Transfer] = []
    while debtors and creditors:
        debt, _, debtor = heapq.heappop(debtors)
        credit, _, creditor = heapq.heappop(creditors)

        amount = min(-debt, -credit)
        if amount > 0:
            transfers.append(Transfer(debtor, creditor, money(amount)))

        remaining_debt = money(-debt - amount)
        remaining_credit = money(-credit - amount)
        if remaining_debt > 0:
            heapq.heappush(debtors, (-remaining_debt, str(debtor), debtor))
        if remaining_credit > 0:
            heapq.heappush(creditors, (-remaining_credit, str(creditor), creditor))

    transfers.sort(key=lambda t: (-t.amount, str(t.from_user_id)))
    return transfers


def transfer_count_saved(
    pairwise: list[Transfer], simplified: list[Transfer]
) -> int:
    return max(0, len(pairwise) - len(simplified))


def total_outstanding(nets: dict[uuid.UUID, Decimal]) -> Decimal:
    return money(sum(n for n in nets.values() if n > 0))

