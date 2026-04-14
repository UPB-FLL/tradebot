"""Config loader. Reads ``config.yaml`` and exposes a dataclass-like namespace."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import yaml

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"


def _to_ns(obj: Any) -> Any:
    if isinstance(obj, dict):
        return SimpleNamespace(**{k: _to_ns(v) for k, v in obj.items()})
    if isinstance(obj, list):
        return [_to_ns(v) for v in obj]
    return obj


def load_config(path: str | Path | None = None) -> SimpleNamespace:
    path = Path(path) if path else DEFAULT_CONFIG_PATH
    with open(path, "r") as f:
        raw = yaml.safe_load(f)
    return _to_ns(raw)
