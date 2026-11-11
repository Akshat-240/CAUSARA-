"""API v1 Blueprint and route registration."""

from flask import Blueprint
from app.api.health import health_bp
from app.api.events import events_bp
from app.api.outbox import internal_outbox_bp
from app.api.timeline import timeline_bp
from app.api.evidence import evidence_bp
from app.api.delay import delay_bp
from app.api.scenarios import scenarios_bp
from app.api.decisions import decisions_bp
from app.api.orders import orders_bp
from app.api.users import users_bp

api_v1 = Blueprint("api_v1", __name__)

# Register domain sub-blueprints onto API v1
api_v1.register_blueprint(health_bp)
api_v1.register_blueprint(events_bp)
api_v1.register_blueprint(internal_outbox_bp)
api_v1.register_blueprint(timeline_bp)
api_v1.register_blueprint(evidence_bp)
api_v1.register_blueprint(delay_bp)
api_v1.register_blueprint(scenarios_bp)
api_v1.register_blueprint(decisions_bp)
api_v1.register_blueprint(orders_bp)
api_v1.register_blueprint(users_bp)
