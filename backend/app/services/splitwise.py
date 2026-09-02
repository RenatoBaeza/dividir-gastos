"""Read a Splitwise group CSV export.

The export is a per-expense ledger: five fixed columns (date, description,
category, cost, currency) followed by one column per member holding that
member's *net* for that row — what they paid minus what they owed. Who actually
put the money down, and how the bill was divided, are not in the file.

So this module reconstructs a payer/share breakdown that reproduces exactly the
same nets, which is all a balance depends on. Where the file is ambiguous the
reconstruction picks the reading that keeps every share at or above zero; the
per-person nets, and therefore the settle-up plan, come out identical either
way.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from .money import ZERO, money

# Splitwise writes the header in the account's language, so the five leading
# columns are recognised by position rather than by name.
FIXED_COLUMNS = 5

# The trailing rows of an export restate each member's balance per currency.
_TOTAL_LABELS = {
    "total balance",
    "saldo total",
    "saldo totale",
    "solde total",
    "gesamtsaldo",
    "totaal saldo",
    "balanco total",
}

_PAYMENT_LABELS = {"payment", "pago", "pagamento", "paiement", "zahlung", "betaling"}

_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d")

# Splitwise's own category names (English and Spanish) mapped onto the
# vocabulary in schemas.CATEGORIES. Anything unrecognised falls back to
# "general", which is what Splitwise itself calls an uncategorised expense.
_CATEGORY_MAP = {
    "general": "general",
    "uncategorized": "general",
    "sin categoria": "general",
    # food and drink
    "dining out": "food",
    "restaurantes": "food",
    "restaurante": "food",
    "comida": "food",
    "food and drink": "food",
    "comida y bebida": "food",
    "liquor": "food",
    "licor": "food",
    "groceries": "groceries",
    "comestibles": "groceries",
    "supermercado": "groceries",
    # home
    "rent": "rent",
    "alquiler": "rent",
    "arriendo": "rent",
    "mortgage": "rent",
    "hipoteca": "rent",
    "household supplies": "shopping",
    "suministros del hogar": "shopping",
    "furniture": "shopping",
    "muebles": "shopping",
    "electronics": "shopping",
    "electronica": "shopping",
    "maintenance": "utilities",
    "mantenimiento": "utilities",
    "services": "utilities",
    "servicios": "utilities",
    "pets": "other",
    "mascotas": "other",
    # utilities
    "electricity": "utilities",
    "electricidad": "utilities",
    "heat/gas": "utilities",
    "calefaccion/gas": "utilities",
    "water": "utilities",
    "agua": "utilities",
    "trash": "utilities",
    "basura": "utilities",
    "tv/phone/internet": "utilities",
    "tv/telefono/internet": "utilities",
    "cleaning": "utilities",
    "limpieza": "utilities",
    # transport
    "taxi": "transport",
    "bus/train": "transport",
    "autobus/tren": "transport",
    "car": "transport",
    "coche": "transport",
    "auto": "transport",
    "gas/fuel": "transport",
    "gasolina/combustible": "transport",
    "parking": "transport",
    "estacionamiento": "transport",
    "bicycle": "transport",
    "bicicleta": "transport",
    "transportation": "transport",
    "transporte": "transport",
    "plane": "travel",
    "avion": "travel",
    "hotel": "lodging",
    "lodging": "lodging",
    "alojamiento": "lodging",
    # life
    "entertainment": "entertainment",
    "entretenimiento": "entertainment",
    "ocio": "entertainment",
    "games": "entertainment",
    "juegos": "entertainment",
    "movies": "entertainment",
    "peliculas": "entertainment",
    "music": "entertainment",
    "musica": "entertainment",
    "sports": "entertainment",
    "deportes": "entertainment",
    "clothing": "shopping",
    "ropa": "shopping",
    "shopping": "shopping",
    "compras": "shopping",
    "gifts": "gifts",
    "regalos": "gifts",
    "medical expenses": "health",
    "gastos medicos": "health",
    "medical": "health",
    "salud": "health",
    "insurance": "other",
    "seguro": "other",
    "taxes": "other",
    "impuestos": "other",
    "education": "other",
    "educacion": "other",
    "childcare": "other",
    "cuidado infantil": "other",
    "other": "other",
    "otro": "other",
    "otros": "other",
}


class ImportParseError(ValueError):
    """The file is not a Splitwise export we can read at all."""


def normalise(value: str) -> str:
    """Lower-cased, accent-stripped, whitespace-collapsed."""
    stripped = "".join(
        ch
        for ch in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(ch)
    )
    return re.sub(r"\s+", " ", stripped).strip().lower()


def map_category(source: str) -> str:
    key = normalise(source)
    if not key:
        return "general"
    if key in _CATEGORY_MAP:
        return _CATEGORY_MAP[key]
    # Some locales nest the category ("Transporte > Taxi").
    for part in reversed(re.split(r"[>|]", key)):
        if part.strip() in _CATEGORY_MAP:
            return _CATEGORY_MAP[part.strip()]
    return "general"


def parse_amount(raw: str) -> Decimal | None:
    """Read a number out of a cell, tolerating symbols and either separator."""
    text = re.sub(r"[^0-9,.\-+]", "", (raw or "").strip())
    if not text or text in {"-", "+", ".", ","}:
        return None

    if "," in text and "." in text:
        # Whichever separator comes last is the decimal point.
        decimal_sep = "," if text.rindex(",") > text.rindex(".") else "."
        text = text.replace("." if decimal_sep == "," else ",", "")
        text = text.replace(decimal_sep, ".")
    elif "," in text:
        # "19,50" is a decimal comma; "1,234" is a thousands separator.
        text = (
            text.replace(",", ".")
            if text.count(",") == 1 and re.search(r",\d{1,2}$", text)
            else text.replace(",", "")
        )

    try:
        return money(Decimal(text))
    except (InvalidOperation, ArithmeticError):
        return None


def parse_date(raw: str) -> dt.date | None:
    text = (raw or "").strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    return None


@dataclass
class Entry:
    """One line of the export."""

    line: int
    kind: str  # "expense" | "settlement"
    description: str
    source_category: str
    category: str
    currency: str
    amount: Decimal
    date: dt.date | None
    nets: dict[str, Decimal] = field(default_factory=dict)
    paid: dict[str, Decimal] = field(default_factory=dict)
    owed: dict[str, Decimal] = field(default_factory=dict)
    split_type: str = "exact"
    from_person: str | None = None
    to_person: str | None = None
    problem: str | None = None

    @property
    def importable(self) -> bool:
        return self.problem is None


@dataclass
class ParsedExport:
    people: list[str]
    entries: list[Entry]
    warnings: list[str] = field(default_factory=list)
    # currency -> person -> the balance Splitwise itself printed at the bottom
    stated_totals: dict[str, dict[str, Decimal]] = field(default_factory=dict)

    @property
    def importable(self) -> list[Entry]:
        return [e for e in self.entries if e.importable]

    def currency_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for entry in self.importable:
            counts[entry.currency] = counts.get(entry.currency, 0) + 1
        return counts

    def nets_by_currency(self) -> dict[str, dict[str, Decimal]]:
        """Net per person per currency, over the rows we can actually import.

        Kept per currency rather than summed: until the group's rate table says
        otherwise, pesos and dollars are not addable.
        """
        totals: dict[str, dict[str, Decimal]] = {}
        for entry in self.importable:
            bucket = totals.setdefault(entry.currency, {p: ZERO for p in self.people})
            for person, value in entry.nets.items():
                bucket[person] += value
        return {c: {p: money(v) for p, v in b.items()} for c, b in totals.items()}


def _sniff_delimiter(header_line: str) -> str:
    return max(",;\t", key=header_line.count)


def _reconstruct(
    amount: Decimal, nets: dict[str, Decimal], people: list[str]
) -> tuple[dict[str, Decimal], dict[str, Decimal], str, str | None]:
    """Turn per-person nets back into payments and shares.

    Everyone with a positive net is credited at least what they came out ahead
    by, and the person owed the most covers whatever is left of the bill. That
    keeps every share at or above zero and reproduces the nets exactly.
    """
    credits = {p: n for p, n in nets.items() if n > 0}
    total_credit = money(sum(credits.values(), ZERO))
    paid = {p: ZERO for p in people}

    if total_credit == 0:
        # Nobody came out ahead, so everyone covered their own share. Any single
        # payer reproduces that; pick the first person for a stable result.
        paid[people[0]] = amount
    elif total_credit > amount:
        return (
            {},
            {},
            "exact",
            (
                f"the members are owed {total_credit} between them, more than "
                f"the {amount} the row costs"
            ),
        )
    else:
        lead = max(people, key=lambda p: (credits.get(p, ZERO), -people.index(p)))
        for person, credit in credits.items():
            paid[person] = credit
        paid[lead] = money(paid[lead] + amount - total_credit)

    owed = {p: money(paid[p] - nets[p]) for p in people}

    shares = [owed[p] for p in people if owed[p] > 0]
    split_type = "equal" if shares and len(set(shares)) == 1 else "exact"
    return paid, owed, split_type, None


def _settlement_ends(nets: dict[str, Decimal]) -> tuple[str | None, str | None]:
    """Who paid whom on a repayment row.

    Handing money over improves your balance, so the payer's column is the
    positive one and the receiver's the negative one.
    """
    givers = [p for p, n in nets.items() if n > 0]
    receivers = [p for p, n in nets.items() if n < 0]
    if len(givers) == 1 and len(receivers) == 1:
        return givers[0], receivers[0]
    return None, None


def parse_export(text: str) -> ParsedExport:
    """Parse a whole export. Raises ImportParseError if it is not readable."""
    text = text.lstrip("﻿")
    if not text.strip():
        raise ImportParseError("The file is empty.")

    rows = list(
        csv.reader(io.StringIO(text), delimiter=_sniff_delimiter(text.splitlines()[0]))
    )
    header = [cell.strip() for cell in rows[0]]
    if len(header) <= FIXED_COLUMNS:
        raise ImportParseError(
            "This does not look like a Splitwise export: the header should have "
            "date, description, category, cost and currency columns followed by "
            "one column per person."
        )

    people = [name for name in header[FIXED_COLUMNS:] if name]
    if not people:
        raise ImportParseError("The export does not name anybody.")
    if len(set(people)) != len(people):
        raise ImportParseError(
            "Two people in the export share a name, so their columns cannot be "
            "told apart. Rename one of them in Splitwise and export again."
        )

    warnings: list[str] = []
    entries: list[Entry] = []
    stated_totals: dict[str, dict[str, Decimal]] = {}

    for index, raw_row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in raw_row):
            continue

        row = [cell.strip() for cell in raw_row] + [""] * (len(header) - len(raw_row))
        description = row[1]
        currency = row[4].upper()[:3]
        nets = {
            person: parse_amount(row[FIXED_COLUMNS + i]) or ZERO
            for i, person in enumerate(people)
        }

        if normalise(description) in _TOTAL_LABELS:
            if currency:
                stated_totals[currency] = nets
            continue

        if len(raw_row) < FIXED_COLUMNS + len(people):
            warnings.append(f"Line {index}: fewer columns than the header — skipped.")
            continue

        is_payment = (
            normalise(row[2]) in _PAYMENT_LABELS
            or normalise(description) in _PAYMENT_LABELS
        )
        entry = Entry(
            line=index,
            kind="settlement" if is_payment else "expense",
            description=description or "(no description)",
            source_category=row[2],
            category=map_category(row[2]),
            currency=currency,
            amount=parse_amount(row[3]) or ZERO,
            date=parse_date(row[0]),
            nets=nets,
        )
        net_sum = money(sum(nets.values(), ZERO))

        if entry.date is None:
            entry.problem = f"unreadable date {row[0]!r}"
        elif len(currency) != 3 or not currency.isalpha():
            entry.problem = f"unreadable currency {row[4]!r}"
        elif entry.amount <= 0:
            entry.problem = f"the cost {row[3]!r} is not a positive amount"
        elif abs(net_sum) > Decimal("0.01") * len(people):
            entry.problem = f"the member columns add up to {net_sum} instead of zero"
        elif entry.kind == "settlement":
            entry.from_person, entry.to_person = _settlement_ends(nets)
            if entry.from_person is None:
                # A repayment has exactly one giver and one receiver. If this one
                # does not, treat it as an ordinary expense instead of guessing.
                entry.kind = "expense"

        if entry.problem is None and entry.kind == "expense":
            (
                entry.paid,
                entry.owed,
                entry.split_type,
                entry.problem,
            ) = _reconstruct(entry.amount, nets, people)

        if entry.problem:
            warnings.append(f"Line {index} “{entry.description}”: {entry.problem}.")

        entries.append(entry)

    if not entries:
        raise ImportParseError("The export has a header but no expenses.")

    export = ParsedExport(
        people=people,
        entries=entries,
        stated_totals=stated_totals,
        warnings=warnings,
    )
    export.warnings.extend(_reconciliation_warnings(export))
    return export


def _reconciliation_warnings(export: ParsedExport) -> list[str]:
    """Check our per-currency nets against the totals Splitwise printed."""
    out: list[str] = []
    computed = export.nets_by_currency()
    for currency, stated in export.stated_totals.items():
        ours = computed.get(currency, {p: ZERO for p in export.people})
        off = [
            f"{p} ({money(ours[p])} vs {money(stated.get(p, ZERO))})"
            for p in export.people
            if abs(money(ours[p]) - money(stated.get(p, ZERO))) > Decimal("0.01")
        ]
        if off:
            out.append(
                f"The {currency} balances come out different from the total "
                f"Splitwise printed for {', '.join(off)}. Rows that could not be "
                "read are the usual reason."
            )
    return out
