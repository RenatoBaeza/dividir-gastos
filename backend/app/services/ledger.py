"""Bridge between the database rows and the pure balance functions."""

from __future__ import annotations

import uuid
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


def net_for_user(db: Session, group: Group, user_id: uuid.UUID) -> Decimal:
    balances, _, _ = group_ledger(db, group)
    balance = balances.get(user_id)
    return balance.net if balance else Decimal("0.00")
