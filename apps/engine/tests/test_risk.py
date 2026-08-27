from datetime import UTC, datetime

from trading_engine.domain.config import ExitConfig, LegConfig
from trading_engine.domain.models import Candle, DistanceMode, Side, Signal, Tick
from trading_engine.services.risk import build_order_intent


def test_reference_low_stop_and_points_target():
    now = datetime.now(UTC)
    reference = Candle(now, 90, 100, 88, 98)
    confirmation = Candle(now, 98, 105, 90, 103)
    leg = LegConfig(
        volume=0.1,
        stop_loss=ExitConfig(mode=DistanceMode.REFERENCE_CANDLE),
        take_profit=ExitConfig(mode=DistanceMode.POINTS, value=5),
    )
    intent = build_order_intent(
        Signal(Side.BUY, reference, confirmation),
        Tick(1, bid=103, ask=103.1),
        "TEST",
        point=0.01,
        digits=2,
        leg_number=1,
        leg=leg,
    )
    assert intent.stop_loss == 88
    assert intent.take_profit == 108.1
