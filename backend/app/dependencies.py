from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import ActivityLog, AppUser, ExchangeRate, Group, GroupMember


class MissingRate(HTTPException):
    def __init__(self, currency: str, base: str) -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No exchange rate from {currency} to {base} yet. "
                f"Add one in the group's rate table first."
            ),
        )


def load_group(
    group_id: uuid.UUID = Path(...),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> Group:
    """Fetch a group the caller is a member of, or 404."""
    group = db.get(Group, group_id)
    if group is None or group.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")

    membership = db.get(GroupMember, (group_id, user.id))
    if membership is None:
        # Don't leak the existence of groups the caller has nothing to do with.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")

    return group


def require_owner(group: Group, user: AppUser, db: Session) -> None:
    membership = db.get(GroupMember, (group.id, user.id))
    if membership is None or membership.role != "owner":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only a group owner can do that."
        )


def member_ids(db: Session, group_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(GroupMember.user_id).where(GroupMember.group_id == group_id)
        ).all()
    )


def rate_for(db: Session, group: Group, currency: str) -> Decimal:
    """The manual rate that converts ``currency`` into the group base currency."""
    currency = currency.upper()
    if currency == group.base_currency.upper():
        return Decimal(1)

    rate = db.scalar(
        select(ExchangeRate).where(
            ExchangeRate.group_id == group.id, ExchangeRate.currency == currency
        )
    )
    if rate is None:
        raise MissingRate(currency, group.base_currency)
    return Decimal(rate.rate_to_base)


def log_activity(
    db: Session,
    *,
    actor: AppUser,
    action: str,
    entity_type: str,
    summary: str,
    group_id: uuid.UUID | None = None,
    entity_id: uuid.UUID | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        ActivityLog(
            group_id=group_id,
            actor_id=actor.id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            summary=summary,
            details=details or {},
        )
    )
