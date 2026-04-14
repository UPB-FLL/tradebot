"""Lightweight technical indicators used for state features."""
from __future__ import annotations

import numpy as np
import pandas as pd


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    return out.fillna(50.0)


def log_returns(close: pd.Series, periods: int = 1) -> pd.Series:
    return np.log(close).diff(periods).fillna(0.0)


def sma(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window=window, min_periods=1).mean()
