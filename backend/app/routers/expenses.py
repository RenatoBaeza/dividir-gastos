from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..dependencies import log_activity, rate_for
from ..models import (
    AppUser,
    Expense,
    ExpenseItem,
    ExpenseItemShare,
    ExpensePayer,
    ExpenseSplit,
    Group,
    GroupMember,
)
from ..schemas import (
    CATEGORIES,
    ExpenseCreate,
    ExpenseOut,
    ExpenseUpdate,
    ItemIn,
    ItemOut,
    ParticipantIn,
    PayerIn,
    PayerOut,
    SplitOut,
)
from ..services.money import convert, money, sums_to
from ..services.splits import Item, Participant, SplitError, compute_splits

router = APIRouter(prefix="/expenses", tags=["expenses"])


# --------------------------------------------------------------------------
# Serialisation
# --------------------------------------------------------------------------
def _expense_out(expense: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=expense.id,
        group_id=expense.group_id,
        owner_id=expense.owner_id,
        description=expense.description,
        notes=expense.notes,
        category=expense.category,
        currency=expense.currency,
        amount=expense.amount,
        rate_to_base=expense.rate_to_base,
        amount_base=expense.amount_base,
        expense_date=expense.expense_date,
        split_type=expense.split_type,
        created_by=expense.created_by,
        created_at=expense.created_at,
        updated_at=expense.updated_at,
        payers=[
            PayerOut(user_id=p.user_id, amount=p.amount, amount_base=p.amount_base)
            for p in expense.payers
        ],
        splits=[
            SplitOut(
                user_id=s.user_id,
                amount=s.amount,
                amount_base=s.amount_base,
                share_units=s.share_units,
                percent=s.percent,
            )
            for s in expense.splits
        ],
        items=[
            ItemOut(
                id=i.id,
                name=i.name,
                amount=i.amount,
                quantity=i.quantity,
                shared_with=[sh.user_id for sh in i.shares],
            )
            for i in expense.items
        ],
    )


# --------------------------------------------------------------------------
# Access helpers
# --------------------------------------------------------------------------
def _group_for_write(db: Session, user: AppUser, group_id: uuid.UUID) -> Group:
    group = db.get(Group, group_id)
    if group is None or group.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    if db.get(GroupMember, (group_id, user.id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group


def _visible_expense(db: Session, user: AppUser, expense_id: uuid.UUID) -> Expense:
    expense = db.get(Expense, expense_id)
    if expense is None or expense.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")

    if expense.group_id is not None:
        if db.get(GroupMember, (expense.group_id, user.id)) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    elif expense.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")

    return expense


def _assert_members(db: Session, group_id: uuid.UUID, ids: set[uuid.UUID]) -> None:
    members = set(
        db.scalars(
            select(GroupMember.user_id).where(GroupMember.group_id == group_id)
        ).all()
    )
    stray = ids - members
    if stray:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Everyone on an expense has to be a member of the group.",
        )


# --------------------------------------------------------------------------
# The heart of it: turn a request into payer + split rows
# --------------------------------------------------------------------------
def _build_rows(
    db: Session,
    *,
    user: AppUser,
    group: Group | None,
    amount: Decimal,
    currency: str,
    split_type: str,
    payers: list[PayerIn],
    participants: list[ParticipantIn],
    items: list[ItemIn],
) -> tuple[Decimal, list[ExpensePayer], list[ExpenseSplit], list[ItemIn]]:
    amount = money(amount)
    rate = rate_for(db, group, currency) if group else Decimal(1)

    if group is None:
        # A personal expense is paid by, and owed entirely by, its owner.
        payer_rows = [
            ExpensePayer(user_id=user.id, amount=amount, amount_base=amount)
        ]
        split_rows = [ExpenseSplit(user_id=user.id, amount=amount, amount_base=amount)]
        return rate, payer_rows, split_rows, []

    if not payers:
        payers = [PayerIn(user_id=user.id, amount=amount)]
    if not participants and split_type in {"equal", "exact", "percent", "shares"}:
        participants = [
            ParticipantIn(user_id=uid)
            for uid in db.scalars(
                select(GroupMember.user_id)
                .where(GroupMember.group_id == group.id)
                .order_by(GroupMember.joined_at)
            ).all()
        ]

    involved = {p.user_id for p in payers} | {p.user_id for p in participants}
    for item in items:
        involved |= set(item.shared_with)
    _assert_members(db, group.id, involved)

    if len({p.user_id for p in payers}) != len(payers):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A payer is listed twice.")
    if not sums_to([p.amount for p in payers], amount):
        paid = sum(money(p.amount) for p in payers)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The payers add up to {paid}, but the expense is {amount}.",
        )

    try:
        computed = compute_splits(
            split_type,
            amount,
            [Participant(p.user_id, p.value) for p in participants],
            [
                Item(i.name, money(i.amount), Decimal(str(i.quantity)), list(i.shared_with))
                for i in items
            ],
        )
    except SplitError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    payer_amounts = [money(p.amount) for p in payers]
    payer_rows = [
        ExpensePayer(user_id=p.user_id, amount=a, amount_base=convert(a, rate))
        for p, a in zip(payers, payer_amounts, strict=True)
    ]
    split_rows = [
        ExpenseSplit(
            user_id=c.user_id,
            amount=c.amount,
            amount_base=convert(c.amount, rate),
            share_units=c.share_units,
            percent=c.percent,
        )
        for c in computed
    ]

    return rate, payer_rows, split_rows, items


def _replace_items(db: Session, expense: Expense, items: list[ItemIn]) -> None:
    for existing in list(expense.items):
        db.delete(existing)
    expense.items.clear()
    db.flush()

    for position, item in enumerate(items):
        row = ExpenseItem(
            expense_id=expense.id,
            name=item.name,
            amount=money(item.amount),
            quantity=Decimal(str(item.quantity)),
            position=position,
        )
        db.add(row)
        db.flush()
        for user_id in item.shared_with:
            db.add(ExpenseItemShare(item_id=row.id, user_id=user_id))


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@router.get("/personal", response_model=list[ExpenseOut])
def list_personal_expenses(
    limit: int = Query(default=100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> list[ExpenseOut]:
    expenses = db.scalars(
        select(Expense)
        .where(Expense.owner_id == user.id, Expense.deleted_at.is_(None))
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_expense_out(e) for e in expenses]


@router.get("", response_model=list[ExpenseOut])
def list_group_expenses(
    group_id: uuid.UUID,
    category: str | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> list[ExpenseOut]:
    _group_for_write(db, user, group_id)

    stmt = select(Expense).where(
        Expense.group_id == group_id, Expense.deleted_at.is_(None)
    )
    if category:
        stmt = stmt.where(Expense.category == category)
    if q:
        stmt = stmt.where(Expense.description.ilike(f"%{q}%"))

    expenses = db.scalars(
        stmt.order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_expense_out(e) for e in expenses]


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> ExpenseOut:
    if payload.category not in CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown category")

    group = _group_for_write(db, user, payload.group_id) if payload.group_id else None
    currency = payload.currency

    rate, payer_rows, split_rows, items = _build_rows(
        db,
        user=user,
        group=group,
        amount=payload.amount,
        currency=currency,
        split_type=payload.split_type,
        payers=payload.payers,
        participants=payload.participants,
        items=payload.items,
    )

    expense = Expense(
        group_id=group.id if group else None,
        owner_id=None if group else user.id,
        description=payload.description.strip(),
        notes=payload.notes.strip(),
        category=payload.category,
        currency=currency,
        amount=money(payload.amount),
        rate_to_base=rate,
        amount_base=convert(payload.amount, rate),
        expense_date=payload.expense_date,
        split_type=payload.split_type if group else "equal",
        created_by=user.id,
    )
    expense.payers = payer_rows
    expense.splits = split_rows
    db.add(expense)
    db.flush()

    if items:
        _replace_items(db, expense, items)

    log_activity(
        db,
        actor=user,
        group_id=expense.group_id,
        action="created",
        entity_type="expense",
        entity_id=expense.id,
        summary=f"added “{expense.description}” for {expense.currency} {expense.amount}",
        details={"amount": str(expense.amount), "currency": expense.currency},
    )
    db.flush()
    db.refresh(expense)
    return _expense_out(expense)


@router.get("/{expense_id}", response_model=ExpenseOut)
def get_expense(
    expense_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> ExpenseOut:
    return _expense_out(_visible_expense(db, user, expense_id))


@router.patch("/{expense_id}", response_model=ExpenseOut)
def update_expense(
    expense_id: uuid.UUID,
    payload: ExpenseUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> ExpenseOut:
    expense = _visible_expense(db, user, expense_id)
    group = db.get(Group, expense.group_id) if expense.group_id else None

    if payload.category is not None and payload.category not in CATEGORIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown category")

    before = {
        "description": expense.description,
        "amount": str(expense.amount),
        "currency": expense.currency,
        "split_type": expense.split_type,
    }

    for field in ("description", "notes", "category", "expense_date"):
        value = getattr(payload, field)
        if value is not None:
            setattr(expense, field, value.strip() if isinstance(value, str) else value)

    amount = money(payload.amount) if payload.amount is not None else expense.amount
    currency = payload.currency or expense.currency
    split_type = payload.split_type or expense.split_type

    # Any change to the money, the currency or the split has to regenerate the
    # payer and split rows; otherwise they would still describe the old expense.
    touches_split = any(
        v is not None
        for v in (
            payload.amount,
            payload.currency,
            payload.split_type,
            payload.payers,
            payload.participants,
            payload.items,
        )
    )

    if touches_split:
        payers = payload.payers
        if payers is None:
            payers = [PayerIn(user_id=p.user_id, amount=p.amount) for p in expense.payers]
            if payload.amount is not None and len(payers) == 1:
                payers = [PayerIn(user_id=payers[0].user_id, amount=amount)]

        participants = payload.participants
        if participants is None:
            participants = [
                ParticipantIn(
                    user_id=s.user_id,
                    value=(
                        s.percent
                        if split_type == "percent"
                        else s.share_units
                        if split_type == "shares"
                        else s.amount
                        if split_type == "exact"
                        else None
                    ),
                )
                for s in expense.splits
            ]

        items = payload.items
        if items is None:
            items = [
                ItemIn(
                    name=i.name,
                    amount=i.amount,
                    quantity=i.quantity,
                    shared_with=[sh.user_id for sh in i.shares],
                )
                for i in expense.items
            ]

        rate, payer_rows, split_rows, items = _build_rows(
            db,
            user=user,
            group=group,
            amount=amount,
            currency=currency,
            split_type=split_type,
            payers=payers,
            participants=participants,
            items=items,
        )

        # Payers and splits are keyed on (expense_id, user_id), so the old rows
        # have to be gone from the database before the new ones go in.
        for row in [*expense.payers, *expense.splits]:
            db.delete(row)
        expense.payers.clear()
        expense.splits.clear()
        db.flush()

        expense.payers.extend(payer_rows)
        expense.splits.extend(split_rows)
        expense.rate_to_base = rate
        expense.amount_base = convert(amount, rate)
        db.flush()

        if split_type == "items" or items:
            _replace_items(db, expense, items)

    expense.amount = amount
    expense.currency = currency
    expense.split_type = split_type if group else "equal"
    expense.updated_at = dt.datetime.now(dt.UTC)

    log_activity(
        db,
        actor=user,
        group_id=expense.group_id,
        action="updated",
        entity_type="expense",
        entity_id=expense.id,
        summary=f"edited “{expense.description}”",
        details={"before": before},
    )
    db.flush()
    db.refresh(expense)
    return _expense_out(expense)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(
    expense_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    expense = _visible_expense(db, user, expense_id)
    expense.deleted_at = dt.datetime.now(dt.UTC)
    log_activity(
        db,
        actor=user,
        group_id=expense.group_id,
        action="deleted",
        entity_type="expense",
        entity_id=expense.id,
        summary=f"deleted “{expense.description}”",
        details={"amount": str(expense.amount), "currency": expense.currency},
    )
