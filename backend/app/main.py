from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .db import engine
from .routers import activity, balances, expenses, groups, imports, me, settlements

logger = logging.getLogger("uvicorn.error")

app = FastAPI(
    title="Dividir Gastos API",
    version="1.0.0",
    description="A Splitwise-style shared expense tracker.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(me.router)
app.include_router(groups.router)
app.include_router(expenses.router)
app.include_router(settlements.router)
app.include_router(balances.router)
app.include_router(activity.router)
app.include_router(imports.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
        database = "ok"
    except Exception as exc:  # pragma: no cover - depends on the environment
        logger.warning("health check could not reach the database: %s", exc)
        database = "unreachable"

    return {
        "status": "ok",
        "database": database,
        "auth_dev_mode": settings.auth_dev_mode,
    }
