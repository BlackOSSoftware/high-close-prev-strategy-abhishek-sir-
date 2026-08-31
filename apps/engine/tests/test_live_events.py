from datetime import UTC, datetime

from trading_engine.live_events import encode_live_event


def test_encode_live_event_converts_nested_datetime_for_websocket() -> None:
    timestamp = datetime(2026, 8, 31, 8, 30, tzinfo=UTC)
    event = encode_live_event(
        {"type": "candle_closed", "payload": {"time": timestamp}}
    )

    assert event["payload"]["time"] == "2026-08-31T08:30:00+00:00"
