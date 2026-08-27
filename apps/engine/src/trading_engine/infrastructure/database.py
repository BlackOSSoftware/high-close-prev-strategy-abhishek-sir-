from __future__ import annotations

import json
import queue
import sqlite3
import threading
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any


class AsyncDatabaseWriter:
    """One SQLite owner; the trading hot path only performs non-blocking enqueue."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._queue: queue.SimpleQueue[tuple[str, dict[str, Any]] | None] = queue.SimpleQueue()
        self._thread = threading.Thread(target=self._run, name="db-writer", daemon=True)

    def start(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._thread.start()

    def emit(self, event_type: str, payload: Any) -> None:
        if is_dataclass(payload):
            payload = asdict(payload)
        self._queue.put((event_type, payload))

    def close(self) -> None:
        self._queue.put(None)
        self._thread.join(timeout=5)

    def _run(self) -> None:
        connection = sqlite3.connect(self._path, timeout=5)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute("PRAGMA temp_store=MEMORY")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL
            )"""
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_type_id ON events(event_type, id DESC)"
        )
        connection.commit()
        pending = 0
        while True:
            item = self._queue.get()
            if item is None:
                break
            event_type, payload = item
            connection.execute(
                "INSERT INTO events(event_type, payload) VALUES (?, ?)",
                (event_type, json.dumps(payload, default=str, separators=(",", ":"))),
            )
            pending += 1
            if pending >= 20 or self._queue.empty():
                connection.commit()
                pending = 0
        connection.commit()
        connection.close()


def recent_events(path: Path, limit: int = 100) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        "SELECT id, created_at, event_type, payload FROM events ORDER BY id DESC LIMIT ?",
        (min(max(limit, 1), 500),),
    ).fetchall()
    connection.close()
    return [
        {
            "type": row["event_type"],
            "payload": json.loads(row["payload"]),
            "id": row["id"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
