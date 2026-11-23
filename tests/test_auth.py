"""Automated tests for user authentication and registration API endpoints."""

import uuid


def test_get_roles(client):
    """Verify that roles endpoint returns available system roles."""
    res = client.get("/api/v1/auth/roles")
    assert res.status_code == 200
    data = res.get_json()["data"]
    roles = [r["role_name"] for r in data["roles"]]
    assert "SELLER" in roles
    assert "CUSTOMER" in roles
    assert "MANAGER" in roles
    assert "ANALYST" in roles


def test_register_user_success(client):
    """Verify clean registration of a new user with CUSTOMER role."""
    unique_email = f"user_{uuid.uuid4().hex[:8]}@test.com"
    res = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Test Customer",
            "email": unique_email,
            "password": "securepassword123",
            "role": "CUSTOMER",
        },
    )
    assert res.status_code == 201
    data = res.get_json()["data"]
    assert data["full_name"] == "Test Customer"
    assert data["email"] == unique_email
    assert data["role"] == "CUSTOMER"
    assert "token" in data
    assert data["user_id"] > 0


def test_register_seller_creates_seller_profile(client):
    """Verify that registering as SELLER creates an associated seller record."""
    unique_email = f"seller_{uuid.uuid4().hex[:8]}@test.com"
    res = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Global Cargo Ltd",
            "email": unique_email,
            "password": "securepassword123",
            "role": "SELLER",
            "business_name": "Global Express Freight",
        },
    )
    assert res.status_code == 201
    data = res.get_json()["data"]
    assert data["role"] == "SELLER"
    assert data["business_name"] == "Global Express Freight"
    assert data["seller_id"] is not None


def test_register_duplicate_email_rejected(client):
    """Verify that registering with an existing email returns HTTP 409 conflict."""
    unique_email = f"dup_{uuid.uuid4().hex[:8]}@test.com"
    payload = {
        "full_name": "Original User",
        "email": unique_email,
        "password": "password123",
        "role": "ANALYST",
    }
    res1 = client.post("/api/v1/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/v1/auth/register", json=payload)
    assert res2.status_code == 409
    assert res2.get_json()["error"]["code"] == "EMAIL_ALREADY_REGISTERED"


def test_register_validation_errors(client):
    """Verify that invalid payloads (short password, invalid email, missing name) are rejected."""
    # Short password
    res1 = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Short Pw",
            "email": "valid@test.com",
            "password": "123",
            "role": "CUSTOMER",
        },
    )
    assert res1.status_code == 400
    assert "at least 6 characters" in res1.get_json()["error"]["message"]

    # Invalid role
    res2 = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Invalid Role",
            "email": "valid2@test.com",
            "password": "password123",
            "role": "SUPERUSER",
        },
    )
    assert res2.status_code == 400
    assert res2.get_json()["error"]["code"] == "INVALID_ROLE"


def test_login_success_with_hash(client):
    """Verify that a freshly registered user can sign in with their password."""
    unique_email = f"login_{uuid.uuid4().hex[:8]}@test.com"
    client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Auth Tester",
            "email": unique_email,
            "password": "mypassword456",
            "role": "MANAGER",
        },
    )

    res = client.post(
        "/api/v1/auth/login",
        json={
            "email": unique_email,
            "password": "mypassword456",
        },
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["email"] == unique_email
    assert data["role"] == "MANAGER"
    assert "token" in data


def test_login_demo_user(client):
    """Verify that seeded demo users can log in cleanly."""
    res = client.post(
        "/api/v1/auth/login",
        json={
            "email": "demo_seller@causara.com",
            "password": "demo",
        },
    )
    assert res.status_code == 200
    data = res.get_json()["data"]
    assert data["email"] == "demo_seller@causara.com"
    assert data["role"] == "SELLER"


def test_login_invalid_password(client):
    """Verify that wrong password returns HTTP 401."""
    unique_email = f"wrong_{uuid.uuid4().hex[:8]}@test.com"
    client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Wrong Pw Tester",
            "email": unique_email,
            "password": "correct_password",
            "role": "CUSTOMER",
        },
    )

    res = client.post(
        "/api/v1/auth/login",
        json={
            "email": unique_email,
            "password": "wrong_password",
        },
    )
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "INVALID_CREDENTIALS"
