"""Tests verifying centralized error handling and standard error envelopes."""

from app.api.errors import APIError


def test_404_not_found_envelope(client):
    """Verify requesting an unknown route produces standard 404 JSON error envelope."""
    response = client.get("/api/v1/non-existent-endpoint")
    assert response.status_code == 404
    assert response.is_json

    body = response.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "RESOURCE_NOT_FOUND"
    assert "error" in body
    assert "meta" in body
    assert "request_id" in body["meta"]


def test_405_method_not_allowed_envelope(client):
    """Verify using an invalid HTTP method returns standard 405 error envelope."""
    response = client.post("/api/v1/health")
    assert response.status_code == 405
    assert response.is_json

    body = response.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_custom_api_error_handling(app, client):
    """Verify raising an APIError produces corresponding structured response."""
    # Temporarily register test route on app
    @app.route("/api/v1/test-custom-error")
    def trigger_custom_error():
        raise APIError(
            code="SAMPLE_DOMAIN_ERROR",
            message="A domain constraint was breached.",
            status_code=422,
            details={"field": "order_id", "issue": "must be positive integer"},
        )

    response = client.get("/api/v1/test-custom-error")
    assert response.status_code == 422
    assert response.is_json

    body = response.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "SAMPLE_DOMAIN_ERROR"
    assert body["error"]["message"] == "A domain constraint was breached."
    assert body["error"]["details"]["field"] == "order_id"
