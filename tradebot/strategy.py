"""Rule-based RSI baseline.

Used as a sanity check and as the default strategy when the user runs
``backtest`` or ``paper`` without passing ``--agent``.
"""
from __future__ import annotations

from dataclasses import dataclass

from .env import BUY_CALL, HOLD, SELL, OptionsEnv, State


@dataclass
class RSIStrategy:
    rsi_buy_below: float = 35.0
    rsi_sell_above: float = 65.0
    take_profit_pct: float = 0.25
    stop_loss_pct: float = 0.20

    def act(self, state: State, env: OptionsEnv) -> int:
        # Our discrete RSI bins are [low, mid_low, mid_high, high] per config.
        # We also look at the raw values on the env so the thresholds apply.
        i = min(env.t, len(env._close) - 1)
        rsi_val = float(env._rsi[i])
        has_pos = state[2] == 1

        if has_pos:
            # Check take-profit / stop-loss on first open position.
            pos = env.broker.positions[0] if env.broker and env.broker.positions else None
            if pos is not None:
                spot = float(env._close[i])
                mark = env._mark(pos, env._dates[i].date(), spot)
                pnl_pct = (mark - pos.entry_price) / max(pos.entry_price, 1e-6)
                if pnl_pct >= self.take_profit_pct or pnl_pct <= -self.stop_loss_pct:
                    return SELL
            if rsi_val >= self.rsi_sell_above:
                return SELL
            return HOLD

        if rsi_val <= self.rsi_buy_below:
            return BUY_CALL
        return HOLD
