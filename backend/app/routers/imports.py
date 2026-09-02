"""Bring an existing Splitwise group into the app.

Two steps on purpose. ``/preview`` parses the file and hands back what it found
so the browser can show the damage before anything is written; ``/splitwise``
takes the same file plus a name-to-email mapping and creates the group, the
members, the expenses and the repayments in one transaction.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..dependencies import log_activity, rate_for
from ..models import (
    AppUser,
    ExchangeRate,
    Expense,
    ExpensePayer,
    ExpenseSplit,
    Group,
    GroupMember,
    Settlement,
)
from ..schemas import (
    ImportCsvIn,
    ImportCurrencyPreview,
    ImportEntryPreview,
    ImportPersonPreview,
    ImportPreviewOut,
    ImportResultOut,
    SplitwiseImportIn,
)
from ..services.money import ZERO, convert, money
from ..services.splits import Participant, SplitError, compute_splits
from ..services.splitwise import (
    Entry,
    ImportParseError,
    ParsedExport,
    normalise,
    parse_export,
)

router = APIRouter(prefix="/imports", tags=["imports"])


def _parse(text: str) -> ParsedExport:
    try:
        return parse_export(text)
    except ImportParseError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


def _known_people(db: Session, user: AppUser) -> list[AppUser]:
    """The caller plus everyone they already share a group with."""
    mine = select(GroupMember.group_id).where(GroupMember.user_id == user.id)
    others = db.scalars(
        select(AppUser)
        .join(GroupMember, GroupMember.user_id == AppUser.id)
        .where(GroupMember.group_id.in_(mine))
        .distinct()
    ).all()
    return [user, *(p for p in others if p.id != user.id)]


def _suggest_email(name: str, candidates: list[AppUser]) -> str | None:
    key = normalise(name)
    for person in candidates:
        if normalise(person.display_name) == key or normalise(
            person.email.split("@")[0]
        ) == key:
            return person.email
    return None


@router.post("/splitwise/preview", response_model=ImportPreviewOut)
def preview_splitwise(
    payload: ImportCsvIn,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> ImportPreviewOut:
    export = _parse(payload.csv)

    nets = export.nets_by_currency()
    counts = export.currency_counts()
    dates = [e.date for e in export.importable if e.date]
    candidates = _known_people(db, user)

    return ImportPreviewOut(
        people=[
            ImportPersonPreview(
                name=person,
                nets={c: nets[c].get(person, ZERO) for c in sorted(nets)},
                stated_nets={
                    c: totals.get(person, ZERO)
                    for c, totals in sorted(export.stated_totals.items())
                },
                suggested_email=_suggest_email(person, candidates),
            )
            for person in export.people
        ],
        currencies=[
            ImportCurrencyPreview(code=code, count=counts[code])
            for code in sorted(counts, key=lambda c: (-counts[c], c))
        ],
        # The currency most of the rows are already in needs no rate at all.
        suggested_base_currency=max(counts, key=lambda c: (counts[c], c), default="USD"),
        first_date=min(dates, default=None),
        last_date=max(dates, default=None),
        expense_count=sum(1 for e in export.importable if e.kind == "expense"),
        settlement_count=sum(1 for e in export.importable if e.kind == "settlement"),
        skipped_count=sum(1 for e in export.entries if not e.importable),
        entries=[_entry_preview(e) for e in export.entries],
        warnings=export.warnings,
    )


def _entry_preview(entry: Entry) -> ImportEntryPreview:
    return ImportEntryPreview(
        line=entry.line,
        kind=entry.kind,
        expense_date=entry.date,
        description=entry.description,
        category=entry.category,
        source_category=entry.source_category,
        currency=entry.currency,
        amount=entry.amount,
        split_type=entry.split_type,
        paid={p: a for p, a in entry.paid.items() if a != 0},
        owed={p: a for p, a in entry.owed.items() if a != 0},
        from_person=entry.from_person,
        to_person=entry.to_person,
        problem=entry.problem,
    )


# --------------------------------------------------------------------------
# Committing the import
# --------------------------------------------------------------------------
def _resolve_people(
    db: Session, export: ParsedExport, payload: SplitwiseImportIn
) -> dict[str, AppUser]:
    """Map every name in the file onto a row in ``app_users``."""
    mapped = {normalise(p.name): p for p in payload.people}
    missing = [name for name in export.people if normalise(name) not in mapped]
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"No email given for {', '.join(missing)}.",
        )

    emails = [mapped[normalise(n)].email.lower() for n in export.people]
    if len(set(emails)) != len(emails):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Two people in the export are mapped to the same email address.",
        )

    resolved: dict[str, AppUser] = {}
    for name in export.people:
        email = mapped[normalise(name)].email.lower()
        person = db.scalar(select(AppUser).where(AppUser.email == email))
        if person is None:
            # A stand-in row so the balances work now. Signing up with this
            # address later adopts it instead of creating a second user.
            person = AppUser(
                id=uuid.uuid5(uuid.NAMESPACE_URL, f"dividir-gastos:user:{email}"),
                email=email,
                display_name=name.strip(),
            )
            db.add(person)
            db.flush()
        resolved[name] = person
    return resolved


def _target_group(db: Session, user: AppUser, payload: SplitwiseImportIn) -> Group:
    """The group the rows go into, created on the spot if there isn't one."""
    if payload.group_id is None:
        if not payload.group_name.strip():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "The new group needs a name."
            )
        group = Group(
            name=payload.group_name.strip(),
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
        return group

    group = db.get(Group, payload.group_id)
    if group is None or group.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    if db.get(GroupMember, (group.id, user.id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group


def _ensure_rates(
    db: Session,
    group: Group,
    export: ParsedExport,
    payload: SplitwiseImportIn,
    warnings: list[str],
) -> None:
    stored = {
        r.currency: r
        for r in db.scalars(
            select(ExchangeRate).where(ExchangeRate.group_id == group.id)
        ).all()
    }
    supplied = {r.currency: r.rate_to_base for r in payload.rates}
    base = group.base_currency.upper()

    for currency in sorted(export.currency_counts()):
        if currency == base:
            continue
        if currency in stored:
            if currency in supplied and supplied[currency] != stored[currency].rate_to_base:
                # Rewriting it would silently reconvert the group's existing
                # expenses, so the stored rate wins and the caller is told.
                warnings.append(
                    f"The group already converts {currency} at "
                    f"{stored[currency].rate_to_base}; that rate was kept."
                )
            continue
        if currency not in supplied:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"The export has {currency} expenses but the group has no "
                f"{currency} to {base} rate. Add one and try again.",
            )
        db.add(
            ExchangeRate(
                group_id=group.id,
                currency=currency,
                rate_to_base=supplied[currency],
                updated_by=None,
            )
        )
    db.flush()


def _existing_keys(
    db: Session, group_id: uuid.UUID
) -> tuple[set[tuple], set[tuple]]:
    """Fingerprints of what the group already holds, to avoid double imports."""
    expenses = {
        (e.expense_date, normalise(e.description), e.currency, money(e.amount))
        for e in db.scalars(
            select(Expense).where(
                Expense.group_id == group_id, Expense.deleted_at.is_(None)
            )
        ).all()
    }
    settlements = {
        (s.settled_on, s.from_user_id, s.to_user_id, s.currency, money(s.amount))
        for s in db.scalars(
            select(Settlement).where(
                Settlement.group_id == group_id, Settlement.deleted_at.is_(None)
            )
        ).all()
    }
    return expenses, settlements


@router.post(
    "/splitwise", response_model=ImportResultOut, status_code=status.HTTP_201_CREATED
)
def import_splitwise(
    payload: SplitwiseImportIn,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> ImportResultOut:
    export = _parse(payload.csv)
    people = _resolve_people(db, export, payload)
    group = _target_group(db, user, payload)

    members_added = 0
    for person in people.values():
        if db.get(GroupMember, (group.id, person.id)) is None:
            db.add(GroupMember(group_id=group.id, user_id=person.id, role="member"))
            members_added += 1
    db.flush()

    warnings = list(export.warnings)
    _ensure_rates(db, group, export, payload, warnings)
    # Fingerprints of what the group held *before* this import. Rows created by
    # this run are deliberately not added to them: one export can legitimately
    # contain the same coffee twice on the same day, and both should land.
    known_expenses, known_settlements = _existing_keys(db, group.id)

    expenses_created = 0
    settlements_created = 0
    duplicates = 0

    for entry in export.importable:
        rate = rate_for(db, group, entry.currency)

        if entry.kind == "settlement":
            payer = people[entry.from_person]
            payee = people[entry.to_person]
            key = (entry.date, payer.id, payee.id, entry.currency, entry.amount)
            if key in known_settlements:
                duplicates += 1
                continue
            db.add(
                Settlement(
                    group_id=group.id,
                    from_user_id=payer.id,
                    to_user_id=payee.id,
                    currency=entry.currency,
                    amount=entry.amount,
                    rate_to_base=rate,
                    amount_base=convert(entry.amount, rate),
                    method="outside",
                    note=entry.description,
                    settled_on=entry.date,
                    created_by=user.id,
                )
            )
            settlements_created += 1
            continue

        key = (entry.date, normalise(entry.description), entry.currency, entry.amount)
        if key in known_expenses:
            duplicates += 1
            continue

        try:
            expense = _expense_from(entry, group, people, user, rate)
        except SplitError as exc:
            warnings.append(f"Line {entry.line} “{entry.description}”: {exc}")
            continue

        db.add(expense)
        expenses_created += 1

    db.flush()

    log_activity(
        db,
        actor=user,
        group_id=group.id,
        action="imported",
        entity_type="group",
        entity_id=group.id,
        summary=(
            f"imported {expenses_created} expense"
            f"{'' if expenses_created == 1 else 's'} and {settlements_created} "
            f"repayment{'' if settlements_created == 1 else 's'} "
            "from a Splitwise export"
        ),
        details={
            "source": "splitwise",
            "expenses": expenses_created,
            "settlements": settlements_created,
            "duplicates_skipped": duplicates,
            "people": {name: p.email for name, p in people.items()},
        },
    )
    db.flush()

    return ImportResultOut(
        group_id=group.id,
        group_name=group.name,
        base_currency=group.base_currency,
        expenses_created=expenses_created,
        settlements_created=settlements_created,
        members_added=members_added,
        duplicates_skipped=duplicates,
        rows_skipped=sum(1 for e in export.entries if not e.importable),
        warnings=warnings,
    )


def _expense_from(
    entry: Entry,
    group: Group,
    people: dict[str, AppUser],
    actor: AppUser,
    rate: Decimal,
) -> Expense:
    participants = [
        Participant(
            people[name].id,
            None if entry.split_type == "equal" else entry.owed[name],
        )
        for name in people
        if entry.owed.get(name, ZERO) > 0
    ]
    splits = compute_splits(entry.split_type, entry.amount, participants)

    expense = Expense(
        group_id=group.id,
        owner_id=None,
        description=entry.description,
        notes="",
        category=entry.category,
        currency=entry.currency,
        amount=entry.amount,
        rate_to_base=rate,
        amount_base=convert(entry.amount, rate),
        expense_date=entry.date,
        split_type=entry.split_type,
        created_by=actor.id,
    )
    expense.payers = [
        ExpensePayer(
            user_id=people[name].id,
            amount=amount,
            amount_base=convert(amount, rate),
        )
        for name, amount in entry.paid.items()
        if amount > 0
    ]
    expense.splits = [
        ExpenseSplit(
            user_id=split.user_id,
            amount=split.amount,
            amount_base=convert(split.amount, rate),
            share_units=split.share_units,
            percent=split.percent,
        )
        for split in splits
    ]
    return expense
