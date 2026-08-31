from __future__ import annotations

import asyncio
import json
import os
import queue
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from trading_engine.config_store import ConfigStore
from trading_engine.domain.config import StrategyConfig
from trading_engine.infrastructure.database import AsyncDatabaseWriter, recent_events
from trading_engine.live_events import encode_live_event
from trading_engine.services.engine import TradingEngine

CONFIG_PATH = Path(os.getenv("PHLC_CONFIG", "config/default.json"))
store = ConfigStore(CONFIG_PATH)
app_config = store.load()
outbound: queue.SimpleQueue[dict[str, Any]] = queue.SimpleQueue()
runtime_state: dict[str, Any] = {
    "engine": {"running": False, "connected": False},
    "market": None,
    "dashboard": None,
}


def publish(event: dict[str, Any]) -> None:
    # Domain events can contain datetime values nested inside dataclasses.
    # Encode once at the process boundary so every live message is JSON-safe.
    encoded_event = encode_live_event(event)
    if encoded_event["type"] == "engine_status":
        runtime_state["engine"] = encoded_event["payload"]
    elif encoded_event["type"] == "market_tick":
        runtime_state["market"] = encoded_event["payload"]
    elif encoded_event["type"] == "dashboard_snapshot":
        runtime_state["dashboard"] = encoded_event["payload"]
    outbound.put(encoded_event)


database = AsyncDatabaseWriter(app_config.database_path)
engine = TradingEngine(app_config.strategy, database, publish, store.save_strategy)


@asynccontextmanager
async def lifespan(_: FastAPI):
    database.start()
    engine.start()
    yield
    engine.stop()
    database.close()


app = FastAPI(title="PHLC local control plane", lifespan=lifespan)


@app.websocket("/live")
async def live(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "snapshot",
            "payload": {
                "config": store.load().strategy.model_dump(mode="json"),
                "events": recent_events(app_config.database_path, 50),
                "engine": runtime_state["engine"],
                "market": runtime_state["market"],
                "dashboard": runtime_state["dashboard"],
            },
        }
    )
    receive_task = asyncio.create_task(websocket.receive_text())
    try:
        while True:
            done, _ = await asyncio.wait({receive_task}, timeout=0.025)
            if done:
                message = json.loads(receive_task.result())
                if message.get("type") == "update_config":
                    strategy = StrategyConfig.model_validate(message["payload"])
                    store.save_strategy(strategy)
                    engine.update_config(strategy)
                    await websocket.send_json({"type": "command_accepted", "payload": {}})
                elif message.get("type") == "search_symbols":
                    engine.search_symbols(str(message.get("payload", {}).get("query", "")))
                elif message.get("type") == "close_position":
                    engine.close_position(int(message.get("payload", {}).get("ticket", 0)))
                elif message.get("type") == "request_chart":
                    engine.request_chart(str(message.get("payload", {}).get("timeframe", "M1")))
                receive_task = asyncio.create_task(websocket.receive_text())
            while not outbound.empty():
                await websocket.send_json(outbound.get_nowait())
    except WebSocketDisconnect:
        pass
    finally:
        receive_task.cancel()


def run() -> None:
    config = store.load()
    uvicorn.run(app, host=config.host, port=config.port, log_level="info")


if __name__ == "__main__":
    run()
