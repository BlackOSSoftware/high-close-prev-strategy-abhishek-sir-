from typing import Any

from trading_engine.domain.config import ExitConfig, LegConfig, StrategyConfig
from trading_engine.domain.models import DistanceMode
from trading_engine.services.engine import TradingEngine


class NullDatabase:
    def emit(self, _event_type: str, _payload: Any) -> None:
        pass


def strategy(behavior: str) -> StrategyConfig:
    legs = [
        LegConfig(
            volume=0.01 * number,
            stop_loss=ExitConfig(mode=DistanceMode.POINTS, value=number),
            take_profit=ExitConfig(mode=DistanceMode.POINTS, value=number * 5),
        )
        for number in range(1, 4)
    ]
    return StrategyConfig(closed_leg_behavior=behavior, legs=legs)


def test_same_leg_mode_uses_next_free_leg_while_running_and_reuses_closed_leg():
    engine = TradingEngine(strategy("same_leg"), NullDatabase(), lambda _event: None)  # type: ignore[arg-type]

    assert engine._select_leg_number(set()) == 1
    assert engine._select_leg_number({1}) == 2
    assert engine._select_leg_number({2}) == 1
    assert engine._select_leg_number({1, 2, 3}) is None


def test_next_leg_mode_cycles_through_leg_settings_after_each_fill():
    engine = TradingEngine(strategy("next_leg"), NullDatabase(), lambda _event: None)  # type: ignore[arg-type]

    assert engine._select_leg_number(set()) == 1
    engine._record_filled_leg(1)
    assert engine._select_leg_number(set()) == 2
    engine._record_filled_leg(2)
    assert engine._select_leg_number({3}) == 1
    engine._record_filled_leg(3)
    assert engine._select_leg_number(set()) == 1


def test_disabled_legs_are_skipped_in_both_modes():
    config = strategy("next_leg")
    config.legs[1].enabled = False
    engine = TradingEngine(config, NullDatabase(), lambda _event: None)  # type: ignore[arg-type]

    engine._record_filled_leg(1)
    assert engine._select_leg_number(set()) == 3
