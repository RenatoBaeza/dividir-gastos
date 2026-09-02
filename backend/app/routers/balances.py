from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import load_group
from ..models import AppUser, ExchangeRate, Expense, Group
from ..schemas import BalanceRow, BalancesOut, TransferOut, UserOut
from ..services.balances import total_outstanding, transfer_count_saved
from ..services.ledger import group_ledger

router = APIRouter(prefix="/groups/{group_id}", tags=["balances"])


@router.get("/balances", response_model=BalancesOut)
def get_balances(
    group: Group = Depends(load_group), db: Session = Depends(get_db)
) -> BalancesOut:
    balances, pairwise, simplified = group_ledger(db, group)

    rows: list[BalanceRow] = []
    for uid, balance in balances.items():
        person = db.get(AppUser, uid)
        if person is None:
            continue
        rows.append(
            BalanceRow(
                user=UserOut.model_validate(person),
                paid=balance.paid,
                owed=balance.owed,
                settled_out=balance.settled_out,
                settled_in=balance.settled_in,
                net=balance.net,
            )
        )
    rows.sort(key=lambda r: (-r.net, r.user.display_name.lower()))

    # Currencies used by the group that have no manual rate yet. Writes reject
    # these, so it should stay empty, but surfacing it beats a silent wrong total.
    used = set(
        db.scalars(
            select(Expense.currency)
            .where(Expense.group_id == group.id, Expense.deleted_at.is_(None))
            .distinct()
        ).all()
    )
    known = set(
        db.scalars(
            select(ExchangeRate.currency).where(ExchangeRate.group_id == group.id)
        ).all()
    ) | {group.base_currency}
    missing = sorted(c for c in used if c not in known)

    nets = {uid: b.net for uid, b in balances.items()}

    return BalancesOut(
        group_id=group.id,
        base_currency=group.base_currency,
        balances=rows,
        pairwise=[
            TransferOut(from_user_id=t.from_user_id, to_user_id=t.to_user_id, amount=t.amount)
            for t in pairwise
        ],
        simplified=[
            TransferOut(from_user_id=t.from_user_id, to_user_id=t.to_user_id, amount=t.amount)
            for t in simplified
        ],
        transfers_saved=transfer_count_saved(pairwise, simplified),
        total_outstanding=total_outstanding(nets),
        missing_rates=missing,
    )
