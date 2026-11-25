"""REST API endpoints for user authentication, registration, and role management."""

import re
from flask import Blueprint, g, request
from werkzeug.security import check_password_hash, generate_password_hash
from app.api.errors import APIError, format_success_response
from app.repositories.user_repository import UserRepository
from app.security import create_access_token, require_auth, sanitize_text_input

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")
_user_repo = UserRepository()

EMAIL_REGEX = re.compile(r"^[\w\.-]+@[\w\.-]+\.\w+$")
VALID_ROLES = {"SELLER", "CUSTOMER", "MANAGER", "ANALYST", "AUDITOR", "ADMIN"}
SELF_REGISTRABLE_ROLES = {"SELLER", "CUSTOMER", "MANAGER", "ANALYST", "AUDITOR"}


@auth_bp.route("/roles", methods=["GET"])
def get_roles():
    """Retrieve all available system roles with descriptions."""
    roles = _user_repo.list_roles()
    return format_success_response(
        {
            "roles": roles,
            "count": len(roles),
        },
        status_code=200,
    )


@auth_bp.route("/register", methods=["POST"])
def register():
    """Register a new user with an assigned operational role.

    Payload:
        full_name (str): Full name of the user.
        email (str): Valid and unique email address.
        password (str): Minimum 6 characters.
        role (str): System role (SELLER, CUSTOMER, MANAGER, ANALYST, AUDITOR).
        business_name (str, optional): Business name if registering as SELLER.
    """
    payload = request.get_json(silent=True) or {}
    full_name = sanitize_text_input(payload.get("full_name"), "full_name", required=False, max_length=150) or ""
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    role = (payload.get("role") or "").strip().upper()
    business_name = sanitize_text_input(payload.get("business_name"), "business_name", required=False, max_length=150)

    # 1. Validation
    if not full_name:
        raise APIError(code="VALIDATION_ERROR", message="Full name is required.", status_code=400)
    if not email or len(email) > 255 or not EMAIL_REGEX.match(email):
        raise APIError(code="VALIDATION_ERROR", message="A valid email address is required.", status_code=400)
    if not isinstance(password, str) or len(password) < 6:
        raise APIError(
            code="VALIDATION_ERROR",
            message="Password must be at least 6 characters long.",
            status_code=400,
        )
    if role == "ADMIN":
        raise APIError(
            code="FORBIDDEN",
            message="Self-registration as ADMIN is not permitted.",
            status_code=403,
        )
    if role not in SELF_REGISTRABLE_ROLES:
        raise APIError(
            code="INVALID_ROLE",
            message=f"Role '{role}' is invalid. Allowed: {sorted(list(SELF_REGISTRABLE_ROLES))}",
            status_code=400,
        )

    # 2. Check email uniqueness
    existing_user = _user_repo.get_user_by_email(email)
    if existing_user:
        raise APIError(
            code="EMAIL_ALREADY_REGISTERED",
            message=f"An account with email '{email}' already exists. Please sign in instead.",
            status_code=409,
        )

    # 3. Hash password and insert
    password_hash = generate_password_hash(password)
    user_record = _user_repo.create_user(
        full_name=full_name,
        email=email,
        password_hash=password_hash,
        role_name=role,
        business_name=business_name,
    )

    token = create_access_token(
        user_id=user_record["user_id"],
        role=user_record["role"],
        seller_id=user_record.get("seller_id"),
        email=user_record["email"],
        full_name=user_record["full_name"],
    )

    return format_success_response(
        {
            "user_id": user_record["user_id"],
            "full_name": user_record["full_name"],
            "email": user_record["email"],
            "role": user_record["role"],
            "seller_id": user_record.get("seller_id"),
            "business_name": user_record.get("business_name"),
            "token": token,
            "message": "Account created successfully.",
        },
        status_code=201,
    )


@auth_bp.route("/login", methods=["POST"])
def login():
    """Authenticate a user using email and password.

    Payload:
        email (str): Registered email address.
        password (str): User password.
        role (str, optional): Role verification.
    """
    payload = request.get_json() or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    requested_role = (payload.get("role") or "").strip().upper()

    if not email or not password:
        raise APIError(
            code="VALIDATION_ERROR",
            message="Both email and password are required.",
            status_code=400,
        )

    user = _user_repo.get_user_by_email(email)
    if not user:
        raise APIError(
            code="INVALID_CREDENTIALS",
            message="Invalid email address or password.",
            status_code=401,
        )

    if not user.get("is_active"):
        raise APIError(
            code="ACCOUNT_INACTIVE",
            message="This account has been deactivated. Please contact an administrator.",
            status_code=403,
        )

    # Verify password (handles both werkzeug hashes and seeded demo accounts)
    stored_hash = user.get("password_hash") or ""
    password_valid = False
    if stored_hash.startswith(("scrypt:", "pbkdf2:")):
        password_valid = check_password_hash(stored_hash, password)
    elif stored_hash == "demo_argon2_hash":
        # Seeded demo accounts accept only explicit demo passwords (never arbitrary strings)
        password_valid = password in {"demo123", "demo"}

    if not password_valid:
        raise APIError(
            code="INVALID_CREDENTIALS",
            message="Invalid email address or password.",
            status_code=401,
        )

    # Enforce authoritative database role; never allow client-supplied role escalation
    effective_role = (user.get("role") or "").upper()
    if not effective_role:
        raise APIError(
            code="FORBIDDEN",
            message="User account does not have an assigned operational role.",
            status_code=403,
        )
    if requested_role and requested_role != effective_role:
        raise APIError(
            code="ROLE_MISMATCH",
            message=f"Account is not authorized for role '{requested_role}'.",
            status_code=403,
        )

    token = create_access_token(
        user_id=user["user_id"],
        role=effective_role,
        seller_id=user.get("seller_id"),
        email=user["email"],
        full_name=user["full_name"],
    )

    return format_success_response(
        {
            "user_id": user["user_id"],
            "full_name": user["full_name"],
            "email": user["email"],
            "role": effective_role,
            "seller_id": user.get("seller_id"),
            "business_name": user.get("business_name"),
            "token": token,
            "message": "Authentication successful.",
        },
        status_code=200,
    )


@auth_bp.route("/me", methods=["GET"])
@require_auth()
def get_current_user():
    """Retrieve profile of the currently authenticated user."""
    principal = g.current_user
    return format_success_response(
        {
            "user_id": principal["user_id"],
            "full_name": principal.get("full_name"),
            "email": principal.get("email"),
            "role": principal.get("role"),
            "seller_id": principal.get("seller_id"),
            "business_name": principal.get("business_name"),
            "is_active": True,
        },
        status_code=200,
    )
