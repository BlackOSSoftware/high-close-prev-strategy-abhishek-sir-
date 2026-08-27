from __future__ import annotations

from trading_engine.domain.models import Candle, Side, Signal


class PatternEngine:
    """Pure candle state machine. It never performs I/O or places orders."""

    __slots__ = ("_armed", "_reference")

    def __init__(self) -> None:
        self._reference: dict[Side, Candle | None] = {Side.BUY: None, Side.SELL: None}
        self._armed: dict[Side, bool] = {Side.BUY: True, Side.SELL: True}

    def reset(self) -> None:
        self._reference = {Side.BUY: None, Side.SELL: None}
        self._armed = {Side.BUY: True, Side.SELL: True}

    def lock(self, side: Side) -> None:
        self._armed[side] = False

    def reference(self, side: Side) -> Candle | None:
        return self._reference[side]

    def on_closed_candle(self, candle: Candle) -> list[Signal]:
        # After a Buy signal at least one red candle must close before another
        # Buy can trigger. Sell uses the exact opposite reset candle.
        if candle.bearish:
            self._armed[Side.BUY] = True
        if candle.bullish:
            self._armed[Side.SELL] = True
        signals: list[Signal] = []
        buy = self._evaluate_buy(candle)
        sell = self._evaluate_sell(candle)
        if buy:
            signals.append(buy)
        if sell:
            signals.append(sell)
        return signals

    def _evaluate_buy(self, candle: Candle) -> Signal | None:
        reference = self._reference[Side.BUY]
        if not self._armed[Side.BUY]:
            return None
        signal = None
        if reference and candle.bullish:
            closes_above = candle.close > reference.high
            broke_low = candle.low < reference.low
            if closes_above and not broke_low:
                signal = Signal(Side.BUY, reference, candle)
                self._armed[Side.BUY] = False

        # A bullish candle is the next reference. This also implements the rule that
        # an outside candle closing above high must wait for one more valid candle.
        if candle.bullish:
            self._reference[Side.BUY] = candle
        return signal

    def _evaluate_sell(self, candle: Candle) -> Signal | None:
        reference = self._reference[Side.SELL]
        if not self._armed[Side.SELL]:
            return None
        signal = None
        if reference and candle.bearish:
            closes_below = candle.close < reference.low
            broke_high = candle.high > reference.high
            if closes_below and not broke_high:
                signal = Signal(Side.SELL, reference, candle)
                self._armed[Side.SELL] = False

        if candle.bearish:
            self._reference[Side.SELL] = candle
        return signal
