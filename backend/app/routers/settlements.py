from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..dependencies import log_activity, rate_for
from ..models import AppUser, Group, GroupMember, Settlement
from ..schemas import SettlementCreate, SettlementOut, SettlementUpdate
from ..services.money import convert, money

router = APIRouter(prefix="/settlements", tags=["settlements"])


def _group_for(db: Session, user: AppUser, group_id: uuid.UUID) -> Group:
    group = db.get(Group, group_id)
    if group is None or group.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    if db.get(GroupMember, (group_id, user.id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group


def _name(db: Session, user_id: uuid.UUID) -> str:
    person = db.get(AppUser, user_id)
    return person.display_name or person.email if person else "someone"


@router.get("", response_model=list[SettlementOut])
def list_settlements(
    group_id: uuid.UUID,
    limit: int = Query(default=200, le=500),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> list[SettlementOut]:
    _group_for(db, user, group_id)
    rows = db.scalars(
        select(Settlement)
        .where(Settlement.group_id == group_id, Settlement.deleted_at.is_(None))
        .order_by(Settlement.settled_on.desc(), Settlement.created_at.desc())
        .limit(limit)
    ).all()
    return [SettlementOut.model_validate(r) for r in rows]


@router.post("", response_model=SettlementOut, status_code=status.HTTP_201_CREATED)
def record_settlement(
    group_id: uuid.UUID,
    payload: SettlementCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> SettlementOut:
    group = _group_for(db, user, group_id)

    if payload.from_user_id == payload.to_user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A repayment needs two different people."
        )
    for uid in (payload.from_user_id, payload.to_user_id):
        if db.get(GroupMember, (group_id, uid)) is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Both people must be members of the group."
            )

    rate = rate_for(db, group, payload.currency)
    amount = money(payload.amount)

    settlement = Settlement(
        group_id=group_id,
        from_user_id=payload.from_user_id,
        to_user_id=payload.to_user_id,
        currency=payload.currency,
        amount=amount,
        rate_to_base=rate,
        amount_base=convert(amount, rate),
        method=payload.method,
        note=payload.note.strip(),
        settled_on=payload.settled_on,
        created_by=user.id,
    )
    db.add(settlement)

    where = "outside the app" if payload.method == "outside" else "in the app"
    log_activity(
        db,
        actor=user,
        group_id=group_id,
        action="created",
        entity_type="settlement",
        entity_id=settlement.id,
        summary=(
            f"recorded {_name(db, payload.from_user_id)} paying "
            f"{_name(db, payload.to_user_id)} {payload.currency} {amount} {where}"
        ),
        details={"amount": str(amount), "currency": payload.currency},
    )
    db.flush()
    return SettlementOut.model_validate(settlement)


@router.patch("/{settlement_id}", response_model=SettlementOut)
def update_settlement(
    settlement_id: uuid.UUID,
    payload: SettlementUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> SettlementOut:
    settlement = db.get(Settlement, settlement_id)
    if settlement is None or settlement.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repayment not found")
    group = _group_for(db, user, settlement.group_id)

    if payload.note is not None:
        settlement.note = payload.note.strip()
    if payload.method is not None:
        settlement.method = payload.method
    if payload.settled_on is not None:
        settlement.settled_on = payload.settled_on

    if payload.amount is not None or payload.currency is not None:
        settlement.currency = payload.currency or settlement.currency
        settlement.amount = money(payload.amount or settlement.amount)
        settlement.rate_to_base = rate_for(db, group, settlement.currency)
        settlement.amount_base = convert(settlement.amount, settlement.rate_to_base)

    settlement.updated_at = dt.datetime.now(dt.UTC)
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="updated",
        entity_type="settlement",
        entity_id=settlement.id,
        summary=(
            f"edited the repayment from {_name(db, settlement.from_user_id)} "
            f"to {_name(db, settlement.to_user_id)}"
        ),
    )
    db.flush()
    return SettlementOut.model_validate(settlement)


@router.delete("/{settlement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_settlement(
    settlement_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    settlement = db.get(Settlement, settlement_id)
    if settlement is None or settlement.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repayment not found")
    _group_for(db, user, settlement.group_id)

    settlement.deleted_at = dt.datetime.now(dt.UTC)
    log_activity(
        db,
        actor=user,
        group_id=settlement.group_id,
        action="deleted",
        entity_type="settlement",
        entity_id=settlement.id,
        summary=(
            f"deleted the repayment from {_name(db, settlement.from_user_id)} "
            f"to {_name(db, settlement.to_user_id)}"
        ),
    )
