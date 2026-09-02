"""End-to-end check against a real database.

Drives the API through FastAPI's TestClient with AUTH_DEV_MODE, so it exercises
the routers, the SQL schema and the balance maths together — the parts the unit
tests deliberately leave out. It creates a throwaway group and deletes it again.

    AUTH_DEV_MODE=true python scripts/smoke.py
"""

from __future__ import annotations

import pathlib
import sys
from decimal import Decimal

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

ANA = "ana@example.com"
BEN = "ben@example.com"
CIA = "cia@example.com"
DEE = "dee@example.com"  # only ever exists as an import placeholder

# A Splitwise export in miniature: Spanish header, one net column per member,
# a repayment row, and the per-currency totals Splitwise prints at the bottom.
SPLITWISE_CSV = """Fecha,Descripcion,Categoria,Coste,Moneda,Ana,Dee
2026-03-01,Cena,Restaurantes,80.00,EUR,40.00,-40.00
2026-03-02,Taxi,Taxi,30.00,EUR,-15.00,15.00
2026-03-03,Pago,Pago,10.00,EUR,-10.00,10.00

2026-03-04,Saldo total, , ,EUR,15.00,-15.00
"""

client = TestClient(app)
failures: list[str] = []


def as_(email: str) -> dict[str, str]:
    return {"Authorization": f"Dev {email}"}


def call(method: str, path: str, email: str, **kwargs):
    response = client.request(method, path, headers=as_(email), **kwargs)
    if response.status_code >= 400:
        raise SystemExit(f"{method} {path} -> {response.status_code}: {response.text}")
    return response.json() if response.content else None


def check(label: str, actual, expected) -> None:
    ok = actual == expected
    suffix = "" if ok else f" (expected {expected!r})"
    print(f"  {'PASS' if ok else 'FAIL'}  {label}: {actual!r}{suffix}")
    if not ok:
        failures.append(label)


def main() -> int:
    if not settings.auth_dev_mode:
        raise SystemExit("Set AUTH_DEV_MODE=true before running the smoke test.")

    print("1. sign in three people")
    ana = call("GET", "/me", ANA)
    ben = call("GET", "/me", BEN)
    cia = call("GET", "/me", CIA)

    print("2. Ana creates a group in EUR and invites the others")
    group = call(
        "POST", "/groups", ANA,
        json={"name": "Smoke Trip", "description": "throwaway", "base_currency": "EUR"},
    )
    gid = group["id"]
    imported: list[str] = []
    try:
        for email in (BEN, CIA):
            call("POST", f"/groups/{gid}/invites", ANA, json={"email": email})
            invites = call("GET", "/invites", email)
            call("POST", f"/invites/{invites[0]['id']}/accept", email)
        group = call("GET", f"/groups/{gid}", ANA)
        check("members", len(group["members"]), 3)

        print("3. a manual USD rate, then an expense in USD")
        call("PUT", f"/groups/{gid}/rates", ANA, json={"currency": "USD", "rate_to_base": "0.90"})
        call(
            "POST", "/expenses", ANA,
            json={
                "group_id": gid,
                "description": "Hotel",
                "currency": "USD",
                "amount": "300.00",
                "expense_date": "2026-01-10",
                "category": "lodging",
                "split_type": "equal",
            },
        )
        # 300 USD -> 270 EUR, split three ways: 90 each.
        balances = call("GET", f"/groups/{gid}/balances", ANA)
        nets = {row["user"]["id"]: Decimal(row["net"]) for row in balances["balances"]}
        check("Ana is owed 180 EUR", nets[ana["id"]], Decimal("180.00"))
        check("Ben owes 90 EUR", nets[ben["id"]], Decimal("-90.00"))

        print("4. every split type")
        call(
            "POST", "/expenses", BEN,
            json={
                "group_id": gid, "description": "Dinner", "currency": "EUR",
                "amount": "100.00", "split_type": "percent",
                "participants": [
                    {"user_id": ana["id"], "value": "50"},
                    {"user_id": ben["id"], "value": "30"},
                    {"user_id": cia["id"], "value": "20"},
                ],
            },
        )
        call(
            "POST", "/expenses", CIA,
            json={
                "group_id": gid, "description": "Taxis", "currency": "EUR",
                "amount": "60.00", "split_type": "shares",
                "participants": [
                    {"user_id": ana["id"], "value": "1"},
                    {"user_id": ben["id"], "value": "2"},
                ],
            },
        )
        call(
            "POST", "/expenses", ANA,
            json={
                "group_id": gid, "description": "Market", "currency": "EUR",
                "amount": "44.00", "split_type": "items",
                "items": [
                    {"name": "Pizza", "amount": "30.00", "quantity": "1",
                     "shared_with": [ana["id"], ben["id"]]},
                    {"name": "Beer", "amount": "10.00", "quantity": "1",
                     "shared_with": [ben["id"]]},
                ],
            },
        )

        balances = call("GET", f"/groups/{gid}/balances", ANA)
        nets = {row["user"]["id"]: Decimal(row["net"]) for row in balances["balances"]}
        check("nets still sum to zero", sum(nets.values()), Decimal("0.00"))
        check(
            "simplified plan needs at most n-1 payments",
            len(balances["simplified"]) <= 2,
            True,
        )
        check(
            "simplification never adds payments",
            len(balances["simplified"]) <= len(balances["pairwise"]),
            True,
        )

        print("5. a rejected split")
        bad = client.post(
            "/expenses", headers=as_(ANA),
            json={
                "group_id": gid, "description": "Bad", "currency": "EUR",
                "amount": "10.00", "split_type": "exact",
                "participants": [{"user_id": ana["id"], "value": "3.00"}],
            },
        )
        check("exact split that misses the total is rejected", bad.status_code, 400)

        print("6. settle the plan and confirm everyone lands on zero")
        for transfer in balances["simplified"]:
            call(
                "POST", "/settlements", ANA,
                params={"group_id": gid},
                json={
                    "from_user_id": transfer["from_user_id"],
                    "to_user_id": transfer["to_user_id"],
                    "currency": "EUR",
                    "amount": transfer["amount"],
                    "method": "outside",
                    "note": "smoke test",
                    "settled_on": "2026-01-20",
                },
            )
        after = call("GET", f"/groups/{gid}/balances", ANA)
        check(
            "everyone settled",
            {Decimal(row["net"]) for row in after["balances"]},
            {Decimal("0.00")},
        )

        print("7. edit and delete leave a trail")
        expenses = call("GET", "/expenses", ANA, params={"group_id": gid})
        call("PATCH", f"/expenses/{expenses[0]['id']}", ANA, json={"description": "Renamed"})
        call("DELETE", f"/expenses/{expenses[0]['id']}", ANA)
        activity = call("GET", f"/groups/{gid}/activity", ANA)
        check("activity log recorded the work", len(activity) >= 10, True)

        print("8. personal expenses stay private")
        call(
            "POST", "/expenses", ANA,
            json={"group_id": None, "description": "Coffee", "currency": "EUR",
                  "amount": "3.50", "category": "food"},
        )
        check("Ana sees her own", len(call("GET", "/expenses/personal", ANA)), 1)
        check("Ben sees none of hers", len(call("GET", "/expenses/personal", BEN)), 0)

        print("9. outsiders cannot read the group")
        check(
            "non-member gets a 404",
            client.get(f"/groups/{gid}", headers=as_("nobody@example.com")).status_code,
            404,
        )

        print("10. a renamed profile survives the next request")
        call("PATCH", "/me", ANA, json={"display_name": "Ana Ruiz"})
        renamed = call("GET", "/me", ANA)["display_name"]
        check("rename is not overwritten on re-auth", renamed, "Ana Ruiz")

        print("11. a Splitwise export becomes a group")
        preview = call("POST", "/imports/splitwise/preview", ANA, json={"csv": SPLITWISE_CSV})
        check("people found", [p["name"] for p in preview["people"]], ["Ana", "Dee"])
        check("expenses found", preview["expense_count"], 2)
        check("repayments found", preview["settlement_count"], 1)
        check("nothing to warn about", preview["warnings"], [])

        result = call(
            "POST", "/imports/splitwise", ANA,
            json={
                "csv": SPLITWISE_CSV,
                "group_name": "Smoke Import",
                "base_currency": "EUR",
                "people": [{"name": "Ana", "email": ANA}, {"name": "Dee", "email": DEE}],
            },
        )
        imported.append(result["group_id"])
        check("expenses created", result["expenses_created"], 2)
        check("repayments created", result["settlements_created"], 1)

        print("12. the imported balances match what Splitwise printed")
        imported_balances = call("GET", f"/groups/{result['group_id']}/balances", ANA)
        nets = {
            row["user"]["email"]: Decimal(row["net"])
            for row in imported_balances["balances"]
        }
        check("Ana is owed 15", nets[ANA], Decimal("15.00"))
        check("Dee owes 15", nets[DEE], Decimal("-15.00"))

        print("13. re-importing the same file changes nothing")
        again = call(
            "POST", "/imports/splitwise", ANA,
            json={
                "csv": SPLITWISE_CSV,
                "group_id": result["group_id"],
                "base_currency": "EUR",
                "people": [{"name": "Ana", "email": ANA}, {"name": "Dee", "email": DEE}],
            },
        )
        check("nothing created twice", again["expenses_created"], 0)
        check("duplicates spotted", again["duplicates_skipped"], 3)
    finally:
        print("cleaning up …")
        emails = [ANA, BEN, CIA, DEE, "nobody@example.com"]
        with engine.begin() as conn:
            # The group cascades to its members, expenses, settlements and log.
            for group_id in [gid, *imported]:
                conn.execute(text("delete from groups where id = :id"), {"id": group_id})
            conn.execute(
                text(
                    "delete from expenses where owner_id in"
                    " (select id from app_users where email = any(:emails))"
                ),
                {"emails": emails},
            )
            conn.execute(
                text(
                    "delete from activity_log where actor_id in"
                    " (select id from app_users where email = any(:emails))"
                ),
                {"emails": emails},
            )
            conn.execute(
                text("delete from app_users where email = any(:emails)"),
                {"emails": emails},
            )

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
