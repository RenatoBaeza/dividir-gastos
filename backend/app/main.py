from __future__ import annotations

import logging

from fastapi import FastAPI, Request
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
    allow_origin_regex=settings.cors_origin_regex or None,
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


# --- TEMPORARY deployment probe -------------------------------------------
# Every path on the Vercel deployment currently returns FastAPI's own 404,
# including /docs and /openapi.json, which means the ASGI app is running but
# never sees the URL the browser asked for. This catch-all reports the path
# that actually arrives so the rewrite can be fixed. Delete once resolved.
def _all_paths(router) -> set[str]:
    """Starlette 1.6 nests included routers, so walk them instead of reading
    `app.routes` directly - a flat read only reports the app-level routes."""
    found: set[str] = set()
    for route in getattr(router, "routes", []):
        path = getattr(route, "path", None)
        if path is not None:
            found.add(path)
        inner = (
            getattr(route, "original_router", None)
            or getattr(route, "router", None)
            or getattr(route, "app", None)
        )
        if inner is not None and inner is not router:
            found |= _all_paths(inner)
    return found


@app.api_route(
    "/{_probe:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def _deployment_probe(request: Request) -> dict:
    return {
        "probe": "unrouted-request",
        "asgi_path": request.scope.get("path"),
        "raw_path": (request.scope.get("raw_path") or b"").decode(errors="replace"),
        "root_path": request.scope.get("root_path"),
        "query_string": (request.scope.get("query_string") or b"").decode(),
        "url": str(request.url),
        "vercel_headers": {
            k: v for k, v in request.headers.items() if k.lower().startswith("x-")
        },
        "known_routes": sorted(_all_paths(app.router) - {"/{_probe:path}"}),
    }
