"""Data access repository for operational decisions and prediction verifications."""

from datetime import datetime
import logging
from typing import Any, Dict, List, Optional
import pyodbc

from app.database.connection import get_db_connection

logger = logging.getLogger(__name__)


def _row_to_dict(cursor: pyodbc.Cursor, row: Optional[pyodbc.Row]) -> Optional[Dict[str, Any]]:
    """Convert a pyodbc Row into a dictionary using cursor description."""
    if row is None or not cursor.description:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def _rows_to_dicts(cursor: pyodbc.Cursor, rows: List[pyodbc.Row]) -> List[Dict[str, Any]]:
    """Convert a list of pyodbc Rows into a list of dictionaries."""
    if not rows or not cursor.description:
        return []
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


class DecisionRepository:
    """Repository wrapping decision-making stored procedures and outcome verification."""

    def record_decision(
        self,
        case_id: int,
        scenario_id: int,
        decided_by: int,
        rationale: str,
        conn: Optional[pyodbc.Connection] = None,
    ) -> int:
        """Execute usp_RecordDecision to persist a decision in PENDING status."""
        query = """
            SET NOCOUNT ON;
            DECLARE @NewId BIGINT;
            EXEC dbo.usp_RecordDecision
                @CaseId = ?,
                @ScenarioId = ?,
                @DecidedBy = ?,
                @Rationale = ?,
                @NewDecisionId = @NewId OUTPUT;
            SELECT @NewId AS decision_id;
        """
        params = (case_id, scenario_id, decided_by, rationale)

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                return int(row[0]) if row and row[0] else 0
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                managed_conn.commit()
                return int(row[0]) if row and row[0] else 0
            finally:
                cur.close()

    def approve_decision(
        self,
        decision_id: int,
        manager_user_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Execute usp_ApproveDecision to approve a decision and emit outbox event."""
        query = """
            EXEC dbo.usp_ApproveDecision
                @DecisionId = ?,
                @ManagerUserId = ?;
        """
        params = (decision_id, manager_user_id)

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                return True
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                managed_conn.commit()
                return True
            finally:
                cur.close()

    def reject_decision(
        self,
        decision_id: int,
        manager_user_id: int,
        rejection_reason: str,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Transition decision to REJECTED with rejection reason."""
        query = """
            UPDATE dbo.decisions
            SET decision_status = 'REJECTED',
                approved_by = ?,
                approved_at = SYSUTCDATETIME(),
                rationale = CASE
                    WHEN rationale IS NULL THEN ?
                    ELSE rationale + ' | Rejection: ' + ?
                END
            WHERE decision_id = ?
              AND decision_status = 'PENDING';
        """
        params = (manager_user_id, rejection_reason, rejection_reason, decision_id)

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                return cur.rowcount == 1
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                managed_conn.commit()
                return cur.rowcount == 1
            finally:
                cur.close()

    def verify_prediction(
        self,
        decision_id: int,
        actual_delivery_at: datetime,
        outcome_notes: Optional[str] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Execute usp_VerifyPrediction to record or update verified prediction outcomes."""
        query = """
            EXEC dbo.usp_VerifyPrediction
                @DecisionId = ?,
                @ActualDeliveryAt = ?,
                @OutcomeNotes = ?;
        """
        params = (decision_id, actual_delivery_at, outcome_notes or "Delivery outcome verified.")

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                return True
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                managed_conn.commit()
                return True
            finally:
                cur.close()

    def get_decision_by_id(
        self,
        decision_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve decision details with joined scenario and user info."""
        query = """
            SELECT d.decision_id, d.case_id, d.scenario_id, d.decided_by,
                   d.approved_by, d.decision_status, d.rationale, d.selected_at, d.approved_at,
                   s.scenario_name, s.predicted_time_saved_minutes, s.estimated_cost,
                   s.risk_level, s.confidence_score,
                   u_dec.full_name AS decided_by_name,
                   u_app.full_name AS approved_by_name
            FROM dbo.decisions d
            JOIN dbo.scenarios s ON d.scenario_id = s.scenario_id
            JOIN dbo.users u_dec ON d.decided_by = u_dec.user_id
            LEFT JOIN dbo.users u_app ON d.approved_by = u_app.user_id
            WHERE d.decision_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (decision_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (decision_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def list_decisions_by_case(
        self,
        case_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """List all decisions made on a decision case."""
        query = """
            SELECT d.decision_id, d.case_id, d.scenario_id, d.decided_by,
                   d.approved_by, d.decision_status, d.rationale, d.selected_at, d.approved_at,
                   s.scenario_name, s.predicted_time_saved_minutes, s.estimated_cost,
                   s.risk_level, s.confidence_score,
                   u_dec.full_name AS decided_by_name,
                   u_app.full_name AS approved_by_name
            FROM dbo.decisions d
            JOIN dbo.scenarios s ON d.scenario_id = s.scenario_id
            JOIN dbo.users u_dec ON d.decided_by = u_dec.user_id
            LEFT JOIN dbo.users u_app ON d.approved_by = u_app.user_id
            WHERE d.case_id = ?
            ORDER BY d.decision_id DESC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (case_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (case_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def get_verification_by_decision_id(
        self,
        decision_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve verified outcome metrics for a decision."""
        query = """
            SELECT verification_id, decision_id, measured_at, original_expected_delivery_at,
                   baseline_estimated_delivery_at, predicted_delivery_at, actual_delivery_at,
                   signed_prediction_error_minutes, absolute_prediction_error_minutes,
                   delivery_variance_minutes, outcome_notes
            FROM dbo.verifications
            WHERE decision_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (decision_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (decision_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()
