import time
from typing import Any

from trading_engine.domain.config import ExitConfig, LegConfig, StrategyConfig
from trading_engine.domain.models import DistanceMode
from trading_engine.infrastructure.mt5_gateway import MT5Error
from trading_engine.services.engine import TradingEngine


class NullDatabase:
    def emit(self, _event_type: str, _payload: Any) -> None:
        pass


class InvalidSymbolGateway:
    def __init__(self) -> None:
        self.disconnected = False

    def connect(self) -> None:
        pass

    def connection_info(self) -> dict[str, Any]:
        return {"terminal": "Test MT5", "broker": "Broker", "server": "Demo", "login": 1}

    def select_symbol(self, symbol: str) -> None:
        raise MT5Error(f"Symbol '{symbol}' does not exist on this broker")

    def search_symbols(self, _query: str) -> list[dict[str, str]]:
        return [{"name": "GOLD.a", "description": "Gold", "currency": "USD"}]

    def disconnect(self) -> None:
        self.disconnected = True


def wait_for(events: list[dict[str, Any]], event_type: str) -> dict[str, Any]:
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        match = next((event for event in events if event["type"] == event_type), None)
        if match:
            return match
        time.sleep(0.01)
    raise AssertionError(f"Timed out waiting for {event_type}")


def test_invalid_symbol_keeps_command_loop_available_for_broker_search() -> None:
    events: list[dict[str, Any]] = []
    leg = LegConfig(
        volume=0.01,
        stop_loss=ExitConfig(mode=DistanceMode.POINTS, value=10),
        take_profit=ExitConfig(mode=DistanceMode.POINTS, value=10),
    )
    engine = TradingEngine(
        StrategyConfig(symbol="XAUUSD", legs=[leg]),
        NullDatabase(),  # type: ignore[arg-type]
        events.append,
    )
    gateway = InvalidSymbolGateway()
    engine._gateway = gateway  # type: ignore[assignment]

    engine.start()
    try:
        error = wait_for(events, "engine_error")
        assert "does not exist" in error["payload"]["message"]

        engine.search_symbols("gold")
        results = wait_for(events, "symbol_results")
        assert results["payload"]["items"][0]["name"] == "GOLD.a"
        assert engine._thread is not None and engine._thread.is_alive()
    finally:
        engine.stop()

    assert gateway.disconnected
