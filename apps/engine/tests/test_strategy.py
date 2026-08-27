from datetime import UTC, datetime

from trading_engine.domain.models import Candle, Side
from trading_engine.services.engine import timeframe_seconds
from trading_engine.services.strategy import PatternEngine


def candle(open_: float, high: float, low: float, close: float) -> Candle:
    return Candle(datetime.now(UTC), open_, high, low, close)


def test_buy_requires_green_close_above_without_breaking_reference_low():
    engine = PatternEngine()
    assert engine.on_closed_candle(candle(90, 100, 89, 98)) == []
    signals = engine.on_closed_candle(candle(98, 104, 92, 103))
    assert len(signals) == 1
    assert signals[0].side == Side.BUY


def test_buy_outside_candle_becomes_reference_and_waits_for_next_candle():
    engine = PatternEngine()
    engine.on_closed_candle(candle(90, 100, 89, 98))
    assert engine.on_closed_candle(candle(96, 105, 87, 103)) == []
    signals = engine.on_closed_candle(candle(102, 108, 90, 107))
    assert len(signals) == 1
    assert signals[0].reference.high == 105
    assert signals[0].reference.low == 87


def test_sell_is_exact_opposite():
    engine = PatternEngine()
    engine.on_closed_candle(candle(110, 112, 100, 102))
    signals = engine.on_closed_candle(candle(103, 109, 96, 98))
    assert len(signals) == 1
    assert signals[0].side == Side.SELL


def test_timeframe_duration():
    assert timeframe_seconds("M1") == 60
    assert timeframe_seconds("H4") == 14_400


def test_buy_requires_red_reset_before_next_signal():
    engine = PatternEngine()
    engine.on_closed_candle(candle(90, 100, 89, 98))
    assert len(engine.on_closed_candle(candle(98, 104, 92, 103))) == 1
    assert engine.on_closed_candle(candle(103, 108, 100, 107)) == []
    assert engine.on_closed_candle(candle(107, 108, 96, 99)) == []
    signals = engine.on_closed_candle(candle(99, 110, 100, 109))
    assert len(signals) == 1
    assert signals[0].side == Side.BUY


def test_sell_requires_green_reset_before_next_signal():
    engine = PatternEngine()
    engine.on_closed_candle(candle(110, 112, 100, 102))
    assert len(engine.on_closed_candle(candle(102, 108, 96, 98))) == 1
    assert engine.on_closed_candle(candle(98, 104, 92, 94)) == []
    assert engine.on_closed_candle(candle(94, 101, 93, 100)) == []
    signals = engine.on_closed_candle(candle(100, 101, 88, 90))
    assert len(signals) == 1
    assert signals[0].side == Side.SELL
