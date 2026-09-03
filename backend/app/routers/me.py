from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import current_user
from ..db import get_db
from ..dependencies import log_activity
from ..models import AppUser, Group, GroupInvite, GroupMember
from ..schemas import InviteOut, Name, UserOut

router = APIRouter(tags=["me"])


class ProfileUpdate(BaseModel):
    display_name: Name


@router.get("/me", response_model=UserOut)
def get_me(user: AppUser = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> UserOut:
    user.display_name = payload.display_name.strip()
    db.flush()
    return UserOut.model_validate(user)


@router.get("/invites", response_model=list[InviteOut])
def my_invites(
    db: Session = Depends(get_db), user: AppUser = Depends(current_user)
) -> list[InviteOut]:
    """Pending invites addressed to the signed-in user's email."""
    invites = db.scalars(
        select(GroupInvite)
        .join(Group, Group.id == GroupInvite.group_id)
        .where(
            func.lower(GroupInvite.email) == user.email.lower(),
            GroupInvite.status == "pending",
            Group.deleted_at.is_(None),
        )
        .order_by(GroupInvite.created_at.desc())
    ).all()

    return [
        InviteOut(
            id=i.id,
            group_id=i.group_id,
            group_name=i.group.name,
            email=i.email,
            status=i.status,
            invited_by=db.get(AppUser, i.invited_by),
            created_at=i.created_at,
        )
        for i in invites
    ]


def _pending_invite_for(db: Session, user: AppUser, invite_id: uuid.UUID) -> GroupInvite:
    invite = db.get(GroupInvite, invite_id)
    if (
        invite is None
        or invite.status != "pending"
        or invite.email.lower() != user.email.lower()
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    return invite


@router.post("/invites/{invite_id}/accept", response_model=UserOut)
def accept_invite(
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> UserOut:
    invite = _pending_invite_for(db, user, invite_id)

    if db.get(GroupMember, (invite.group_id, user.id)) is None:
        db.add(GroupMember(group_id=invite.group_id, user_id=user.id, role="member"))

    invite.status = "accepted"
    invite.accepted_at = dt.datetime.now(dt.UTC)
    invite.accepted_by = user.id

    log_activity(
        db,
        actor=user,
        group_id=invite.group_id,
        action="joined",
        entity_type="member",
        entity_id=user.id,
        summary="joined the group",
    )
    db.flush()
    return UserOut.model_validate(user)


@router.post("/invites/{invite_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invite(
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: AppUser = Depends(current_user),
) -> None:
    invite = _pending_invite_for(db, user, invite_id)
    invite.status = "revoked"
