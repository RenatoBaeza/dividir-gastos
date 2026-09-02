from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

Currency = Annotated[
    str, StringConstraints(min_length=3, max_length=3, to_upper=True, pattern=r"^[A-Za-z]{3}$")
]
SplitType = Literal["equal", "exact", "percent", "shares", "items"]
SettlementMethod = Literal["in_app", "outside"]

CATEGORIES = [
    "general",
    "food",
    "groceries",
    "rent",
    "utilities",
    "transport",
    "travel",
    "lodging",
    "entertainment",
    "shopping",
    "health",
    "gifts",
    "other",
]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------
class UserOut(ORMModel):
    id: uuid.UUID
    email: str
    display_name: str
    avatar_url: str | None = None


# --------------------------------------------------------------------------
# Groups
# --------------------------------------------------------------------------
class MemberOut(BaseModel):
    user: UserOut
    role: str
    joined_at: dt.datetime


class RateOut(ORMModel):
    currency: str
    rate_to_base: Decimal
    updated_at: dt.datetime


class RateUpsert(BaseModel):
    currency: Currency
    rate_to_base: Decimal = Field(gt=0)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    base_currency: Currency = "USD"


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    base_currency: Currency | None = None


class GroupOut(ORMModel):
    id: uuid.UUID
    name: str
    description: str
    base_currency: str
    created_by: uuid.UUID
    created_at: dt.datetime
    members: list[MemberOut] = []
    rates: list[RateOut] = []


class GroupSummary(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    base_currency: str
    member_count: int
    expense_count: int
    total_spend: Decimal
    your_net: Decimal


class InviteCreate(BaseModel):
    email: EmailStr


class InviteOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    email: str
    status: str
    invited_by: UserOut | None = None
    created_at: dt.datetime


# --------------------------------------------------------------------------
# Expenses
# --------------------------------------------------------------------------
class PayerIn(BaseModel):
    user_id: uuid.UUID
    amount: Decimal = Field(gt=0)


class ParticipantIn(BaseModel):
    user_id: uuid.UUID
    # exact amount / percentage / share count, depending on split_type
    value: Decimal | None = None


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    amount: Decimal = Field(ge=0)
    quantity: Decimal = Field(default=Decimal(1), gt=0)
    shared_with: list[uuid.UUID] = []


class ExpenseBase(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    notes: str = ""
    category: str = "general"
    currency: Currency = "USD"
    amount: Decimal = Field(gt=0)
    expense_date: dt.date = Field(default_factory=dt.date.today)


class ExpenseCreate(ExpenseBase):
    # null group_id records a personal expense that no one else sees
    group_id: uuid.UUID | None = None
    split_type: SplitType = "equal"
    payers: list[PayerIn] = []
    participants: list[ParticipantIn] = []
    items: list[ItemIn] = []


class ExpenseUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    category: str | None = None
    currency: Currency | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    expense_date: dt.date | None = None
    split_type: SplitType | None = None
    payers: list[PayerIn] | None = None
    participants: list[ParticipantIn] | None = None
    items: list[ItemIn] | None = None


class PayerOut(BaseModel):
    user_id: uuid.UUID
    amount: Decimal
    amount_base: Decimal


class SplitOut(BaseModel):
    user_id: uuid.UUID
    amount: Decimal
    amount_base: Decimal
    share_units: Decimal | None = None
    percent: Decimal | None = None


class ItemOut(BaseModel):
    id: uuid.UUID
    name: str
    amount: Decimal
    quantity: Decimal
    shared_with: list[uuid.UUID]


class ExpenseOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID | None
    owner_id: uuid.UUID | None
    description: str
    notes: str
    category: str
    currency: str
    amount: Decimal
    rate_to_base: Decimal
    amount_base: Decimal
    expense_date: dt.date
    split_type: str
    created_by: uuid.UUID
    created_at: dt.datetime
    updated_at: dt.datetime
    payers: list[PayerOut]
    splits: list[SplitOut]
    items: list[ItemOut]


# --------------------------------------------------------------------------
# Settlements
# --------------------------------------------------------------------------
class SettlementCreate(BaseModel):
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    currency: Currency = "USD"
    amount: Decimal = Field(gt=0)
    method: SettlementMethod = "in_app"
    note: str = ""
    settled_on: dt.date = Field(default_factory=dt.date.today)


class SettlementUpdate(BaseModel):
    currency: Currency | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    method: SettlementMethod | None = None
    note: str | None = None
    settled_on: dt.date | None = None


class SettlementOut(ORMModel):
    id: uuid.UUID
    group_id: uuid.UUID
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    currency: str
    amount: Decimal
    rate_to_base: Decimal
    amount_base: Decimal
    method: str
    note: str
    settled_on: dt.date
    created_by: uuid.UUID
    created_at: dt.datetime


# --------------------------------------------------------------------------
# Balances
# --------------------------------------------------------------------------
class BalanceRow(BaseModel):
    user: UserOut
    paid: Decimal
    owed: Decimal
    settled_out: Decimal
    settled_in: Decimal
    net: Decimal


class TransferOut(BaseModel):
    from_user_id: uuid.UUID
    to_user_id: uuid.UUID
    amount: Decimal


class BalancesOut(BaseModel):
    group_id: uuid.UUID
    base_currency: str
    balances: list[BalanceRow]
    pairwise: list[TransferOut]
    simplified: list[TransferOut]
    transfers_saved: int
    total_outstanding: Decimal
    missing_rates: list[str] = []


# --------------------------------------------------------------------------
# Splitwise import
# --------------------------------------------------------------------------
class ImportCsvIn(BaseModel):
    # The file arrives as text rather than as an upload: it is a few kilobytes
    # of CSV, and keeping the API JSON-only keeps the client simple.
    csv: str = Field(min_length=1, max_length=4_000_000)


class ImportPersonPreview(BaseModel):
    name: str
    # currency -> net, because rows in different currencies cannot be added up
    # until the group has a rate for them
    nets: dict[str, Decimal]
    stated_nets: dict[str, Decimal]
    suggested_email: str | None = None


class ImportCurrencyPreview(BaseModel):
    code: str
    count: int


class ImportEntryPreview(BaseModel):
    line: int
    kind: Literal["expense", "settlement"]
    expense_date: dt.date | None
    description: str
    category: str
    source_category: str
    currency: str
    amount: Decimal
    split_type: str
    paid: dict[str, Decimal] = {}
    owed: dict[str, Decimal] = {}
    from_person: str | None = None
    to_person: str | None = None
    problem: str | None = None


class ImportPreviewOut(BaseModel):
    people: list[ImportPersonPreview]
    currencies: list[ImportCurrencyPreview]
    suggested_base_currency: str
    first_date: dt.date | None
    last_date: dt.date | None
    expense_count: int
    settlement_count: int
    skipped_count: int
    entries: list[ImportEntryPreview]
    warnings: list[str]


class ImportPersonMap(BaseModel):
    name: str
    email: EmailStr


class SplitwiseImportIn(ImportCsvIn):
    # null creates a new group from group_name; otherwise the rows are added to
    # an existing group the caller belongs to
    group_id: uuid.UUID | None = None
    group_name: str = Field(default="", max_length=120)
    description: str = ""
    base_currency: Currency = "USD"
    rates: list[RateUpsert] = []
    people: list[ImportPersonMap]


class ImportResultOut(BaseModel):
    group_id: uuid.UUID
    group_name: str
    base_currency: str
    expenses_created: int
    settlements_created: int
    members_added: int
    duplicates_skipped: int
    rows_skipped: int
    warnings: list[str]


# --------------------------------------------------------------------------
# Activity
# --------------------------------------------------------------------------
class ActivityOut(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID | None
    actor: UserOut
    entity_type: str
    entity_id: uuid.UUID | None
    action: str
    summary: str
    details: dict
    created_at: dt.datetime
