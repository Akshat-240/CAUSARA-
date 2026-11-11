"""Data access repository for interventions and simulated decision scenarios."""

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


class ScenarioRepository:
    """Repository handling database operations for interventions and scenarios."""

    def list_active_interventions(
        self,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve all active candidate interventions."""
        query = """
            SELECT intervention_id, intervention_code, name, description, intervention_type, is_active
            FROM dbo.interventions
            WHERE is_active = 1
            ORDER BY intervention_id ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query)
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query)
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def get_intervention_by_id(
        self,
        intervention_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve an intervention by its primary key."""
        query = """
            SELECT intervention_id, intervention_code, name, description, intervention_type, is_active
            FROM dbo.interventions
            WHERE intervention_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (intervention_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (intervention_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_intervention_by_code(
        self,
        code: str,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve an intervention by unique code."""
        query = """
            SELECT intervention_id, intervention_code, name, description, intervention_type, is_active
            FROM dbo.interventions
            WHERE intervention_code = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (code,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (code,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def insert_scenario(
        self,
        case_id: int,
        scenario_name: str,
        predicted_time_saved_minutes: Optional[int],
        estimated_cost: Optional[float],
        risk_level: str,
        confidence_score: Optional[float],
        status: str = "READY",
        cosmos_document_id: Optional[str] = None,
        model_version: Optional[str] = "v1.0-rules-engine",
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Insert a simulated scenario and return the inserted record."""
        query = """
            SET NOCOUNT ON;
            DECLARE @inserted_ids TABLE (scenario_id BIGINT);
            INSERT INTO dbo.scenarios (
                case_id, scenario_name, status, predicted_time_saved_minutes,
                estimated_cost, risk_level, confidence_score, cosmos_document_id,
                model_version, created_at
            )
            OUTPUT INSERTED.scenario_id INTO @inserted_ids
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, SYSUTCDATETIME());
            SELECT s.scenario_id, s.case_id, s.scenario_name, s.status,
                   s.predicted_time_saved_minutes, s.estimated_cost, s.risk_level,
                   s.confidence_score, s.cosmos_document_id, s.model_version, s.created_at
            FROM dbo.scenarios s
            JOIN @inserted_ids ids ON s.scenario_id = ids.scenario_id;
        """
        params = (
            case_id, scenario_name, status, predicted_time_saved_minutes,
            estimated_cost, risk_level, confidence_score, cosmos_document_id, model_version,
        )

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                managed_conn.commit()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

    def insert_scenario_intervention(
        self,
        scenario_id: int,
        intervention_id: int,
        estimated_cost_contribution: Optional[float] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> None:
        """Associate an intervention with a simulated scenario."""
        query = """
            INSERT INTO dbo.scenario_interventions (scenario_id, intervention_id, estimated_cost_contribution)
            VALUES (?, ?, ?);
        """
        params = (scenario_id, intervention_id, estimated_cost_contribution)

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
            finally:
                cur.close()
            return

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                managed_conn.commit()
            finally:
                cur.close()

    def get_scenario_by_id(
        self,
        scenario_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve scenario by id along with its linked interventions."""
        scenario_query = """
            SELECT scenario_id, case_id, scenario_name, status,
                   predicted_time_saved_minutes, estimated_cost, risk_level,
                   confidence_score, cosmos_document_id, model_version, created_at
            FROM dbo.scenarios
            WHERE scenario_id = ?;
        """
        interventions_query = """
            SELECT si.intervention_id, si.estimated_cost_contribution,
                   i.intervention_code, i.name, i.intervention_type, i.description
            FROM dbo.scenario_interventions si
            JOIN dbo.interventions i ON si.intervention_id = i.intervention_id
            WHERE si.scenario_id = ?
            ORDER BY si.intervention_id ASC;
        """

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(scenario_query, (scenario_id,))
                scenario = _row_to_dict(cur, cur.fetchone())
                if not scenario:
                    return None
                cur.execute(interventions_query, (scenario_id,))
                scenario["interventions"] = _rows_to_dicts(cur, cur.fetchall())
                return scenario
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(scenario_query, (scenario_id,))
                scenario = _row_to_dict(cur, cur.fetchone())
                if not scenario:
                    return None
                cur.execute(interventions_query, (scenario_id,))
                scenario["interventions"] = _rows_to_dicts(cur, cur.fetchall())
                return scenario
            finally:
                cur.close()

    def list_scenarios_by_case(
        self,
        case_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve all simulated scenarios for a decision case."""
        query = """
            SELECT scenario_id, case_id, scenario_name, status,
                   predicted_time_saved_minutes, estimated_cost, risk_level,
                   confidence_score, cosmos_document_id, model_version, created_at
            FROM dbo.scenarios
            WHERE case_id = ?
            ORDER BY scenario_id ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (case_id,))
                scenarios = _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()
        else:
            with get_db_connection() as managed_conn:
                cur = managed_conn.cursor()
                try:
                    cur.execute(query, (case_id,))
                    scenarios = _rows_to_dicts(cur, cur.fetchall())
                finally:
                    cur.close()

        # Attach interventions to each scenario
        for s in scenarios:
            s_id = s["scenario_id"]
            if conn is not None:
                cur = conn.cursor()
                try:
                    cur.execute(
                        """
                        SELECT si.intervention_id, si.estimated_cost_contribution,
                               i.intervention_code, i.name, i.intervention_type, i.description
                        FROM dbo.scenario_interventions si
                        JOIN dbo.interventions i ON si.intervention_id = i.intervention_id
                        WHERE si.scenario_id = ?
                        ORDER BY si.intervention_id ASC;
                        """,
                        (s_id,),
                    )
                    s["interventions"] = _rows_to_dicts(cur, cur.fetchall())
                finally:
                    cur.close()
            else:
                with get_db_connection() as managed_conn:
                    cur = managed_conn.cursor()
                    try:
                        cur.execute(
                            """
                            SELECT si.intervention_id, si.estimated_cost_contribution,
                                   i.intervention_code, i.name, i.intervention_type, i.description
                            FROM dbo.scenario_interventions si
                            JOIN dbo.interventions i ON si.intervention_id = i.intervention_id
                            WHERE si.scenario_id = ?
                            ORDER BY si.intervention_id ASC;
                            """,
                            (s_id,),
                        )
                        s["interventions"] = _rows_to_dicts(cur, cur.fetchall())
                    finally:
                        cur.close()

        return scenarios
