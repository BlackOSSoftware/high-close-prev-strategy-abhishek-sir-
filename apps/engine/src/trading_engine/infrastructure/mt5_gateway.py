from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from trading_engine.domain.models import Candle, OrderIntent, Side, Tick


class MT5Error(RuntimeError):
    pass


class MT5Gateway:
    """The only object allowed to call the non-thread-safe MetaTrader5 module."""

    def __init__(self) -> None:
        self._mt5: Any = None

    def connect(self, symbol: str) -> None:
        try:
            import MetaTrader5 as mt5
        except ImportError as exc:
            raise MT5Error("MetaTrader5 package is not installed") from exc
        self._mt5 = mt5
        if not mt5.initialize():
            raise MT5Error(f"MT5 initialize failed: {mt5.last_error()}")
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if terminal is None:
            raise MT5Error(f"MT5 terminal is unavailable: {mt5.last_error()}")
        if not bool(terminal.connected):
            raise MT5Error("MT5 terminal is open but not connected to the broker server")
        if account is None:
            raise MT5Error(f"MT5 account is not logged in: {mt5.last_error()}")
        if not mt5.symbol_select(symbol, True):
            raise MT5Error(f"Could not select symbol {symbol}: {mt5.last_error()}")

    def connection_info(self) -> dict[str, Any]:
        terminal = self._mt5.terminal_info()
        account = self._mt5.account_info()
        if terminal is None or account is None:
            raise MT5Error(f"Could not read MT5 connection details: {self._mt5.last_error()}")
        return {
            "terminal": str(terminal.name),
            "broker": str(account.company),
            "server": str(account.server),
            "login": int(account.login),
        }

    def disconnect(self) -> None:
        if self._mt5 is not None:
            self._mt5.shutdown()

    def tick(self, symbol: str) -> Tick:
        value = self._mt5.symbol_info_tick(symbol)
        if value is None:
            raise MT5Error(f"No tick for {symbol}: {self._mt5.last_error()}")
        return Tick(time_msc=int(value.time_msc), bid=float(value.bid), ask=float(value.ask))

    def symbol_spec(self, symbol: str) -> tuple[float, int]:
        info = self._mt5.symbol_info(symbol)
        if info is None:
            raise MT5Error(f"No symbol info for {symbol}")
        return float(info.point), int(info.digits)

    def search_symbols(self, query: str, limit: int = 30) -> list[dict[str, str]]:
        cleaned = query.strip()
        symbols = self._mt5.symbols_get(group=f"*{cleaned}*") if cleaned else self._mt5.symbols_get()
        if symbols is None:
            raise MT5Error(f"Could not fetch broker symbols: {self._mt5.last_error()}")
        return [
            {
                "name": str(symbol.name),
                "description": str(symbol.description),
                "currency": str(symbol.currency_profit),
            }
            for symbol in symbols[:limit]
        ]

    def last_closed_candle(self, symbol: str, timeframe: str) -> Candle:
        mt5_timeframe = getattr(self._mt5, f"TIMEFRAME_{timeframe}", None)
        if mt5_timeframe is None:
            raise MT5Error(f"Unsupported timeframe: {timeframe}")
        rates = self._mt5.copy_rates_from_pos(symbol, mt5_timeframe, 1, 1)
        if rates is None or len(rates) != 1:
            raise MT5Error(f"Could not read closed candle: {self._mt5.last_error()}")
        rate = rates[0]
        return Candle(
            time=datetime.fromtimestamp(int(rate["time"]), UTC),
            open=float(rate["open"]),
            high=float(rate["high"]),
            low=float(rate["low"]),
            close=float(rate["close"]),
        )

    def current_bar_time(self, symbol: str, timeframe: str) -> int:
        mt5_timeframe = getattr(self._mt5, f"TIMEFRAME_{timeframe}", None)
        rates = self._mt5.copy_rates_from_pos(symbol, mt5_timeframe, 0, 1)
        if rates is None or len(rates) != 1:
            raise MT5Error(f"Could not read current candle: {self._mt5.last_error()}")
        return int(rates[0]["time"])

    def recent_candles(self, symbol: str, timeframe: str, count: int = 60) -> list[dict[str, Any]]:
        mt5_timeframe = getattr(self._mt5, f"TIMEFRAME_{timeframe}", None)
        if mt5_timeframe is None:
            raise MT5Error(f"Unsupported timeframe: {timeframe}")
        rates = self._mt5.copy_rates_from_pos(symbol, mt5_timeframe, 0, count)
        if rates is None:
            raise MT5Error(f"Could not read chart candles: {self._mt5.last_error()}")
        return [
            {
                "time": int(rate["time"]),
                "open": float(rate["open"]),
                "high": float(rate["high"]),
                "low": float(rate["low"]),
                "close": float(rate["close"]),
            }
            for rate in rates
        ]

    def open_strategy_positions(self, symbol: str, magic: int) -> int:
        positions = self._mt5.positions_get(symbol=symbol) or ()
        return sum(1 for position in positions if int(position.magic) == magic)

    def open_strategy_leg_numbers(self, symbol: str, magic: int) -> set[int]:
        positions = self._mt5.positions_get(symbol=symbol) or ()
        legs: set[int] = set()
        for position in positions:
            if int(position.magic) != magic:
                continue
            try:
                legs.add(int(str(position.comment).rsplit("L", 1)[1]))
            except (IndexError, ValueError):
                continue
        return legs

    def dashboard_snapshot(self, symbol: str, magic: int) -> dict[str, Any]:
        account = self._mt5.account_info()
        if account is None:
            raise MT5Error(f"Could not read account: {self._mt5.last_error()}")
        positions = [
            position
            for position in (self._mt5.positions_get(symbol=symbol) or ())
            if int(position.magic) == magic
        ]
        return {
            "account": {
                "balance": float(account.balance),
                "equity": float(account.equity),
                "free_margin": float(account.margin_free),
                "currency": str(account.currency),
            },
            "pnl": sum(float(position.profit) for position in positions),
            "positions": [
                {
                    "ticket": int(position.ticket),
                    "side": "buy" if int(position.type) == self._mt5.POSITION_TYPE_BUY else "sell",
                    "volume": float(position.volume),
                    "entry": float(position.price_open),
                    "current": float(position.price_current),
                    "sl": float(position.sl),
                    "tp": float(position.tp),
                    "profit": float(position.profit),
                    "time": int(position.time),
                    "comment": str(position.comment),
                }
                for position in positions
            ],
        }

    def send_market_order(self, intent: OrderIntent, magic: int, deviation: int) -> dict[str, Any]:
        tick = self.tick(intent.symbol)
        order_type = self._mt5.ORDER_TYPE_BUY if intent.side == Side.BUY else self._mt5.ORDER_TYPE_SELL
        price = tick.ask if intent.side == Side.BUY else tick.bid
        request = {
            "action": self._mt5.TRADE_ACTION_DEAL,
            "symbol": intent.symbol,
            "volume": intent.volume,
            "type": order_type,
            "price": price,
            "sl": intent.stop_loss,
            "tp": intent.take_profit,
            "deviation": deviation,
            "magic": magic,
            "comment": f"PHLC-L{intent.leg}",
            "type_time": self._mt5.ORDER_TIME_GTC,
            "type_filling": self._mt5.ORDER_FILLING_IOC,
        }
        result = self._mt5.order_send(request)
        if result is None:
            raise MT5Error(f"order_send returned None: {self._mt5.last_error()}")
        response = result._asdict()
        response["request"] = request
        success_codes = {
            self._mt5.TRADE_RETCODE_DONE,
            self._mt5.TRADE_RETCODE_DONE_PARTIAL,
            self._mt5.TRADE_RETCODE_PLACED,
        }
        broker_confirmed = (
            str(result.comment).strip().lower() in {"done", "placed"}
            and (int(result.deal) > 0 or int(result.order) > 0)
        )
        if result.retcode not in success_codes and not broker_confirmed:
            raise MT5Error(f"Order rejected ({result.retcode}): {result.comment}")
        return response

    def close_position(self, ticket: int, deviation: int) -> dict[str, Any]:
        matches = self._mt5.positions_get(ticket=ticket) or ()
        if not matches:
            raise MT5Error(f"Position {ticket} is no longer open")
        position = matches[0]
        tick = self.tick(position.symbol)
        is_buy = int(position.type) == self._mt5.POSITION_TYPE_BUY
        request = {
            "action": self._mt5.TRADE_ACTION_DEAL,
            "position": int(position.ticket),
            "symbol": str(position.symbol),
            "volume": float(position.volume),
            "type": self._mt5.ORDER_TYPE_SELL if is_buy else self._mt5.ORDER_TYPE_BUY,
            "price": tick.bid if is_buy else tick.ask,
            "deviation": deviation,
            "magic": int(position.magic),
            "comment": f"Close {position.comment}",
            "type_time": self._mt5.ORDER_TIME_GTC,
            "type_filling": self._mt5.ORDER_FILLING_IOC,
        }
        result = self._mt5.order_send(request)
        if result is None:
            raise MT5Error(f"Close request returned None: {self._mt5.last_error()}")
        response = result._asdict()
        success = result.retcode in {
            self._mt5.TRADE_RETCODE_DONE,
            self._mt5.TRADE_RETCODE_DONE_PARTIAL,
        } or (
            str(result.comment).strip().lower() == "done"
            and (int(result.deal) > 0 or int(result.order) > 0)
        )
        if not success:
            raise MT5Error(f"Close rejected ({result.retcode}): {result.comment}")
        return response
