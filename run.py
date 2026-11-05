"""WSGI entrypoint for Causara REST API."""

import os
from dotenv import load_dotenv
from app import create_app

# Load local environment variables from .env if present
load_dotenv()

env_name = os.getenv("FLASK_ENV", "development")
app = create_app(env_name)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug_mode = app.config.get("DEBUG", False)
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
