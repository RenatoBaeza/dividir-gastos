# Dividir Gastos

A Splitwise-style shared expense tracker: groups, flexible splits, multi-currency
totals against a manual rate table, and a settle-up plan that uses the fewest
payments possible.

| Piece    | Stack                                                   | Deploys to    |
| -------- | ------------------------------------------------------- | ------------- |
| Frontend | React + TypeScript + Tailwind v4 + shadcn/ui (Vite)      | Vercel        |
| Backend  | FastAPI + SQLAlchemy 2 (sync, psycopg 3)                 | Vercel        |
| Database | Supabase Postgres                                        | Supabase      |
| Auth     | Supabase Auth, email + password                          | Supabase      |

```
backend/    FastAPI app, unit tests, migration + smoke scripts
frontend/   Vite SPA
supabase/   SQL migrations
```

---

## Running it locally

### 1. Database

Point `DATABASE_URL` at a Postgres. The quickest path is the Supabase project you
will deploy to (Project Settings → Database → Connection string), but any
Postgres 14+ works.

Use the **Session pooler** URI, not the direct `db.<ref>.supabase.co` host —
that one is IPv6-only and will not resolve on most home connections. The
transaction pooler on port 6543 does not support prepared statements, which
SQLAlchemy relies on, so stick to the session pooler on 5432.

```bash
cd backend
cp .env.example .env          # then fill in DATABASE_URL
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt
.venv/Scripts/python scripts/apply_migrations.py
```

`apply_migrations.py` runs everything in `supabase/migrations/`. The migration is
idempotent, so re-running it is safe. If you prefer psql:

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

### 2. Backend

```bash
cd backend
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Interactive docs at <http://localhost:8000/docs>. `/health` is the liveness
probe (it answers without touching Postgres) and `/health/ready` is the
readiness one (it round-trips to the database and 503s when it cannot).

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local    # then fill in the Supabase project
npm install
npm run dev                   # http://localhost:5173
```

### Working without signing in at all

Handy when you want to act as several people, or when the confirmation emails
are rate-limited. Both sides have a matching local escape hatch:

```
backend/.env       AUTH_DEV_MODE=true
frontend/.env.local  VITE_AUTH_DEV_EMAIL=you@example.com
```

The frontend then sends `Authorization: Dev you@example.com` and the API trusts
it, creating the user on first request. Change the email to act as a second
person and test invites and balances with yourself. **Never enable this on a
deployment that is reachable from the internet.**

---

## Auth

Supabase Auth with the **email + password** provider, which is on by default —
there is no external identity provider to register and nothing to configure to
get started.

The browser holds the Supabase session; the API only ever sees the JWT. It
verifies asymmetric tokens through the project's JWKS and falls back to the
legacy HS256 shared secret if `SUPABASE_JWT_SECRET` is set. The API creates the
`app_users` row on the first authenticated request, reading the display name out
of `user_metadata.full_name`, which the sign-up form fills in.

Four flows are implemented: sign up, sign in, forgot password, and choosing a new
password from the emailed link. A password-reset link signs the person in, so
`App.tsx` pre-empts the router while `passwordRecovery` is set — otherwise they
would land in the app without ever setting the new password. Signed-in users can
change their name or password from the header menu.

Neither the sign-up form nor the reset form reveals whether an address is already
registered: Supabase deliberately returns a session-less success for a duplicate
sign-up, and both paths show the same "check your inbox" screen.

### The emails

Confirmation is required (`mailer_autoconfirm` is false), so a new account has no
session until the link is clicked. Two things to know before you rely on that:

- **Supabase's built-in sender is for development only.** It is rate-limited to
  a couple of messages per hour and, on a new project, will only deliver to the
  addresses of your own team members. Configure custom SMTP under
  Authentication → Emails before anyone else signs up.
- To skip confirmation while developing, turn off *Confirm email* under
  Authentication → Providers → Email — or just use the dev-auth escape hatch
  above, which sidesteps email entirely.

Add your deployed URL and `http://localhost:5173` under Authentication → URL
Configuration, since that is where the confirmation and reset links come back to.

---

## How the API behaves

**Every error looks the same.** Whatever fails — a rejected payload, a missing
group, a constraint violation, a bug — comes back as:

```json
{
  "detail": "Group not found",
  "error": { "code": "not_found", "status": 404, "request_id": "9f2c…" }
}
```

`detail` is what a person should read; `code` is what a client should branch on.
Internal failures never carry a driver message or a traceback — those go to the
log, under the same `request_id` the caller was given.

**Every request has an id.** Sent back as `X-Request-ID`, echoed if the caller
supplied one, and attached to every log line the request produces, so a report of
"it broke at 14:32" is one search away from the exact failure.

**Logs are structured.** JSON lines everywhere except a development machine
(`LOG_JSON` overrides), one access line per request with method, path, status,
duration and the authenticated user. Health checks are excluded so uptime polling
does not drown the log.

**Limits.** Bodies over `MAX_REQUEST_BYTES` are refused with a 413 before they
are read into memory; callers get a token-bucket budget keyed on their token
(falling back to their address), with a much tighter one for `/imports`, which
parses and writes hundreds of rows per call. The limiter lives in the process, so
on serverless each warm instance enforces its own copy — it is a safety net
against one client hammering one instance, not an account-wide quota. Put a real
quota in front of the app if you need one.

**Databases are held on a short leash.** Connections carry a `statement_timeout`,
a `lock_timeout` and an `idle_in_transaction_session_timeout`, so a runaway query
or a transaction orphaned by a killed invocation cannot hold a pooler slot open.
Each request is one transaction: it commits when the handler returns and rolls
back on any exception.

**Bad configuration fails at boot, not at request time.** In production the app
refuses to start with the dev-auth bypass enabled, with the local database
default still in place, with no way to verify a token, or with a wildcard CORS
origin. A crash the platform surfaces immediately beats a server that quietly
trusts the wrong things.

**Dependencies are pinned.** `requirements.txt` uses `==`, so what runs in
production is what the tests ran against. Bump deliberately.


---

## How the money works

**Storage.** Every amount is kept in the currency it was entered in
(`numeric(18,4)`), alongside an `amount_base` converted with the group's manual
rate. Rates are per group and typed in by hand — nothing is ever fetched from an
exchange-rate API. Editing a rate, or switching the base currency, re-converts
every stored row so the balances never drift.

**Rounding.** Amounts are quantised to two decimals, half away from zero. Splits
use largest-remainder allocation, so ten euros three ways is 3.34 / 3.33 / 3.33
and never loses a cent.

**Splits.** Equally, by exact amounts, by percentage, by shares, or itemised.
An itemised receipt divides each line among the people who shared it and then
spreads the difference between the lines and the receipt total — tax, tip,
service — proportionally to what each person consumed.

**Balances.** For each member: what they paid, minus their share, plus
repayments they made, minus repayments they received. The nets always add to
zero, including for someone who paid for something and then left the group.

**Debt simplification.** The settle-up plan repeatedly matches the largest
debtor against the largest creditor, which zeroes out at least one person per
step and settles an *n*-member group in at most *n − 1* payments instead of one
per outstanding pair. The balances view can toggle between the simplified plan
and the raw who-owes-whom list. Everything is recomputed on read, so adding an
expense or recording a repayment updates the plan immediately.

---

## Importing a Splitwise group

**Your groups → Import from Splitwise.** In Splitwise, open the group and pick
*Export as spreadsheet*; drop the CSV in. The file is parsed and shown back to
you — people, currencies, every row, and anything that looks off — and nothing
is written until you confirm. You can create a new group from it or add the rows
to one you already have; re-importing the same file only reports duplicates.

**What the file does and does not contain.** A Splitwise export gives, per
expense, one column per member holding that member's *net* — what they paid
minus what they owed. The individual payments and shares are not in there. So
the importer reconstructs a payer/share breakdown that reproduces exactly the
same nets: everyone with a positive net is credited what they came out ahead by,
and whoever is owed the most covers the rest of the bill. Where the file is
ambiguous — several people chipped in for one expense — the reconstruction can
name a different payer than really paid, but every net, and therefore every
balance and the settle-up plan, comes out identical. Splitwise prints each
member's total at the bottom of the export and the importer checks its own
arithmetic against it, warning you if the two disagree.

Rows whose *Category* is a payment become repayments rather than expenses.
Categories are mapped onto this app's own list (English and Spanish names are
both recognised); anything unfamiliar lands in *General*.

**People.** The export has names, not addresses, so you type an email for each
person. Anyone who has never signed in gets a stand-in account and joins the
group straight away, and signing up with that address later adopts it —
their balance is waiting for them. **Multiple currencies** need a rate each
before the import will run, since the group's balances are all in its base
currency and this app never fetches a rate on its own.

---

## Tests

```bash
cd backend
.venv/Scripts/python -m pytest          # maths, tokens, config, middleware — no database
AUTH_DEV_MODE=true .venv/Scripts/python scripts/smoke.py
```

`scripts/smoke.py` needs a real `DATABASE_URL` with the migration applied. It
drives the API through every split type, multi-currency conversion, settlement,
edit, delete and permission check, then deletes the throwaway group it made.

```bash
cd frontend
npm run build    # tsc -b && vite build
npm run lint
```

---

## Deploying

**Supabase.** Apply `supabase/migrations/0001_init.sql`. Row-level security is
on and no policies are defined, so the anon and authenticated keys cannot read
these tables at all — the API connects as the Postgres role and does its own
authorisation. Keep it that way.

Both halves are separate Vercel projects pointed at the same repository, each
with its own **Root Directory**.

**Backend → Vercel.** Root directory `backend`. `api/index.py` re-exports the
ASGI app and `vercel.json` rewrites every path to it, so FastAPI keeps doing its
own routing. Environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler**, port **6543** |
| `ENVIRONMENT` | `production` — optional, `VERCEL_ENV` already implies it |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `CORS_ORIGINS` | the frontend's production URL |
| `CORS_ORIGIN_REGEX` | optional, to allow preview deployments |
| `SUPABASE_JWT_SECRET` | only for projects still on legacy HS256 |
| `AUTH_DEV_MODE` | leave unset — it accepts any identity, and production refuses to boot with it on |
| `DOCS_ENABLED` | `false` to keep `/docs` and the schema private |

Port 6543, not 5432: a serverless function is short-lived and highly concurrent,
so `db.py` switches to `NullPool` and turns off prepared statements whenever
`VERCEL` is set. Holding a pooled connection across a function freeze would
exhaust the session pooler instead.

**Frontend → Vercel.** Root directory `frontend`. `vercel.json` already sets the
build command and the SPA rewrite. Environment variables: `VITE_API_URL`
(the backend project's URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
Leave `VITE_AUTH_DEV_EMAIL` unset. These are baked in at build time, so changing
one needs a redeploy, not just a restart.

**Turn off Deployment Protection on the backend project** (Settings → Deployment
Protection → Vercel Authentication). While it is on, every request 302s to
`vercel.com/sso-api`, which a browser cannot follow cross-origin — the CORS
preflight fails before any of your code runs.

---

## Deliberately out of scope

Push notifications, receipt scanning, live exchange rates, payment integrations,
native mobile apps.
