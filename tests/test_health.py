"""Tests verifying health check endpoint and standard envelope structure."""


def test_health_check_success(client):
    """Verify /api/v1/health returns 200 with standard success envelope."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.is_json

    body = response.get_json()
    assert body["success"] is True

    # Data payload verification
    data = body["data"]
    assert data["status"] == "healthy"
    assert data["service"] == "causara-api"
    assert data["version"] == "1.0.0"
    assert data["environment"] == "testing"

    # Meta envelope verification
    meta = body["meta"]
    assert "request_id" in meta
    assert "timestamp" in meta
    assert meta["request_id"].startswith("req_")


def test_health_check_propagates_request_id(client):
    """Verify incoming X-Request-ID header is preserved in metadata and response headers."""
    custom_req_id = "req_custom_trace_987654321"
    response = client.get("/api/v1/health", headers={"X-Request-ID": custom_req_id})

    assert response.status_code == 200
    assert response.headers.get("X-Request-ID") == custom_req_id

    body = response.get_json()
    assert body["meta"]["request_id"] == custom_req_id
