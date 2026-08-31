# PHLC Trading System

Local-first MetaTrader 5 trading application for the previous-high/low-close strategy.

# high-close-prev-strategy-abhishek-sir-

## Architecture

The order path contains no HTTP, WebSocket, database query, or UI call:

```text
MT5 terminal -> dedicated Python MT5 thread -> candle state machine
             -> risk calculation -> order_send
```

UI traffic is a separate control path:

```text
Next.js browser <- one localhost WebSocket -> Python control plane
                                             -> atomic config update
                                             -> non-blocking command queue
```

SQLite uses WAL mode and has one background writer. Trading code only puts events into
an in-memory queue, so disk work does not delay an order.

> The MetaTrader5 Python module has no native tick callback/WebSocket. The engine therefore
> detects a new bar through an isolated low-interval worker. `poll_interval_ms` defaults to
> 10 ms. Actual fill latency still depends on the first broker tick, terminal, network, and broker.

## Strategy currently implemented

- Buy reference and confirmation candles must be green.
- Buy confirmation closes above the reference high without breaking its low.
- If it breaks both sides and closes above, no entry is made; that outside candle becomes the
  next reference and another confirmation candle is required.
- Sell logic is the exact inverse and uses red candles.
- One entry per closed candle.
- A new valid pattern can open the next enabled leg.
- Closed legs can either reuse the same leg settings or advance through the enabled leg settings.
- The strategy can remain running after a fill or switch itself off immediately after entry.
- Each leg has its own lot, stop mode, and target mode.
- Stops support points, percentage, or reference-candle low/high.
- Targets support points or percentage.

## Requirements

- Windows 10/11 or Windows Server
- MetaTrader 5 installed, logged in, and running
- Python 3.11–3.13 (3.12 recommended for live deployment)
- Node.js 22+

## Run

From PowerShell in the repository root:

```powershell
.\start.cmd
```

`start.cmd` latest Git changes fast-forward pulls, installs only changed Python/Node
dependencies, rebuilds only when web source changes, and then starts both services. Running it
again skips completed work and does not start duplicate processes. Logs are written to `logs/`.
The UI opens automatically in a dedicated Chrome app-style window without normal browser tabs
or an address bar (Edge app mode is used as a fallback when Chrome is unavailable). Closing this
app window also stops the web server and Python trading engine.

Open `http://127.0.0.1:3000`. Configuration is stored in `config/default.json`; runtime
events are stored in `data/trading.db`.

Keep the strategy disabled until it has been tested on a demo account. The UI can be closed
after settings are applied; the Python engine continues running. Closing the Python engine or
MT5 terminal stops new signals and entries.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest apps\engine\tests
Set-Location apps\web
npm run build
```

## Important execution semantics

- A market order cannot be cancelled after it is filled. It can only be closed with an opposite
  deal. Only pending orders can be cancelled.
- SL and TP are sent with the initial request and reside at the broker after acceptance.
- This version counts open strategy positions as used legs and is designed for an MT5 hedging
  account. Netting-account rules require a separate aggregation policy before live use.
- Broker-specific filling modes, minimum stop distance, volume steps, and symbol suffixes must be
  validated against the target broker before enabling live trading.
