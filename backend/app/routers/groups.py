from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..dependencies import MissingRate, load_group, log_activity, require_owner
from ..models import (
    AppUser,
    ExchangeRate,
    Expense,
    Group,
    GroupInvite,
    GroupMember,
    Settlement,
)
from ..schemas import (
    GroupCreate,
    GroupOut,
    GroupSummary,
    GroupUpdate,
    InviteCreate,
    InviteOut,
    MemberOut,
    RateOut,
    RateUpsert,
)
from ..services.ledger import balances_for_groups, group_ledger
from ..services.money import ZERO, convert

router = APIRouter(prefix="/groups", tags=["groups"])


def _group_out(db: Session, group: Group) -> GroupOut:
    members = db.scalars(
        select(GroupMember)
        .where(GroupMember.group_id == group.id)
        .order_by(GroupMember.joined_at)
    ).all()
    rates = db.scalars(
        select(ExchangeRate)
        .where(ExchangeRate.group_id == group.id)
        .order_by(ExchangeRate.currency)
    ).all()

    return GroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        base_currency=group.base_currency,
        created_by=group.created_by,
        created_at=group.created_at,
        members=[
            MemberOut(user=m.user, role=m.role, joined_at=m.joined_at) for m in members
        ],
        rates=[RateOut.model_validate(r) for r in rates],
    )


@router.get("", response_model=list[GroupSummary])
def list_groups(
    db: Session = Depends(get_db), user: AppUser = Depends(current_user)
) -> list[GroupSummary]:
    """Every group the caller belongs to, with its headline numbers.

    Aggregates and ledgers are computed for all of the groups in one pass. Doing
    it per group is the obvious shape and costs five round trips per row, which
    is the difference between a fast dashboard and a slow one as soon as someone
    is in more than a handful of groups.
    """
    groups = db.scalars(
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == user.id, Group.deleted_at.is_(None))
        .order_by(Group.created_at.desc())
    ).all()
    if not groups:
        return []

    group_ids = [g.id for g in groups]

    member_counts = dict(
        db.execute(
            select(GroupMember.group_id, func.count())
            .where(GroupMember.group_id.in_(group_ids))
            .group_by(GroupMember.group_id)
        ).all()
    )
    spend = {
        gid: (count, Decimal(total or 0))
        for gid, count, total in db.execute(
            select(
                Expense.group_id,
                func.count(),
                func.coalesce(func.sum(Expense.amount_base), 0),
            )
            .where(Expense.group_id.in_(group_ids), Expense.deleted_at.is_(None))
            .group_by(Expense.group_id)
        ).all()
    }
    ledgers = balances_for_groups(db, group_ids)

    summaries: list[GroupSummary] = []
    for group in groups:
        expense_count, total_spend = spend.get(group.id, (0, ZERO))
        balance = ledgers.get(group.id, {}).get(user.id)

        summaries.append(
            GroupSummary(
                id=group.id,
                name=group.name,
                description=group.description,
                base_currency=group.base_currency,
                member_count=member_counts.get(group.id, 0),
                expense_count=expense_count,
                total_spend=total_spend,
                your_net=balance.net if balance else ZERO,
            )
        )

    return summaries


@router.post("", response_model=GroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> GroupOut:
    group = Group(
        name=payload.name.strip(),
        description=payload.description.strip(),
        base_currency=payload.base_currency,
        created_by=user.id,
    )
    db.add(group)
    db.flush()

    db.add(GroupMember(group_id=group.id, user_id=user.id, role="owner"))
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="created",
        entity_type="group",
        entity_id=group.id,
        summary=f"created the group “{group.name}”",
    )
    db.flush()

    return _group_out(db, group)


@router.get("/{group_id}", response_model=GroupOut)
def get_group(
    group: Group = Depends(load_group), db: Session = Depends(get_db)
) -> GroupOut:
    return _group_out(db, group)


@router.patch("/{group_id}", response_model=GroupOut)
def update_group(
    payload: GroupUpdate,
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> GroupOut:
    changes: list[str] = []

    if payload.name is not None and payload.name.strip() != group.name:
        changes.append(f"renamed it to “{payload.name.strip()}”")
        group.name = payload.name.strip()

    if payload.description is not None:
        group.description = payload.description.strip()

    if payload.base_currency is not None and payload.base_currency != group.base_currency:
        require_owner(group, user, db)
        old = group.base_currency
        group.base_currency = payload.base_currency
        db.flush()
        _reconvert_group(db, group)
        changes.append(f"switched the base currency from {old} to {group.base_currency}")

    group.updated_at = dt.datetime.now(dt.UTC)

    if changes:
        log_activity(
            db,
            actor=user,
            group_id=group.id,
            action="updated",
            entity_type="group",
            entity_id=group.id,
            summary=" and ".join(changes),
        )

    db.flush()
    return _group_out(db, group)


def _reconvert_group(db: Session, group: Group) -> None:
    """Re-run every stored base-currency amount against the new base currency.

    The converted amounts are denormalised, so changing the base currency has to
    rewrite them or the balances would silently drift.

    The rate table is read once up front: looking a rate up per row turns a
    currency switch into one query per expense, and this runs inside the request
    that changed the rate.
    """
    base = group.base_currency.upper()
    table = {
        r.currency.upper(): Decimal(r.rate_to_base)
        for r in db.scalars(
            select(ExchangeRate).where(ExchangeRate.group_id == group.id)
        )
    }

    def rate_of(currency: str) -> Decimal:
        currency = currency.upper()
        if currency == base:
            return Decimal(1)
        if currency not in table:
            raise MissingRate(currency, group.base_currency)
        return table[currency]

    expenses = db.scalars(select(Expense).where(Expense.group_id == group.id)).all()
    for expense in expenses:
        rate = rate_of(expense.currency)
        expense.rate_to_base = rate
        expense.amount_base = convert(expense.amount, rate)
        for payer in expense.payers:
            payer.amount_base = convert(payer.amount, rate)
        for split in expense.splits:
            split.amount_base = convert(split.amount, rate)

    settlements = db.scalars(
        select(Settlement).where(Settlement.group_id == group.id)
    ).all()
    for settlement in settlements:
        rate = rate_of(settlement.currency)
        settlement.rate_to_base = rate
        settlement.amount_base = convert(settlement.amount, rate)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    require_owner(group, user, db)
    group.deleted_at = dt.datetime.now(dt.UTC)
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="deleted",
        entity_type="group",
        entity_id=group.id,
        summary=f"deleted the group “{group.name}”",
    )


# --------------------------------------------------------------------------
# Members
# --------------------------------------------------------------------------
@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: uuid.UUID,
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    if user_id != user.id:
        require_owner(group, user, db)

    membership = db.get(GroupMember, (group.id, user_id))
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member of this group")

    balances, _, _ = group_ledger(db, group)
    balance = balances.get(user_id)
    if balance is not None and balance.net != 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "That member still has an outstanding balance. Settle up first.",
        )

    owners = db.scalar(
        select(func.count())
        .select_from(GroupMember)
        .where(GroupMember.group_id == group.id, GroupMember.role == "owner")
    )
    if membership.role == "owner" and (owners or 0) <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A group needs at least one owner. Promote someone else first.",
        )

    target = db.get(AppUser, user_id)
    db.delete(membership)
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="removed",
        entity_type="member",
        entity_id=user_id,
        summary=(
            "left the group"
            if user_id == user.id
            else f"removed {target.display_name if target else 'a member'}"
        ),
    )


# --------------------------------------------------------------------------
# Invites
# --------------------------------------------------------------------------
@router.get("/{group_id}/invites", response_model=list[InviteOut])
def list_invites(
    group: Group = Depends(load_group), db: Session = Depends(get_db)
) -> list[InviteOut]:
    invites = db.scalars(
        select(GroupInvite)
        .where(GroupInvite.group_id == group.id, GroupInvite.status == "pending")
        .order_by(GroupInvite.created_at.desc())
    ).all()

    return [
        InviteOut(
            id=i.id,
            group_id=group.id,
            group_name=group.name,
            email=i.email,
            status=i.status,
            invited_by=db.get(AppUser, i.invited_by),
            created_at=i.created_at,
        )
        for i in invites
    ]


@router.post(
    "/{group_id}/invites", response_model=InviteOut, status_code=status.HTTP_201_CREATED
)
def invite_member(
    payload: InviteCreate,
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> InviteOut:
    email = payload.email.lower()

    existing_user = db.scalar(select(AppUser).where(AppUser.email == email))
    if existing_user and db.get(GroupMember, (group.id, existing_user.id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That person is already in the group."
        )

    pending = db.scalar(
        select(GroupInvite).where(
            GroupInvite.group_id == group.id,
            func.lower(GroupInvite.email) == email,
            GroupInvite.status == "pending",
        )
    )
    if pending:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "There is already a pending invite for that email."
        )

    invite = GroupInvite(group_id=group.id, email=email, invited_by=user.id)
    db.add(invite)
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="invited",
        entity_type="invite",
        summary=f"invited {email}",
        details={"email": email},
    )
    db.flush()

    return InviteOut(
        id=invite.id,
        group_id=group.id,
        group_name=group.name,
        email=invite.email,
        status=invite.status,
        invited_by=user,
        created_at=invite.created_at,
    )


@router.delete(
    "/{group_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT
)
def revoke_invite(
    invite_id: uuid.UUID,
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    invite = db.get(GroupInvite, invite_id)
    if invite is None or invite.group_id != group.id or invite.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")

    invite.status = "revoked"
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="revoked",
        entity_type="invite",
        entity_id=invite.id,
        summary=f"revoked the invite for {invite.email}",
    )


# --------------------------------------------------------------------------
# Manual exchange rates
# --------------------------------------------------------------------------
@router.get("/{group_id}/rates", response_model=list[RateOut])
def list_rates(
    group: Group = Depends(load_group), db: Session = Depends(get_db)
) -> list[RateOut]:
    rates = db.scalars(
        select(ExchangeRate)
        .where(ExchangeRate.group_id == group.id)
        .order_by(ExchangeRate.currency)
    ).all()
    return [RateOut.model_validate(r) for r in rates]


@router.put("/{group_id}/rates", response_model=RateOut)
def upsert_rate(
    payload: RateUpsert,
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> RateOut:
    if payload.currency == group.base_currency:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The base currency is always 1 and cannot be overridden.",
        )

    rate = db.scalar(
        select(ExchangeRate).where(
            ExchangeRate.group_id == group.id,
            ExchangeRate.currency == payload.currency,
        )
    )
    if rate is None:
        rate = ExchangeRate(
            group_id=group.id,
            currency=payload.currency,
            rate_to_base=payload.rate_to_base,
            updated_by=user.id,
        )
        db.add(rate)
    else:
        rate.rate_to_base = payload.rate_to_base
        rate.updated_by = user.id
        rate.updated_at = dt.datetime.now(dt.UTC)

    db.flush()
    # Existing rows were converted with the old rate; bring them up to date.
    _reconvert_group(db, group)

    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="updated",
        entity_type="rate",
        summary=(
            f"set 1 {payload.currency} = {payload.rate_to_base} {group.base_currency}"
        ),
        details={"currency": payload.currency, "rate": str(payload.rate_to_base)},
    )
    db.flush()
    return RateOut.model_validate(rate)


@router.delete("/{group_id}/rates/{currency}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rate(
    currency: str,
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    currency = currency.upper()
    rate = db.scalar(
        select(ExchangeRate).where(
            ExchangeRate.group_id == group.id, ExchangeRate.currency == currency
        )
    )
    if rate is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rate not found")

    in_use = db.scalar(
        select(func.count())
        .select_from(Expense)
        .where(
            Expense.group_id == group.id,
            Expense.currency == currency,
            Expense.deleted_at.is_(None),
        )
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{in_use} expense(s) still use {currency}; the rate has to stay.",
        )

    db.delete(rate)
    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="deleted",
        entity_type="rate",
        summary=f"removed the {currency} rate",
    )

