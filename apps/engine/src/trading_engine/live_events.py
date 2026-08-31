from typing import Any

from fastapi.encoders import jsonable_encoder


def encode_live_event(event: dict[str, Any]) -> dict[str, Any]:
    """Return an event containing only values supported by JSON/WebSocket transport."""
    return jsonable_encoder(event)
