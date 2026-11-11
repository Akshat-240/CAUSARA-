"""REST API endpoints for user entity and operational actor queries."""

from typing import Any, Optional
from flask import Blueprint, request
from app.api.errors import format_success_response
from app.repositories.user_repository import UserRepository

users_bp = Blueprint("users", __name__)
_user_repo = UserRepository()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime to ISO 8601 string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
        return dt_val.isoformat()
    return str(dt_val)


@users_bp.route("/users", methods=["GET"])
def list_users():
    """List users with optional role filtering."""
    role = request.args.get("role")
    limit = int(request.args.get("limit", 50))
    offset = int(request.args.get("offset", 0))

    users = _user_repo.list_users(role=role, limit=limit, offset=offset)
    formatted = []
    for u in users:
        formatted.append({
            "user_id": u["user_id"],
            "full_name": u["full_name"],
            "email": u["email"],
            "is_active": bool(u["is_active"]),
            "role": u.get("role"),
            "created_at": _format_datetime(u.get("created_at")),
        })
    return format_success_response(
        {
            "users": formatted,
            "count": len(formatted),
        },
        status_code=200,
    )


@users_bp.route("/actors", methods=["GET"])
def list_actors():
    """Retrieve active operational actors with assigned roles for client-side demo attribution."""
    actors = _user_repo.list_actors()
    return format_success_response(
        {
            "actors": actors,
            "count": len(actors),
        },
        status_code=200,
    )
