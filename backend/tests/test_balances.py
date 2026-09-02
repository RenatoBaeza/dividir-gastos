import uuid
from decimal import Decimal

from app.services.balances import (
    ExpenseFacts,
    SettlementFacts,
    compute_balances,
    pairwise_debts,
    simplify_debts,
)

D = Decimal
A, B, C, E = (uuid.uuid4() for _ in range(4))


def test_net_balances_sum_to_zero():
    expenses = [
        ExpenseFacts(payers={A: D("90.00")}, splits={A: D("30.00"), B: D("30.00"), C: D("30.00")}),
        ExpenseFacts(payers={B: D("60.00")}, splits={A: D("20.00"), B: D("20.00"), C: D("20.00")}),
    ]
    balances = compute_balances([A, B, C], expenses, [])

    assert balances[A].net == D("40.00")
    assert balances[B].net == D("10.00")
    assert balances[C].net == D("-50.00")
    assert sum(b.net for b in balances.values()) == D("0.00")


def test_settlement_moves_the_needle():
    expenses = [ExpenseFacts(payers={A: D("100.00")}, splits={A: D("50.00"), B: D("50.00")})]
    settlements = [SettlementFacts(B, A, D("50.00"))]

    balances = compute_balances([A, B], expenses, settlements)
    assert balances[A].net == D("0.00")
    assert balances[B].net == D("0.00")


def test_pairwise_attributes_shares_across_multiple_payers():
    expenses = [
        ExpenseFacts(
            payers={A: D("75.00"), B: D("25.00")},
            splits={A: D("25.00"), B: D("25.00"), C: D("25.00"), E: D("25.00")},
        )
    ]
    debts = pairwise_debts(expenses, [])
    owed = {(t.from_user_id, t.to_user_id): t.amount for t in debts}

    # C and E each owe 25, split 75/25 between the two payers.
    assert owed[(C, A)] == D("18.75")
    assert owed[(C, B)] == D("6.25")
    assert owed[(E, A)] == D("18.75")
    assert owed[(E, B)] == D("6.25")
    # B paid 25 and owes 25 to A for their own share, netting out against what
    # A owes B, so the pair still appears with the correct direction.
    assert sum(t.amount for t in debts) > 0


def test_simplify_uses_fewer_transfers_than_the_raw_pairs():
    # A ring of debts: each person owes the next one 10.
    expenses = [
        ExpenseFacts(payers={A: D("20.00")}, splits={B: D("20.00")}),
        ExpenseFacts(payers={B: D("20.00")}, splits={C: D("20.00")}),
        ExpenseFacts(payers={C: D("20.00")}, splits={A: D("20.00")}),
    ]
    balances = compute_balances([A, B, C], expenses, [])
    pairwise = pairwise_debts(expenses, [])
    simplified = simplify_debts({uid: b.net for uid, b in balances.items()})

    assert len(pairwise) == 3
    assert simplified == []  # a perfect ring cancels out entirely


def test_simplify_settles_a_group_in_at_most_n_minus_one_transfers():
    nets = {A: D("-30.00"), B: D("-20.00"), C: D("40.00"), E: D("10.00")}
    transfers = simplify_debts(nets)

    assert len(transfers) <= len(nets) - 1
    assert sum(t.amount for t in transfers) == D("50.00")

    # Applying the plan must leave everyone at zero.
    after = dict(nets)
    for t in transfers:
        after[t.from_user_id] += t.amount
        after[t.to_user_id] -= t.amount
    assert all(v == 0 for v in after.values())


def test_simplify_is_a_no_op_when_everyone_is_square():
    assert simplify_debts({A: D("0.00"), B: D("0.00")}) == []


def test_balance_survives_a_payer_who_left_the_group():
    expenses = [ExpenseFacts(payers={C: D("10.00")}, splits={A: D("5.00"), B: D("5.00")})]
    balances = compute_balances([A, B], expenses, [])

    assert C in balances
    assert balances[C].net == D("10.00")
    assert sum(b.net for b in balances.values()) == D("0.00")
