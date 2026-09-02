from decimal import Decimal

import pytest

from app.services.money import ZERO, money
from app.services.splitwise import (
    ImportParseError,
    map_category,
    parse_amount,
    parse_export,
)

D = Decimal

# The shape Splitwise actually exports: a Spanish header, one column per member
# holding that member's net, then per-currency total rows at the bottom.
SAMPLE = """Fecha,Descripción,Categoría,Coste,Moneda,Renato Baeza,Pipi
2026-08-21,Soles,General,200000.00,CLP,100000.00,-100000.00
2026-08-27,Starbucks Aeropuerto,Restaurantes,19500.00,CLP,9750.00,-9750.00
2026-08-27,Yuno Tunupa,General,41180.00,CLP,-20590.00,20590.00

2026-09-01,Saldo total, , ,CLP,89160.00,-89160.00
"""


def parse(text=SAMPLE):
    return parse_export(text)


def entry(export, description):
    return next(e for e in export.entries if e.description == description)


# --------------------------------------------------------------------------
# Cells
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("19500.00", D("19500.00")),
        ("-9750.5", D("-9750.50")),
        ("$ 1.234,56", D("1234.56")),
        ("1,234.56", D("1234.56")),
        ("19,50", D("19.50")),
        ("1,234", D("1234.00")),
        ("", None),
        (" ", None),
        ("n/a", None),
    ],
)
def test_amounts_survive_symbols_and_either_separator(raw, expected):
    assert parse_amount(raw) == expected


def test_categories_map_from_either_language():
    assert map_category("Restaurantes") == "food"
    assert map_category("Dining out") == "food"
    assert map_category("Autobús/tren") == "transport"
    assert map_category("TV/teléfono/Internet") == "utilities"
    assert map_category("") == "general"
    assert map_category("Something Splitwise invented") == "general"


# --------------------------------------------------------------------------
# The file as a whole
# --------------------------------------------------------------------------
def test_header_names_the_members():
    assert parse().people == ["Renato Baeza", "Pipi"]


def test_total_rows_are_read_but_not_imported():
    export = parse()
    assert len(export.entries) == 3
    assert export.stated_totals["CLP"]["Renato Baeza"] == D("89160.00")


def test_nets_reconcile_with_the_total_splitwise_printed():
    export = parse()
    assert export.nets_by_currency()["CLP"] == {
        "Renato Baeza": D("89160.00"),
        "Pipi": D("-89160.00"),
    }
    assert export.warnings == []


def test_a_disagreeing_total_row_is_flagged():
    export = parse(SAMPLE.replace("89160.00,-89160.00", "70000.00,-70000.00"))
    assert any("do not" in w or "different" in w for w in export.warnings)


def test_rejects_a_file_that_is_not_an_export():
    with pytest.raises(ImportParseError):
        parse_export("name,email\nsomeone,someone@example.com\n")


def test_rejects_two_members_with_the_same_name():
    with pytest.raises(ImportParseError):
        parse_export("Fecha,D,C,Coste,Moneda,Ana,Ana\n2026-01-01,x,General,10,USD,5,-5\n")


# --------------------------------------------------------------------------
# Reconstructing payers and shares
# --------------------------------------------------------------------------
def test_single_payer_equal_split_is_recovered():
    row = entry(parse(), "Soles")
    assert row.kind == "expense"
    assert row.split_type == "equal"
    assert row.paid == {"Renato Baeza": D("200000.00"), "Pipi": ZERO}
    assert row.owed == {"Renato Baeza": D("100000.00"), "Pipi": D("100000.00")}


def test_the_other_member_paying_is_recovered_too():
    row = entry(parse(), "Yuno Tunupa")
    assert row.paid["Pipi"] == D("41180.00")
    assert row.owed == {"Renato Baeza": D("20590.00"), "Pipi": D("20590.00")}


def test_every_row_reproduces_its_nets_exactly():
    for row in parse().importable:
        for person in row.nets:
            assert money(row.paid[person] - row.owed[person]) == row.nets[person]
        assert sum(row.paid.values()) == row.amount
        assert sum(row.owed.values()) == row.amount


def test_uneven_split_stays_exact():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben,Cleo\n"
        "2026-01-01,Dinner,Dining out,90.00,EUR,60.00,-40.00,-20.00\n"
    )
    row = export.entries[0]
    assert row.split_type == "exact"
    assert row.paid == {"Ana": D("90.00"), "Ben": ZERO, "Cleo": ZERO}
    assert row.owed == {"Ana": D("30.00"), "Ben": D("40.00"), "Cleo": D("20.00")}


def test_two_payers_keep_every_share_at_or_above_zero():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben,Cleo\n"
        "2026-01-01,Hotel,Hotel,300.00,EUR,50.00,50.00,-100.00\n"
    )
    row = export.entries[0]
    assert row.category == "lodging"
    assert min(row.owed.values()) >= 0
    assert sum(row.paid.values()) == D("300.00")
    for person in row.nets:
        assert money(row.paid[person] - row.owed[person]) == row.nets[person]


def test_a_row_nobody_gained_or_lost_on_still_balances():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben\n"
        "2026-01-01,Two separate coffees,General,8.00,EUR,0.00,0.00\n"
    )
    row = export.entries[0]
    assert row.importable
    assert sum(row.owed.values()) == D("8.00")
    assert all(row.nets[p] == ZERO for p in row.nets)


# --------------------------------------------------------------------------
# Repayments
# --------------------------------------------------------------------------
def test_a_payment_row_becomes_a_repayment_from_the_positive_column():
    export = parse_export(
        "Fecha,Descripción,Categoría,Coste,Moneda,Ana,Ben\n"
        "2026-02-01,Pago,Pago,50.00,EUR,50.00,-50.00\n"
    )
    row = export.entries[0]
    assert row.kind == "settlement"
    assert (row.from_person, row.to_person) == ("Ana", "Ben")


def test_an_english_payment_row_is_recognised():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben\n"
        "2026-02-01,Payment,Payment,50.00,EUR,-50.00,50.00\n"
    )
    assert export.entries[0].kind == "settlement"
    assert export.entries[0].from_person == "Ben"


def test_a_payment_touching_three_people_falls_back_to_an_expense():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben,Cleo\n"
        "2026-02-01,Payment,Payment,60.00,EUR,40.00,20.00,-60.00\n"
    )
    assert export.entries[0].kind == "expense"


# --------------------------------------------------------------------------
# Rows we cannot use
# --------------------------------------------------------------------------
def test_a_row_whose_columns_do_not_balance_is_skipped_with_a_reason():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben\n"
        "2026-01-01,Lunch,General,20.00,EUR,10.00,-5.00\n"
    )
    assert export.importable == []
    assert "instead of zero" in export.entries[0].problem
    assert export.warnings


def test_an_unreadable_date_is_skipped():
    export = parse_export(
        "Date,Description,Category,Cost,Currency,Ana,Ben\n"
        "sometime,Lunch,General,20.00,EUR,10.00,-10.00\n"
    )
    assert export.importable == []
    assert "date" in export.entries[0].problem


def test_semicolon_delimited_exports_parse():
    export = parse_export(
        "Fecha;Descripción;Categoría;Coste;Moneda;Ana;Ben\n"
        "2026-01-01;Comida;General;20,00;EUR;10,00;-10,00\n"
    )
    assert export.entries[0].amount == D("20.00")
    assert export.entries[0].owed == {"Ana": D("10.00"), "Ben": D("10.00")}


# --------------------------------------------------------------------------
# What the import will actually store
# --------------------------------------------------------------------------
def test_the_imported_rows_reproduce_the_splitwise_balances():
    """The end the user cares about: after importing, the nets should be the
    ones Splitwise printed at the bottom of the file."""
    import uuid

    from app.services.balances import ExpenseFacts, compute_balances
    from app.services.splits import Participant, compute_splits

    export = parse()
    ids = {name: uuid.uuid4() for name in export.people}

    facts = []
    for row in export.importable:
        # Exactly what routers/imports.py builds for each row.
        participants = [
            Participant(
                ids[name], None if row.split_type == "equal" else row.owed[name]
            )
            for name in export.people
            if row.owed.get(name, ZERO) > 0
        ]
        splits = compute_splits(row.split_type, row.amount, participants)
        facts.append(
            ExpenseFacts(
                payers={ids[n]: a for n, a in row.paid.items() if a > 0},
                splits={s.user_id: s.amount for s in splits},
            )
        )

    balances = compute_balances(list(ids.values()), facts, [])
    stated = export.stated_totals["CLP"]
    for name, user_id in ids.items():
        assert balances[user_id].net == stated[name]
