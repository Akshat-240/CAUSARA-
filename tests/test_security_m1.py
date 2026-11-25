"""Focused automated security tests for Causara M1 Security Reinforcement."""

from datetime import datetime, timedelta, timezone
import pytest

from app import create_app
import app.api.auth as auth_module
import app.api.decisions as decisions_module
import app.api.delay as delay_module
import app.api.events as events_module
import app.api.evidence as evidence_module
import app.api.orders as orders_module
import app.api.scenarios as scenarios_module
import app.security as security_module


FAKE_USERS = {
    10: {
        "user_id": 10,
        "full_name": "Customer One",
        "email": "cust1@causara.test",
        "role": "CUSTOMER",
        "seller_id": None,
        "business_name": None,
        "is_active": True,
    },
    11: {
        "user_id": 11,
        "full_name": "Customer Two",
        "email": "cust2@causara.test",
        "role": "CUSTOMER",
        "seller_id": None,
        "business_name": None,
        "is_active": True,
    },
    20: {
        "user_id": 20,
        "full_name": "Seller One",
        "email": "seller1@causara.test",
        "role": "SELLER",
        "seller_id": 200,
        "business_name": "Seller One Logistics",
        "is_active": True,
    },
    30: {
        "user_id": 30,
        "full_name": "Analyst One",
        "email": "analyst1@causara.test",
        "role": "ANALYST",
        "seller_id": None,
        "business_name": None,
        "is_active": True,
    },
    40: {
        "user_id": 40,
        "full_name": "Manager One",
        "email": "manager1@causara.test",
        "role": "MANAGER",
        "seller_id": None,
        "business_name": None,
        "is_active": True,
    },
    50: {
        "user_id": 50,
        "full_name": "Auditor One",
        "email": "auditor1@causara.test",
        "role": "AUDITOR",
        "seller_id": None,
        "business_name": None,
        "is_active": True,
    },
    60: {
        "user_id": 60,
        "full_name": "Inactive User",
        "email": "inactive@causara.test",
        "role": "MANAGER",
        "seller_id": None,
        "business_name": None,
        "is_active": False,
    },
}


@pytest.fixture
def sec_app(monkeypatch):
    """Testing Flask app with mocked user repository for deterministic offline security tests."""
    app = create_app("testing")

    class _FakeUserRepo:
        def get_user_by_id(self, user_id: int, conn=None):
            return FAKE_USERS.get(user_id)

    monkeypatch.setattr(security_module, "_user_repo", _FakeUserRepo())
    return app


@pytest.fixture
def sec_client(sec_app):
    return sec_app.test_client()


def _token_for(app, user_id: int, expires_in_seconds: int = 3600) -> dict:
    user = FAKE_USERS[user_id]
    with app.app_context():
        token = security_module.create_access_token(
            user_id=user["user_id"],
            role=user["role"],
            seller_id=user["seller_id"],
            email=user["email"],
            full_name=user["full_name"],
            expires_in_seconds=expires_in_seconds,
        )
    return {"Authorization": f"Bearer {token}"}


# ============================================================================
# 1. Authentication & Token Integrity
# ============================================================================

def test_protected_endpoints_reject_missing_and_forged_tokens(sec_client):
    """Unauthenticated, forged, and expired tokens must receive HTTP 401."""
    # Missing token
    for method, path in [
        ("GET", "/api/v1/orders"),
        ("GET", "/api/v1/users"),
        ("GET", "/api/v1/actors"),
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/orders"),
        ("POST", "/api/v1/orders/1/evidence"),
        ("POST", "/api/v1/orders/1/delay-analysis"),
        ("POST", "/api/v1/cases/1/decisions"),
        ("POST", "/api/v1/decisions/1/approve"),
        ("POST", "/api/v1/decisions/1/verify"),
    ]:
        res = getattr(sec_client, method.lower())(path, json={})
        assert res.status_code == 401, f"{method} {path} returned {res.status_code}"

    # Forged / tampered token
    res_forged = sec_client.get("/api/v1/orders", headers={"Authorization": "Bearer v1.ZmFrZQ.ZmFrZQ"})
    assert res_forged.status_code == 401

    # Expired token
    expired_headers = _token_for(sec_client.application, 40, expires_in_seconds=-10)
    res_exp = sec_client.get("/api/v1/auth/me", headers=expired_headers)
    assert res_exp.status_code == 401
    assert res_exp.get_json()["error"]["code"] == "TOKEN_EXPIRED"

    # Deactivated account rejected
    inactive_headers = _token_for(sec_client.application, 60)
    res_inactive = sec_client.get("/api/v1/auth/me", headers=inactive_headers)
    assert res_inactive.status_code == 403
    assert res_inactive.get_json()["error"]["code"] == "ACCOUNT_INACTIVE"


# ============================================================================
# 2. Backend-Enforced RBAC Across Sensitive Operations
# ============================================================================

def test_rbac_order_creation_and_ownership(sec_app, sec_client, monkeypatch):
    """Only SELLER (own seller_id), MANAGER, or ADMIN may create orders; CUSTOMER owns reads."""
    created_calls = []

    class _FakeOrderService:
        def create_order(self, **kwargs):
            created_calls.append(kwargs)
            return {
                "order_id": 101,
                "seller_id": kwargs["seller_id"],
                "customer_user_id": kwargs["customer_user_id"],
                "external_order_ref": kwargs["external_order_ref"],
                "status": "PLACED",
                "stages": [],
            }

        def get_order(self, order_id: int):
            return {
                "order_id": order_id,
                "seller_id": 200,
                "customer_user_id": 10,
                "external_order_ref": "ORD-101",
                "status": "PLACED",
            }

    monkeypatch.setattr(orders_module, "_order_service", _FakeOrderService())

    future_ts = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    payload = {
        "seller_id": 200,
        "customer_user_id": 10,
        "external_order_ref": "ORD-RBAC-1",
        "expected_delivery_at": future_ts,
    }

    # CUSTOMER and AUDITOR denied 403
    for uid in (10, 50):
        res = sec_client.post("/api/v1/orders", json=payload, headers=_token_for(sec_app, uid))
        assert res.status_code == 403

    # SELLER attempting to create order for ANOTHER seller_id (999 != 200) denied 403
    res_spoof_seller = sec_client.post(
        "/api/v1/orders",
        json={**payload, "seller_id": 999},
        headers=_token_for(sec_app, 20),
    )
    assert res_spoof_seller.status_code == 403

    # SELLER creating for own seller_id succeeds 201
    res_ok = sec_client.post("/api/v1/orders", json=payload, headers=_token_for(sec_app, 20))
    assert res_ok.status_code == 201

    # CUSTOMER 10 can read own order 101; CUSTOMER 11 cannot (403)
    assert sec_client.get("/api/v1/orders/101", headers=_token_for(sec_app, 10)).status_code == 200
    assert sec_client.get("/api/v1/orders/101", headers=_token_for(sec_app, 11)).status_code == 403


def test_rbac_decision_approval_and_verification_permissions(sec_app, sec_client, monkeypatch):
    """Only MANAGER/ADMIN can approve/reject; ANALYST/AUDITOR/CUSTOMER cannot approve."""
    captured = {}

    class _FakeDecisionService:
        def record_decision(self, **kwargs):
            captured["record"] = kwargs
            return {"decision_id": 55, "decision_status": "PENDING", **kwargs}

        def approve_decision(self, **kwargs):
            captured["approve"] = kwargs
            return {"decision_id": kwargs["decision_id"], "decision_status": "APPROVED", **kwargs}

        def reject_decision(self, **kwargs):
            captured["reject"] = kwargs
            return {"decision_id": kwargs["decision_id"], "decision_status": "REJECTED", **kwargs}

        def verify_prediction(self, **kwargs):
            captured["verify"] = kwargs
            return {"verification_id": 77, **kwargs}

    monkeypatch.setattr(decisions_module, "_decision_service", _FakeDecisionService())

    # Record decision: CUSTOMER (10), SELLER (20), AUDITOR (50) forbidden; ANALYST (30) allowed
    for uid in (10, 20, 50):
        res = sec_client.post(
            "/api/v1/cases/1/decisions",
            json={"scenario_id": 2, "decided_by": 40, "rationale": "Test rationale"},
            headers=_token_for(sec_app, uid),
        )
        assert res.status_code == 403

    res_rec = sec_client.post(
        "/api/v1/cases/1/decisions",
        json={"scenario_id": 2, "decided_by": 999, "rationale": "Analyst rationale"},
        headers=_token_for(sec_app, 30),
    )
    assert res_rec.status_code == 201
    # Trusted actor attribution: decided_by MUST be 30 (from token), NOT 999 (client payload)
    assert captured["record"]["decided_by"] == 30

    # Approve/Reject: ANALYST (30), SELLER (20), AUDITOR (50), CUSTOMER (10) forbidden
    for uid in (10, 20, 30, 50):
        assert (
            sec_client.post(
                "/api/v1/decisions/55/approve",
                json={"manager_user_id": 40},
                headers=_token_for(sec_app, uid),
            ).status_code
            == 403
        )
        assert (
            sec_client.post(
                "/api/v1/decisions/55/reject",
                json={"manager_user_id": 40, "rejection_reason": "Too costly"},
                headers=_token_for(sec_app, uid),
            ).status_code
            == 403
        )

    # MANAGER (40) succeeds and manager_user_id is forced to 40 even if payload tries 999
    res_app = sec_client.post(
        "/api/v1/decisions/55/approve",
        json={"manager_user_id": 999},
        headers=_token_for(sec_app, 40),
    )
    assert res_app.status_code == 200
    assert captured["approve"]["manager_user_id"] == 40

    # Verify outcome: CUSTOMER (10) and SELLER (20) forbidden; AUDITOR (50) allowed
    assert (
        sec_client.post("/api/v1/decisions/55/verify", json={}, headers=_token_for(sec_app, 10)).status_code == 403
    )
    assert (
        sec_client.post("/api/v1/decisions/55/verify", json={}, headers=_token_for(sec_app, 50)).status_code == 200
    )


def test_system_internal_api_key_preserved_for_event_ingestion(sec_app, sec_client, monkeypatch):
    """Background/system event ingestion via X-Internal-API-Key remains functional."""

    class _FakeResult:
        is_duplicate = False

        def to_dict(self):
            return {"event_id": 1, "order_id": 5, "status": "INGESTED"}

    class _FakeEventService:
        def ingest_event(self, **kwargs):
            return _FakeResult()

    monkeypatch.setattr(events_module, "_event_service", _FakeEventService())

    # Without auth -> 401
    assert sec_client.post("/api/v1/orders/5/events", json={"event_type": "DISPATCHED"}).status_code == 401

    # CUSTOMER -> 403
    assert (
        sec_client.post(
            "/api/v1/orders/5/events",
            json={"event_type": "DISPATCHED"},
            headers=_token_for(sec_app, 10),
        ).status_code
        == 403
    )

    # Valid internal API key -> 201
    res = sec_client.post(
        "/api/v1/orders/5/events",
        json={"event_type": "DISPATCHED"},
        headers={"X-Internal-API-Key": sec_app.config["INTERNAL_API_KEY"]},
    )
    assert res.status_code == 201


# ============================================================================
# 3. Trusted Actor Attribution (Evidence, Delay Analysis, /auth/me)
# ============================================================================

def test_actor_spoofing_blocked_on_evidence_delay_and_me(sec_app, sec_client, monkeypatch):
    """Client-supplied uploaded_by, creator_user_id, and /auth/me?user_id= spoofing are ignored."""
    captured = {}

    class _FakeEvidenceService:
        def register_evidence(self, **kwargs):
            captured["evidence"] = kwargs
            return {
                "evidence_id": 1,
                "order_id": kwargs["order_id"],
                "event_id": None,
                "case_id": None,
                "uploaded_by": kwargs["uploaded_by"],
                "blob_uri": kwargs["blob_uri"],
                "file_name": kwargs["file_name"],
                "content_type": kwargs["content_type"],
                "sha256_hash": kwargs["sha256_hash"],
                "status": "ACTIVE",
            }

    class _FakeReport:
        def to_dict(self):
            return {"order_id": 5, "case_id": 9, "is_delayed": True}

    class _FakeDelayService:
        def analyze_order_delay(self, **kwargs):
            captured["delay"] = kwargs
            return _FakeReport()

    monkeypatch.setattr(evidence_module, "_evidence_service", _FakeEvidenceService())
    monkeypatch.setattr(delay_module, "_delay_service", _FakeDelayService())

    # Evidence: ANALYST (30) sends uploaded_by=999 -> backend forces 30
    res_ev = sec_client.post(
        "/api/v1/orders/5/evidence",
        json={
            "uploaded_by": 999,
            "file_name": "../../evil/../../pod.pdf",
            "content_type": "application/pdf",
            "blob_uri": "local://5/pod.pdf",
            "sha256_hash": "a" * 64,
        },
        headers=_token_for(sec_app, 30),
    )
    assert res_ev.status_code == 201
    assert captured["evidence"]["uploaded_by"] == 30
    assert captured["evidence"]["file_name"] == "pod.pdf"

    # Delay analysis: ANALYST (30) sends creator_user_id=40 -> backend forces 30
    res_del = sec_client.post(
        "/api/v1/orders/5/delay-analysis",
        json={"creator_user_id": 40, "persist_edges": True},
        headers=_token_for(sec_app, 30),
    )
    assert res_del.status_code == 200
    assert captured["delay"]["creator_user_id"] == 30

    # /auth/me?user_id=40 as user 10 returns ONLY user 10 (no IDOR)
    res_me = sec_client.get("/api/v1/auth/me?user_id=40", headers=_token_for(sec_app, 10))
    assert res_me.status_code == 200
    assert res_me.get_json()["data"]["user_id"] == 10
    assert res_me.get_json()["data"]["role"] == "CUSTOMER"


# ============================================================================
# 4. Password Hashing, Role Escalation & Demo Bypass Prevention
# ============================================================================

def test_password_hashing_role_escalation_and_demo_bypass(sec_client, monkeypatch):
    """Verify salted hashing, no login role spoofing, no ADMIN registration, no 4-char demo bypass."""
    stored_users = {}

    class _FakeAuthUserRepo:
        def get_user_by_email(self, email: str):
            return stored_users.get(email.lower())

        def create_user(self, full_name, email, password_hash, role_name, business_name=None):
            record = {
                "user_id": 701,
                "full_name": full_name,
                "email": email,
                "password_hash": password_hash,
                "role": role_name,
                "seller_id": None,
                "business_name": business_name,
                "is_active": True,
            }
            stored_users[email.lower()] = record
            return record

        def get_user_by_id(self, user_id: int):
            return next((u for u in stored_users.values() if u["user_id"] == user_id), None)

    monkeypatch.setattr(auth_module, "_user_repo", _FakeAuthUserRepo())
    monkeypatch.setattr(security_module, "_user_repo", _FakeAuthUserRepo())

    # 1. Self-registration as ADMIN is blocked (403)
    res_admin = sec_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Evil Admin",
            "email": "evil_admin@causara.test",
            "password": "StrongPassword123!",
            "role": "ADMIN",
        },
    )
    assert res_admin.status_code == 403

    # 2. Normal registration hashes password with salted scrypt/pbkdf2 and issues verifiable token
    res_reg = sec_client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Alice Customer",
            "email": "alice@causara.test",
            "password": "StrongPassword123!",
            "role": "CUSTOMER",
        },
    )
    assert res_reg.status_code == 201
    reg_data = res_reg.get_json()["data"]
    assert "password" not in reg_data
    assert "password_hash" not in reg_data
    stored_hash = stored_users["alice@causara.test"]["password_hash"]
    assert stored_hash.startswith(("scrypt:", "pbkdf2:"))
    assert "StrongPassword123!" not in stored_hash

    # Verify issued token works on /auth/me
    res_me = sec_client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {reg_data['token']}"},
    )
    assert res_me.status_code == 200
    assert res_me.get_json()["data"]["role"] == "CUSTOMER"

    # 3. Login role escalation attempt (CUSTOMER requesting MANAGER) -> 403 ROLE_MISMATCH
    res_esc = sec_client.post(
        "/api/v1/auth/login",
        json={
            "email": "alice@causara.test",
            "password": "StrongPassword123!",
            "role": "MANAGER",
        },
    )
    assert res_esc.status_code == 403
    assert res_esc.get_json()["error"]["code"] == "ROLE_MISMATCH"

    # 4. Wrong password rejected with 401
    res_bad_pw = sec_client.post(
        "/api/v1/auth/login",
        json={"email": "alice@causara.test", "password": "WrongPassword!"},
    )
    assert res_bad_pw.status_code == 401

    # 5. Demo account rejects arbitrary 4-char password ("abcd"), accepts "demo123"
    stored_users["demo_mgr@causara.com"] = {
        "user_id": 702,
        "full_name": "Demo Manager",
        "email": "demo_mgr@causara.com",
        "password_hash": "demo_argon2_hash",
        "role": "MANAGER",
        "is_active": True,
    }
    assert (
        sec_client.post(
            "/api/v1/auth/login",
            json={"email": "demo_mgr@causara.com", "password": "abcd"},
        ).status_code
        == 401
    )
    assert (
        sec_client.post(
            "/api/v1/auth/login",
            json={"email": "demo_mgr@causara.com", "password": "demo123"},
        ).status_code
        == 200
    )


# ============================================================================
# 5. SQL Injection & XSS Input/Output Safety
# ============================================================================

def test_sqli_pagination_and_xss_safety_headers(sec_app, sec_client, monkeypatch):
    """Verify safe handling of SQLi strings, pagination bounds, XSS payloads, and security headers."""
    captured = {}

    class _FakeScenarioService:
        def simulate_scenario(self, **kwargs):
            captured["scenario"] = kwargs
            return {"scenario_id": 12, **kwargs}

    monkeypatch.setattr(scenarios_module, "_scenario_service", _FakeScenarioService())

    headers = _token_for(sec_app, 30)  # ANALYST

    # 1. Invalid pagination / SQLi in limit/offset -> 400 BAD_REQUEST (never 500)
    res_bad_limit = sec_client.get("/api/v1/orders?limit=10;DROP TABLE orders", headers=headers)
    assert res_bad_limit.status_code == 400
    assert sec_client.get("/api/v1/orders?limit=99999", headers=headers).status_code == 400
    assert sec_client.get("/api/v1/orders?offset=-1", headers=headers).status_code == 400

    # 2. Control/null byte injection rejected
    res_null = sec_client.post(
        "/api/v1/cases/1/scenarios",
        json={"scenario_name": "bad\x00name", "intervention_ids": [1]},
        headers=headers,
    )
    assert res_null.status_code == 400

    # 3. XSS payload in JSON returns strictly as JSON with nosniff & CSP headers (never text/html)
    xss_name = "<script>alert('xss')</script>"
    res_xss = sec_client.post(
        "/api/v1/cases/1/scenarios",
        json={"scenario_name": xss_name, "intervention_ids": [1]},
        headers=headers,
    )
    assert res_xss.status_code == 201
    assert res_xss.content_type.startswith("application/json")
    assert res_xss.headers.get("X-Content-Type-Options") == "nosniff"
    assert res_xss.headers.get("X-Frame-Options") == "DENY"
    assert "default-src 'none'" in (res_xss.headers.get("Content-Security-Policy") or "")
    assert res_xss.get_json()["data"]["scenario_name"] == xss_name


def test_production_config_rejects_default_secret_key(monkeypatch):
    """Production app factory must refuse to start with the insecure default SECRET_KEY."""
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(ValueError, match="SECRET_KEY"):
        create_app("production")
