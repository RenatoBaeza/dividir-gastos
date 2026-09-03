"""Bridge between the database rows and the pure balance functions."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Expense, Group, GroupMember, Settlement
from .balances import (
    ExpenseFacts,
    MemberBalance,
    SettlementFacts,
    Transfer,
    compute_balances,
    pairwise_debts,
    simplify_debts,
)


def group_facts(
    db: Session, group_id: uuid.UUID
) -> tuple[list[ExpenseFacts], list[SettlementFacts]]:
    """Every live expense and repayment in a group, in the base currency."""
    expenses = db.scalars(
        select(Expense).where(
            Expense.group_id == group_id, Expense.deleted_at.is_(None)
        )
    ).all()

    facts = [
        ExpenseFacts(
            payers={p.user_id: Decimal(p.amount_base) for p in e.payers},
            splits={s.user_id: Decimal(s.amount_base) for s in e.splits},
        )
        for e in expenses
    ]

    settlements = [
        SettlementFacts(s.from_user_id, s.to_user_id, Decimal(s.amount_base))
        for s in db.scalars(
            select(Settlement).where(
                Settlement.group_id == group_id, Settlement.deleted_at.is_(None)
            )
        ).all()
    ]

    return facts, settlements


def group_ledger(
    db: Session, group: Group
) -> tuple[dict[uuid.UUID, MemberBalance], list[Transfer], list[Transfer]]:
    """Net balances, the raw who-owes-whom list, and the simplified plan.

    Recomputed from scratch on every read, so adding an expense or recording a
    repayment automatically changes the settle-up plan with no extra bookkeeping.
    """
    members = list(
        db.scalars(
            select(GroupMember.user_id).where(GroupMember.group_id == group.id)
        ).all()
    )
    expenses, settlements = group_facts(db, group.id)

    balances = compute_balances(members, expenses, settlements)
    pairwise = pairwise_debts(expenses, settlements)
    simplified = simplify_debts({uid: b.net for uid, b in balances.items()})

    return balances, pairwise, simplified


def balances_for_groups(
    db: Session, group_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[uuid.UUID, MemberBalance]]:
    """Net balances for several groups at once.

    The dashboard needs one number per group, and doing that a group at a time
    means five round trips per row. This reads every group's members, expenses
    and repayments in three queries (plus the two SQLAlchemy issues eagerly for
    payers and splits) and does the arithmetic in memory.
    """
    if not group_ids:
        return {}

    members: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for gid, uid in db.execute(
        select(GroupMember.group_id, GroupMember.user_id).where(
            GroupMember.group_id.in_(group_ids)
        )
    ):
        members[gid].append(uid)

    expenses: dict[uuid.UUID, list[ExpenseFacts]] = defaultdict(list)
    for expense in db.scalars(
        select(Expense).where(
            Expense.group_id.in_(group_ids), Expense.deleted_at.is_(None)
        )
    ):
        expenses[expense.group_id].append(
            ExpenseFacts(
                payers={p.user_id: Decimal(p.amount_base) for p in expense.payers},
                splits={s.user_id: Decimal(s.amount_base) for s in expense.splits},
            )
        )

    settlements: dict[uuid.UUID, list[SettlementFacts]] = defaultdict(list)
    for row in db.scalars(
        select(Settlement).where(
            Settlement.group_id.in_(group_ids), Settlement.deleted_at.is_(None)
        )
    ):
        settlements[row.group_id].append(
            SettlementFacts(row.from_user_id, row.to_user_id, Decimal(row.amount_base))
        )

    return {
        gid: compute_balances(members[gid], expenses[gid], settlements[gid])
        for gid in group_ids
    }


def net_for_user(db: Session, group: Group, user_id: uuid.UUID) -> Decimal:
    balances, _, _ = group_ledger(db, group)
    balance = balances.get(user_id)
    return balance.net if balance else Decimal("0.00")
