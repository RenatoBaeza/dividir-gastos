import uuid
from decimal import Decimal

import pytest

from app.services.money import allocate, money
from app.services.splits import Item, Participant, SplitError, compute_splits

A, B, C = (uuid.uuid4() for _ in range(3))
D = Decimal


def amounts(splits):
    return {s.user_id: s.amount for s in splits}


def test_allocate_never_loses_a_cent():
    parts = allocate(D("10.00"), [D(1)] * 3)
    assert sum(parts) == D("10.00")
    assert sorted(parts) == [D("3.33"), D("3.33"), D("3.34")]


def test_equal_split_three_ways():
    splits = compute_splits("equal", D("10.00"), [Participant(A), Participant(B), Participant(C)])
    assert sum(s.amount for s in splits) == D("10.00")
    assert set(amounts(splits).values()) == {D("3.33"), D("3.34")}


def test_exact_split_must_match_the_total():
    with pytest.raises(SplitError):
        compute_splits(
            "exact",
            D("30.00"),
            [Participant(A, D("10.00")), Participant(B, D("15.00"))],
        )


def test_exact_split_accepted():
    splits = compute_splits(
        "exact", D("30.00"), [Participant(A, D("10.00")), Participant(B, D("20.00"))]
    )
    assert amounts(splits) == {A: D("10.00"), B: D("20.00")}


def test_percent_split():
    splits = compute_splits(
        "percent",
        D("200.00"),
        [Participant(A, D("25")), Participant(B, D("75"))],
    )
    assert amounts(splits) == {A: D("50.00"), B: D("150.00")}


def test_percent_must_total_100():
    with pytest.raises(SplitError):
        compute_splits(
            "percent", D("100.00"), [Participant(A, D("40")), Participant(B, D("40"))]
        )


def test_shares_split():
    splits = compute_splits(
        "shares",
        D("120.00"),
        [Participant(A, D("1")), Participant(B, D("2")), Participant(C, D("3"))],
    )
    assert amounts(splits) == {A: D("20.00"), B: D("40.00"), C: D("60.00")}


def test_itemised_receipt_spreads_tax_proportionally():
    # 40 of items, 44 charged: the extra 4 follows what each person consumed.
    splits = compute_splits(
        "items",
        D("44.00"),
        [],
        items=[
            Item("Pizza", D("30.00"), D(1), [A, B]),
            Item("Beer", D("10.00"), D(1), [B]),
        ],
    )
    assert amounts(splits) == {A: D("16.50"), B: D("27.50")}
    assert sum(amounts(splits).values()) == D("44.00")


def test_itemised_rejects_items_over_the_total():
    with pytest.raises(SplitError):
        compute_splits(
            "items",
            D("10.00"),
            [],
            items=[Item("Steak", D("50.00"), D(1), [A])],
        )


def test_itemised_needs_someone_on_every_line():
    with pytest.raises(SplitError):
        compute_splits("items", D("10.00"), [], items=[Item("Water", D("10.00"), D(1), [])])


def test_money_rounds_half_up():
    assert money("2.345") == D("2.35")
    assert money("2.344") == D("2.34")
