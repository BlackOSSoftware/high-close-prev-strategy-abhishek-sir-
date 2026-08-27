from __future__ import annotations

from trading_engine.domain.config import LegConfig
from trading_engine.domain.models import DistanceMode, OrderIntent, Side, Signal, Tick


def _distance(price: float, mode: DistanceMode, value: float, _point: float) -> float:
    if mode == DistanceMode.POINTS:
        # Product convention: one configured point is one full price unit.
        # Example on XAUUSD: entry 4474.17 + 5 points = target 4479.17.
        return value
    if mode == DistanceMode.PERCENT:
        return price * value / 100.0
    raise ValueError("reference candle distance is computed directly")


def build_order_intent(
    signal: Signal,
    tick: Tick,
    symbol: str,
    point: float,
    digits: int,
    leg_number: int,
    leg: LegConfig,
) -> OrderIntent:
    entry = tick.ask if signal.side == Side.BUY else tick.bid
    if leg.stop_loss.mode == DistanceMode.REFERENCE_CANDLE:
        sl = signal.reference.low if signal.side == Side.BUY else signal.reference.high
    else:
        sl_distance = _distance(entry, leg.stop_loss.mode, leg.stop_loss.value, point)
        sl = entry - sl_distance if signal.side == Side.BUY else entry + sl_distance

    tp_distance = _distance(entry, leg.take_profit.mode, leg.take_profit.value, point)
    tp = entry + tp_distance if signal.side == Side.BUY else entry - tp_distance
    return OrderIntent(
        side=signal.side,
        symbol=symbol,
        volume=leg.volume,
        stop_loss=round(sl, digits),
        take_profit=round(tp, digits),
        leg=leg_number,
        signal_time_msc=tick.time_msc,
    )
