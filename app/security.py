"""Centralized security utilities: signed tokens, RBAC decorators, and input validation."""

import base64
from functools import wraps
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any, Callable, Dict, Optional, Tuple
from flask import current_app, g, request

from app.api.errors import APIError
from app.repositories.user_repository import UserRepository

_user_repo = UserRepository()

TOKEN_VERSION = "v1"
DEFAULT_TOKEN_TTL_SECONDS = 86400  # 24 hours
INSECURE_DEFAULT_SECRET = "causara-dev-secret-key-insecure"

# Control chars excluding tab (\x09), LF (\x0a), CR (\x0d)
_DISALLOWED_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data_str: str) -> bytes:
    padding = "=" * (-len(data_str) % 4)
    return base64.urlsafe_b64decode((data_str + padding).encode("ascii"))


def _get_signing_key() -> bytes:
    secret = current_app.config.get("SECRET_KEY") or ""
    if current_app.config.get("ENV") == "production" and (
        not secret or secret == INSECURE_DEFAULT_SECRET
    ):
        raise RuntimeError("Insecure SECRET_KEY configuration in production.")
    if not secret:
        secret = INSECURE_DEFAULT_SECRET
    return secret.encode("utf-8")


def create_access_token(
    user_id: int,
    role: str,
    seller_id: Optional[int] = None,
    email: Optional[str] = None,
    full_name: Optional[str] = None,
    expires_in_seconds: int = DEFAULT_TOKEN_TTL_SECONDS,
) -> str:
    """Issue an HMAC-SHA256 signed bearer token bound to user_id and authoritative role."""
    now = int(time.time())
    payload: Dict[str, Any] = {
        "sub": int(user_id),
        "role": (role or "").upper(),
        "seller_id": seller_id,
        "email": email,
        "full_name": full_name,
        "iat": now,
        "exp": now + int(expires_in_seconds),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    signing_input = f"{TOKEN_VERSION}.{payload_b64}".encode("ascii")
    sig = hmac.new(_get_signing_key(), signing_input, hashlib.sha256).digest()
    return f"{TOKEN_VERSION}.{payload_b64}.{_b64url_encode(sig)}"


def verify_access_token(token: str) -> Dict[str, Any]:
    """Verify token signature and expiration; return decoded payload."""
    if not token or not isinstance(token, str):
        raise APIError(code="UNAUTHORIZED", message="Authentication token is required.", status_code=401)

    parts = token.strip().split(".")
    if len(parts) != 3 or parts[0] != TOKEN_VERSION:
        raise APIError(code="UNAUTHORIZED", message="Invalid authentication token format.", status_code=401)

    version, payload_b64, sig_b64 = parts
    signing_input = f"{version}.{payload_b64}".encode("ascii")
    expected_sig = hmac.new(_get_signing_key(), signing_input, hashlib.sha256).digest()

    try:
        provided_sig = _b64url_decode(sig_b64)
    except Exception as ex:
        raise APIError(code="UNAUTHORIZED", message="Malformed token signature.", status_code=401) from ex

    if not hmac.compare_digest(provided_sig, expected_sig):
        raise APIError(code="UNAUTHORIZED", message="Invalid authentication token.", status_code=401)

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception as ex:
        raise APIError(code="UNAUTHORIZED", message="Malformed token payload.", status_code=401) from ex

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise APIError(code="TOKEN_EXPIRED", message="Authentication token has expired.", status_code=401)

    sub = payload.get("sub")
    if not isinstance(sub, int) or sub <= 0:
        raise APIError(code="UNAUTHORIZED", message="Token subject is invalid.", status_code=401)

    return payload


def _is_valid_internal_api_key() -> bool:
    """Check whether request carries a valid configured INTERNAL_API_KEY."""
    expected_key = current_app.config.get("INTERNAL_API_KEY", "") or ""
    if not expected_key:
        return False
    provided_key = request.headers.get("X-Internal-API-Key", "")
    if not provided_key:
        return False
    return hmac.compare_digest(provided_key, expected_key)


def get_authenticated_principal(allow_internal_service: bool = False) -> Dict[str, Any]:
    """Authenticate the incoming request and resolve the authoritative principal."""
    if allow_internal_service and _is_valid_internal_api_key():
        return {
            "user_id": None,
            "role": "SYSTEM",
            "seller_id": None,
            "email": None,
            "full_name": "System Service",
            "is_system": True,
        }

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise APIError(
            code="UNAUTHORIZED",
            message="Valid Bearer authentication token is required.",
            status_code=401,
        )

    token = auth_header[7:].strip()
    claims = verify_access_token(token)
    user_id = int(claims["sub"])

    user = _user_repo.get_user_by_id(user_id)
    if not user:
        raise APIError(
            code="UNAUTHORIZED",
            message="Authenticated user account no longer exists.",
            status_code=401,
        )

    if not user.get("is_active"):
        raise APIError(
            code="ACCOUNT_INACTIVE",
            message="Authenticated user account is deactivated.",
            status_code=403,
        )

    authoritative_role = (user.get("role") or claims.get("role") or "").upper()
    return {
        "user_id": int(user["user_id"]),
        "role": authoritative_role,
        "seller_id": user.get("seller_id"),
        "email": user.get("email"),
        "full_name": user.get("full_name"),
        "business_name": user.get("business_name"),
        "is_system": False,
    }


def require_auth(allow_internal_service: bool = False) -> Callable:
    """Decorator requiring a valid authenticated principal on the request."""
    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            g.current_user = get_authenticated_principal(allow_internal_service=allow_internal_service)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def require_roles(*allowed_roles: str, allow_internal_service: bool = False) -> Callable:
    """Decorator enforcing authentication and role membership on the backend."""
    normalized_allowed = {r.upper() for r in allowed_roles}

    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args, **kwargs):
            principal = get_authenticated_principal(allow_internal_service=allow_internal_service)
            g.current_user = principal
            if principal.get("is_system") and allow_internal_service:
                return fn(*args, **kwargs)
            if principal.get("role") not in normalized_allowed:
                raise APIError(
                    code="FORBIDDEN",
                    message=(
                        f"Role '{principal.get('role')}' is not authorized to perform this action. "
                        f"Required: {sorted(normalized_allowed)}."
                    ),
                    status_code=403,
                )
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def parse_positive_int(value: Any, field_name: str) -> int:
    """Parse and validate a positive integer field cleanly."""
    try:
        parsed = int(value)
    except (TypeError, ValueError) as ex:
        raise APIError(
            code="BAD_REQUEST",
            message=f"Field '{field_name}' must be a valid integer.",
            status_code=400,
        ) from ex
    if parsed <= 0:
        raise APIError(
            code="BAD_REQUEST",
            message=f"Field '{field_name}' must be a positive integer.",
            status_code=400,
        )
    return parsed


def validate_pagination(limit_raw: Any, offset_raw: Any, max_limit: int = 200) -> Tuple[int, int]:
    """Validate and bound pagination query parameters."""
    try:
        limit = int(limit_raw) if limit_raw is not None else 50
        offset = int(offset_raw) if offset_raw is not None else 0
    except (TypeError, ValueError) as ex:
        raise APIError(
            code="BAD_REQUEST",
            message="Pagination parameters 'limit' and 'offset' must be integers.",
            status_code=400,
        ) from ex

    if limit < 1 or limit > max_limit:
        raise APIError(
            code="BAD_REQUEST",
            message=f"Parameter 'limit' must be between 1 and {max_limit}.",
            status_code=400,
        )
    if offset < 0:
        raise APIError(
            code="BAD_REQUEST",
            message="Parameter 'offset' must be >= 0.",
            status_code=400,
        )
    return limit, offset


def sanitize_text_input(
    value: Any,
    field_name: str,
    required: bool = False,
    max_length: int = 2000,
) -> Optional[str]:
    """Strip, bound, and reject null/control characters in text input."""
    if value is None:
        if required:
            raise APIError(code="BAD_REQUEST", message=f"Field '{field_name}' is required.", status_code=400)
        return None
    if not isinstance(value, str):
        raise APIError(code="BAD_REQUEST", message=f"Field '{field_name}' must be a string.", status_code=400)

    cleaned = value.strip()
    if _DISALLOWED_CONTROL_CHARS.search(cleaned):
        raise APIError(
            code="BAD_REQUEST",
            message=f"Field '{field_name}' contains invalid control characters.",
            status_code=400,
        )
    if required and not cleaned:
        raise APIError(code="BAD_REQUEST", message=f"Field '{field_name}' cannot be empty.", status_code=400)
    if len(cleaned) > max_length:
        raise APIError(
            code="BAD_REQUEST",
            message=f"Field '{field_name}' exceeds maximum length of {max_length} characters.",
            status_code=400,
        )
    return cleaned if cleaned else None


def sanitize_filename(file_name: Any) -> str:
    """Normalize evidence filename and strip path traversal segments."""
    cleaned = sanitize_text_input(file_name, "file_name", required=True, max_length=255) or ""
    if ".." in cleaned or "/" in cleaned or "\\" in cleaned:
        base = os.path.basename(cleaned.replace("\\", "/")).strip()
        if not base or base in (".", ".."):
            raise APIError(
                code="BAD_REQUEST",
                message="Invalid 'file_name': path traversal is not permitted.",
                status_code=400,
            )
        cleaned = base
    return cleaned
