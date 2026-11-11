"""Evidence management service with local storage abstraction."""

from datetime import datetime, timezone
import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Optional
import pyodbc

from app.api.errors import APIError
from app.repositories.evidence_repository import EvidenceRepository
from app.repositories.timeline_repository import TimelineRepository

logger = logging.getLogger(__name__)

# Configurable upload limits
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/json",
    "text/csv",
}

DEFAULT_STORAGE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "storage", "evidence"))


class LocalStorageProvider:
    """Pluggable storage provider for local development.

    Designed to be drop-in replaced by AzureBlobStorageProvider in production.
    """

    def __init__(self, root_dir: str = DEFAULT_STORAGE_ROOT) -> None:
        self.root_dir = root_dir
        os.makedirs(self.root_dir, exist_ok=True)

    def store_file(self, order_id: int, file_name: str, file_bytes: bytes) -> Dict[str, Any]:
        """Store bytes locally, compute SHA-256 hash, and return metadata."""
        sha256 = hashlib.sha256(file_bytes).hexdigest()
        order_dir = os.path.join(self.root_dir, str(order_id))
        os.makedirs(order_dir, exist_ok=True)

        safe_name = f"{sha256[:16]}_{os.path.basename(file_name)}"
        file_path = os.path.join(order_dir, safe_name)

        if not os.path.exists(file_path):
            with open(file_path, "wb") as f:
                f.write(file_bytes)

        # URI abstraction that mimics blob reference
        blob_uri = f"local://evidence/{order_id}/{safe_name}"
        return {
            "blob_uri": blob_uri,
            "sha256_hash": sha256,
            "file_path": file_path,
            "size_bytes": len(file_bytes),
        }

    def read_file(self, blob_uri: str) -> Optional[bytes]:
        """Read bytes for a given blob URI."""
        if not blob_uri.startswith("local://evidence/"):
            return None
        rel_path = blob_uri.replace("local://evidence/", "").replace("/", os.sep)
        full_path = os.path.join(self.root_dir, rel_path)
        if os.path.exists(full_path):
            with open(full_path, "rb") as f:
                return f.read()
        return None


class EvidenceService:
    """Domain service for evidence registration, retrieval, and validation."""

    def __init__(
        self,
        repo: Optional[EvidenceRepository] = None,
        timeline_repo: Optional[TimelineRepository] = None,
        storage: Optional[LocalStorageProvider] = None,
    ) -> None:
        self.repo = repo or EvidenceRepository()
        self.timeline_repo = timeline_repo or TimelineRepository()
        self.storage = storage or LocalStorageProvider()

    def register_evidence(
        self,
        order_id: int,
        uploaded_by: int,
        file_name: str,
        content_type: str,
        file_bytes: Optional[bytes] = None,
        blob_uri: Optional[str] = None,
        sha256_hash: Optional[str] = None,
        event_id: Optional[int] = None,
        case_id: Optional[int] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Register evidence metadata and store payload.

        Validates:
        - Target order exists.
        - Uploader user exists.
        - Event ID belongs to target order (preventing cross-order reference).
        - Case ID belongs to target order (preventing cross-order reference).
        - Content type is allowed.
        - File size is within limits.
        """
        # 1. Validate order exists
        order = self.timeline_repo.get_order(order_id, conn=conn)
        if not order:
            raise APIError(
                code="ORDER_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )

        # 2. Validate uploader exists
        if not self.repo.validate_user_exists(uploaded_by, conn=conn):
            raise APIError(
                code="USER_NOT_FOUND",
                message=f"User {uploaded_by} does not exist.",
                status_code=404,
            )

        # 3. Validate content type
        normalized_ct = content_type.lower().split(";")[0].strip()
        if normalized_ct not in ALLOWED_CONTENT_TYPES:
            raise APIError(
                code="UNSUPPORTED_MEDIA_TYPE",
                message=f"Content-type '{content_type}' is not supported. Allowed: {sorted(ALLOWED_CONTENT_TYPES)}",
                status_code=415,
            )

        # 4. Cross-order validation for event_id
        if event_id is not None:
            if not self.repo.validate_order_event_relationship(order_id, event_id, conn=conn):
                raise APIError(
                    code="CROSS_ORDER_EVENT_REFERENCE",
                    message=f"Event {event_id} does not belong to order {order_id}.",
                    status_code=400,
                )

        # 5. Cross-order validation for case_id
        if case_id is not None:
            if not self.repo.validate_order_case_relationship(order_id, case_id, conn=conn):
                raise APIError(
                    code="CROSS_ORDER_CASE_REFERENCE",
                    message=f"Decision case {case_id} does not belong to order {order_id}.",
                    status_code=400,
                )

        # 6. Storage processing
        effective_blob_uri = blob_uri
        effective_hash = sha256_hash

        if file_bytes is not None:
            if len(file_bytes) > MAX_FILE_SIZE_BYTES:
                raise APIError(
                    code="FILE_TOO_LARGE",
                    message=f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES} bytes.",
                    status_code=413,
                )
            storage_meta = self.storage.store_file(order_id, file_name, file_bytes)
            effective_blob_uri = storage_meta["blob_uri"]
            effective_hash = storage_meta["sha256_hash"]

        if not effective_blob_uri:
            raise APIError(
                code="MISSING_BLOB_URI",
                message="Either file payload or a valid blob_uri must be supplied.",
                status_code=400,
            )

        if not effective_hash:
            raise APIError(
                code="MISSING_SHA256_HASH",
                message="A valid sha256_hash must be supplied when uploading without binary payload.",
                status_code=400,
            )

        now_utc = datetime.now(timezone.utc)

        # 7. Persist record in dbo.evidence
        evidence = self.repo.insert_evidence(
            order_id=order_id,
            uploaded_by=uploaded_by,
            blob_uri=effective_blob_uri,
            file_name=file_name,
            content_type=normalized_ct,
            sha256_hash=effective_hash,
            status="ACTIVE",
            event_id=event_id,
            case_id=case_id,
            completed_at=now_utc,
            conn=conn,
        )

        # 8. Audit log entry
        if evidence.get("evidence_id"):
            meta = {
                "file_name": file_name,
                "content_type": normalized_ct,
                "sha256_hash": effective_hash,
                "event_id": event_id,
                "case_id": case_id,
            }
            self.timeline_repo.insert_audit_log(
                actor_user_id=uploaded_by,
                action="EVIDENCE_REGISTERED",
                entity_type="EVIDENCE",
                entity_id=int(evidence["evidence_id"]),
                metadata_json=json.dumps(meta),
                conn=conn,
            )

        return evidence

    def get_evidence(self, evidence_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve evidence metadata by ID."""
        record = self.repo.get_evidence_by_id(evidence_id)
        if not record:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Evidence {evidence_id} does not exist.",
                status_code=404,
            )
        return record

    def list_evidence_for_order(
        self,
        order_id: int,
        event_id: Optional[int] = None,
        case_id: Optional[int] = None,
        stage_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List evidence for an order with optional event, case, or stage filters."""
        order = self.timeline_repo.get_order(order_id)
        if not order:
            raise APIError(
                code="ORDER_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )

        if stage_id is not None:
            return self.repo.list_evidence_by_stage(order_id=order_id, stage_id=stage_id)

        return self.repo.list_evidence(order_id=order_id, event_id=event_id, case_id=case_id)
