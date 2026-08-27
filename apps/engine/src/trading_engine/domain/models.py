from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


class DistanceMode(str, Enum):
    POINTS = "points"
    PERCENT = "percent"
    REFERENCE_CANDLE = "reference_candle"


@dataclass(frozen=True, slots=True)
class Candle:
    time: datetime
    open: float
    high: float
    low: float
    close: float

    @property
    def bullish(self) -> bool:
        return self.close > self.open

    @property
    def bearish(self) -> bool:
        return self.close < self.open


@dataclass(frozen=True, slots=True)
class Tick:
    time_msc: int
    bid: float
    ask: float


@dataclass(frozen=True, slots=True)
class Signal:
    side: Side
    reference: Candle
    confirmation: Candle


@dataclass(frozen=True, slots=True)
class OrderIntent:
    side: Side
    symbol: str
    volume: float
    stop_loss: float
    take_profit: float
    leg: int
    signal_time_msc: int

