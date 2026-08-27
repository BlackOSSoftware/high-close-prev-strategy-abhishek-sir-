from __future__ import annotations

import os
from pathlib import Path

from trading_engine.domain.config import AppConfig, StrategyConfig


class ConfigStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> AppConfig:
        return AppConfig.model_validate_json(self.path.read_text(encoding="utf-8"))

    def save_strategy(self, strategy: StrategyConfig) -> None:
        app = self.load()
        updated = app.model_copy(update={"strategy": strategy})
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(updated.model_dump_json(indent=2), encoding="utf-8")
        os.replace(temporary, self.path)

