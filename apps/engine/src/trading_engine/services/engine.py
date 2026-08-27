from __future__ import annotations

import queue
import threading
import time
from collections.abc import Callable
from dataclasses import asdict
from typing import Any

from trading_engine.domain.config import StrategyConfig
from trading_engine.domain.models import Side
from trading_engine.infrastructure.database import AsyncDatabaseWriter
from trading_engine.infrastructure.mt5_gateway import MT5Error, MT5Gateway
from trading_engine.services.risk import build_order_intent
from trading_engine.services.strategy import PatternEngine


class TradingEngine:
    def __init__(
        self,
        config: StrategyConfig,
        database: AsyncDatabaseWriter,
        publish: Callable[[dict[str, Any]], None],
        persist_config: Callable[[StrategyConfig], None] | None = None,
    ) -> None:
        self._config = config
        self._database = database
        self._publish = publish
        self._persist_config = persist_config
        self._gateway = MT5Gateway()
        self._pattern = PatternEngine()
        self._commands: queue.SimpleQueue[tuple[str, Any]] = queue.SimpleQueue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._leg_details: dict[int, dict[str, Any]] = {}
        self._next_leg_number = 1

    def _select_leg_number(self, open_legs: set[int]) -> int | None:
        enabled = [index + 1 for index, leg in enumerate(self._config.legs) if leg.enabled]
        available = [number for number in enabled if number not in open_legs]
        if not available:
            return None
        if self._config.closed_leg_behavior == "same_leg":
            return available[0]
        ordered = [number for number in enabled if number >= self._next_leg_number]
        ordered.extend(number for number in enabled if number < self._next_leg_number)
        return next((number for number in ordered if number in available), None)

    def _record_filled_leg(self, leg_number: int) -> None:
        enabled = [index + 1 for index, leg in enumerate(self._config.legs) if leg.enabled]
        if not enabled:
            self._next_leg_number = 1
            return
        try:
            position = enabled.index(leg_number)
        except ValueError:
            self._next_leg_number = enabled[0]
        else:
            self._next_leg_number = enabled[(position + 1) % len(enabled)]

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="mt5-trading", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def update_config(self, config: StrategyConfig) -> None:
        self._commands.put(("config", config))

    def search_symbols(self, query: str) -> None:
        self._commands.put(("search_symbols", query))

    def close_position(self, ticket: int) -> None:
        self._commands.put(("close_position", ticket))

    def request_chart(self, timeframe: str) -> None:
        self._commands.put(("request_chart", timeframe))

    def _event(self, event_type: str, payload: Any) -> None:
        if hasattr(payload, "__dataclass_fields__"):
            payload = asdict(payload)
        event = {"type": event_type, "payload": payload}
        self._database.emit(event_type, payload)
        self._publish(event)

    def _apply_commands(self) -> None:
        while not self._commands.empty():
            command, value = self._commands.get_nowait()
            if command == "config":
                reconnect = (value.symbol, value.timeframe) != (
                    self._config.symbol,
                    self._config.timeframe,
                )
                self._config = value
                if reconnect:
                    self._gateway.disconnect()
                    self._gateway.connect(value.symbol)
                    self._pattern.reset()
                self._event("config_applied", value.model_dump(mode="json"))
            elif command == "search_symbols":
                try:
                    results = self._gateway.search_symbols(str(value))
                    self._publish({"type": "symbol_results", "payload": {"items": results}})
                except MT5Error as exc:
                    self._publish(
                        {"type": "symbol_results", "payload": {"items": [], "error": str(exc)}}
                    )
            elif command == "close_position":
                try:
                    result = self._gateway.close_position(int(value), self._config.deviation_points)
                    self._event("position_closed", result)
                except MT5Error as exc:
                    self._event("position_close_rejected", {"ticket": value, "message": str(exc)})
            elif command == "request_chart":
                try:
                    candles = self._gateway.recent_candles(
                        self._config.symbol, str(value), 500
                    )
                    self._publish(
                        {
                            "type": "chart_history",
                            "payload": {"timeframe": value, "candles": candles},
                        }
                    )
                except MT5Error as exc:
                    self._publish(
                        {"type": "chart_error", "payload": {"message": str(exc)}}
                    )

    def _run(self) -> None:
        try:
            self._gateway.connect(self._config.symbol)
            point, digits = self._gateway.symbol_spec(self._config.symbol)
            last_bar = self._gateway.current_bar_time(self._config.symbol, self._config.timeframe)
            latest_candle = self._gateway.last_closed_candle(
                self._config.symbol, self._config.timeframe
            )
            self._pattern.on_closed_candle(latest_candle)
            if self._gateway.open_strategy_positions(
                self._config.symbol, self._config.magic_number
            ):
                self._pattern.lock(
                    Side.BUY if self._config.direction == "buy" else Side.SELL
                )
            open_legs = self._gateway.open_strategy_leg_numbers(
                self._config.symbol, self._config.magic_number
            )
            if open_legs:
                self._record_filled_leg(max(open_legs))
            trend = "buy" if latest_candle.bullish else "sell"
            last_published_tick = 0
            last_dashboard_publish = 0.0
            signal_status = "waiting"
            chart_candles = self._gateway.recent_candles(
                self._config.symbol, self._config.timeframe
            )
            self._event("engine_status", {"running": True, "connected": True})
            while not self._stop.is_set():
                previous_market = (self._config.symbol, self._config.timeframe)
                self._apply_commands()
                config = self._config
                if previous_market != (config.symbol, config.timeframe):
                    point, digits = self._gateway.symbol_spec(config.symbol)
                    last_bar = self._gateway.current_bar_time(config.symbol, config.timeframe)
                    latest_candle = self._gateway.last_closed_candle(
                        config.symbol, config.timeframe
                    )
                    self._pattern.on_closed_candle(latest_candle)
                    trend = "buy" if latest_candle.bullish else "sell"
                    chart_candles = self._gateway.recent_candles(
                        config.symbol, config.timeframe
                    )
                tick = self._gateway.tick(config.symbol)
                if chart_candles:
                    live_price = tick.bid
                    chart_candles[-1]["close"] = live_price
                    chart_candles[-1]["high"] = max(chart_candles[-1]["high"], live_price)
                    chart_candles[-1]["low"] = min(chart_candles[-1]["low"], live_price)
                if tick.time_msc != last_published_tick:
                    last_published_tick = tick.time_msc
                    self._publish(
                        {
                            "type": "market_tick",
                            "payload": {
                                "symbol": config.symbol,
                                "bid": tick.bid,
                                "ask": tick.ask,
                                "trend": trend,
                                "time_msc": tick.time_msc,
                            },
                        }
                    )
                now = time.monotonic()
                if now - last_dashboard_publish >= 0.5:
                    last_dashboard_publish = now
                    dashboard = self._gateway.dashboard_snapshot(
                        config.symbol, config.magic_number
                    )
                    for position in dashboard["positions"]:
                        try:
                            leg_number = int(position["comment"].rsplit("L", 1)[1])
                        except (IndexError, ValueError):
                            leg_number = 0
                        position["leg"] = leg_number
                        position["signal"] = self._leg_details.get(leg_number)
                    reference = self._pattern.reference(
                        Side.BUY if config.direction == "buy" else Side.SELL
                    )
                    dashboard.update(
                        {
                            "signal_status": (
                                "trade_active" if dashboard["positions"] else signal_status
                            ),
                            "active_legs": len(dashboard["positions"]),
                            "next_leg": self._select_leg_number(
                                {int(position["leg"]) for position in dashboard["positions"]}
                            ) or 0,
                            "reference": (
                                {
                                    "time": reference.time.isoformat(),
                                    "open": reference.open,
                                    "high": reference.high,
                                    "low": reference.low,
                                    "close": reference.close,
                                }
                                if reference
                                else None
                            ),
                            "candles": chart_candles,
                            "remaining_seconds": max(
                                0,
                                last_bar
                                + timeframe_seconds(config.timeframe)
                                - tick.time_msc // 1000,
                            ),
                            "condition_met": bool(
                                reference
                                and chart_candles
                                and (
                                    (
                                        config.direction == "buy"
                                        and chart_candles[-1]["close"] > chart_candles[-1]["open"]
                                        and chart_candles[-1]["close"] > reference.high
                                        and chart_candles[-1]["low"] >= reference.low
                                    )
                                    or (
                                        config.direction == "sell"
                                        and chart_candles[-1]["close"] < chart_candles[-1]["open"]
                                        and chart_candles[-1]["close"] < reference.low
                                        and chart_candles[-1]["high"] <= reference.high
                                    )
                                )
                            ),
                        }
                    )
                    self._publish({"type": "dashboard_snapshot", "payload": dashboard})
                # MetaTrader's Python module exposes no push callback. Poll only the tiny
                # tick structure and cross the known bar boundary; CopyRates runs once per bar.
                if tick.time_msc // 1000 >= last_bar + timeframe_seconds(config.timeframe):
                    current_bar = self._gateway.current_bar_time(config.symbol, config.timeframe)
                    if current_bar == last_bar:
                        time.sleep(config.poll_interval_ms / 1000.0)
                        continue
                    last_bar = current_bar
                    chart_candles = self._gateway.recent_candles(
                        config.symbol, config.timeframe
                    )
                    candle = self._gateway.last_closed_candle(config.symbol, config.timeframe)
                    trend = "buy" if candle.bullish else "sell"
                    self._event("candle_closed", candle)
                    signals = self._pattern.on_closed_candle(candle)
                    signal_status = "waiting"
                    for signal in signals:
                        if not config.enabled or config.direction != signal.side.value:
                            continue
                        signal_status = "signal_found"
                        open_legs = self._gateway.open_strategy_leg_numbers(
                            config.symbol, config.magic_number
                        )
                        leg_number = self._select_leg_number(open_legs)
                        if leg_number is None:
                            signal_status = "max_legs"
                            self._event("signal_rejected", {"reason": "max_legs"})
                            continue
                        leg = config.legs[leg_number - 1]
                        intent = build_order_intent(
                            signal, tick, config.symbol, point, digits, leg_number, leg
                        )
                        self._event("order_intent", intent)
                        try:
                            result = self._gateway.send_market_order(
                                intent, config.magic_number, config.deviation_points
                            )
                        except MT5Error as exc:
                            signal_status = "order_rejected"
                            self._event("order_rejected", {"message": str(exc), "leg": intent.leg})
                        else:
                            signal_status = "order_filled"
                            self._record_filled_leg(intent.leg)
                            self._leg_details[intent.leg] = {
                                "reference": candle_payload(signal.reference),
                                "confirmation": candle_payload(signal.confirmation),
                                "signal_time_msc": intent.signal_time_msc,
                            }
                            self._event("order_filled", result)
                            if config.stop_after_entry:
                                stopped = config.model_copy(update={"enabled": False})
                                self._config = stopped
                                if self._persist_config:
                                    self._persist_config(stopped)
                                self._event("config_applied", stopped.model_dump(mode="json"))
                time.sleep(config.poll_interval_ms / 1000.0)
        except Exception as exc:  # noqa: BLE001 - process boundary must report fatal failures
            self._event("engine_error", {"message": str(exc)})
        finally:
            self._gateway.disconnect()
            self._event("engine_status", {"running": False, "connected": False})


def timeframe_seconds(timeframe: str) -> int:
    unit = timeframe[0]
    amount = int(timeframe[1:])
    multipliers = {"M": 60, "H": 3600, "D": 86400}
    try:
        return amount * multipliers[unit]
    except (KeyError, ValueError) as exc:
        raise ValueError(f"Unsupported timeframe: {timeframe}") from exc


def candle_payload(candle: Any) -> dict[str, Any]:
    return {
        "time": candle.time.isoformat(),
        "open": candle.open,
        "high": candle.high,
        "low": candle.low,
        "close": candle.close,
    }
