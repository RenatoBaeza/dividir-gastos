"""Apply the SQL files in supabase/migrations to DATABASE_URL.

Handy when you do not have psql installed. Every migration is written to be
re-runnable, so this is safe to call twice.

    python scripts/apply_migrations.py
"""

from __future__ import annotations

import pathlib
import sys

from sqlalchemy import create_engine, text

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402

MIGRATIONS = (
    pathlib.Path(__file__).resolve().parents[2] / "supabase" / "migrations"
)


def main() -> int:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        print(f"No migrations found in {MIGRATIONS}")
        return 1

    engine = create_engine(settings.sqlalchemy_url)
    with engine.begin() as conn:
        for path in files:
            print(f"applying {path.name} …")
            conn.execute(text(path.read_text(encoding="utf-8")))

    print(f"done: {len(files)} migration(s) applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
