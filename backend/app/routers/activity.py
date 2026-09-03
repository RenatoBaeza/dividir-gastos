from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import load_group
from ..models import ActivityLog, Group
from ..schemas import ActivityOut, UserOut

router = APIRouter(prefix="/groups/{group_id}", tags=["activity"])


@router.get("/activity", response_model=list[ActivityOut])
def group_activity(
    limit: int = Query(default=100, ge=1, le=300),
    offset: int = Query(default=0, ge=0),
    group: Group = Depends(load_group),
    db: Session = Depends(get_db),
) -> list[ActivityOut]:
    entries = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.group_id == group.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    return [
        ActivityOut(
            id=e.id,
            group_id=e.group_id,
            actor=UserOut.model_validate(e.actor),
            entity_type=e.entity_type,
            entity_id=e.entity_id,
            action=e.action,
            summary=e.summary,
            details=e.details,
            created_at=e.created_at,
        )
        for e in entries
    ]
