"""Vercel entrypoint.

Vercel's Python runtime looks for a module-level ASGI app called ``app``; the
rewrite in vercel.json funnels every path here, so FastAPI still does all the
routing itself.
"""

from app.main import app

__all__ = ["app"]
