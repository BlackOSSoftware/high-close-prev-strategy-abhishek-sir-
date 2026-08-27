from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from .models import DistanceMode


class ExitConfig(BaseModel):
    mode: DistanceMode
    value: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_value(self) -> ExitConfig:
        if self.mode != DistanceMode.REFERENCE_CANDLE and self.value <= 0:
            raise ValueError("points/percent exit value must be greater than zero")
        return self


class LegConfig(BaseModel):
    enabled: bool = True
    volume: float = Field(gt=0)
    stop_loss: ExitConfig
    take_profit: ExitConfig

    @model_validator(mode="after")
    def target_cannot_use_reference(self) -> LegConfig:
        if self.take_profit.mode == DistanceMode.REFERENCE_CANDLE:
            raise ValueError("reference candle mode is only valid for stop loss")
        return self


class StrategyConfig(BaseModel):
    enabled: bool = False
    symbol: str = "XAUUSD"
    timeframe: str = "M1"
    direction: Literal["buy", "sell"] = "buy"
    deviation_points: int = Field(default=20, ge=0)
    magic_number: int = 26082026
    poll_interval_ms: int = Field(default=10, ge=1, le=1000)
    closed_leg_behavior: Literal["same_leg", "next_leg"] = "same_leg"
    stop_after_entry: bool = False
    legs: list[LegConfig] = Field(min_length=1, max_length=20)


class AppConfig(BaseModel):
    strategy: StrategyConfig
    database_path: Path = Path("data/trading.db")
    host: str = "127.0.0.1"
    port: int = 8765
