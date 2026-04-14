"""Episode runner used by both training and evaluation."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List

from .agent import QAgent
from .env import OptionsEnv
from .strategy import RSIStrategy


@dataclass
class EpisodeResult:
    final_equity: float
    total_reward: float
    n_trades: int
    n_buys: int
    n_sells: int
    n_expired_itm: int
    n_expired_otm: int
    equity_curve: List[float] = field(default_factory=list)


def run_episode(
    env: OptionsEnv,
    policy: Callable[[tuple, OptionsEnv], int],
    *,
    learn_agent: QAgent | None = None,
) -> EpisodeResult:
    """Run one episode. If ``learn_agent`` is provided, Q-values are updated."""
    state = env.reset()
    equity_curve: List[float] = [env.equity]
    total_reward = 0.0
    done = False

    while not done:
        action = policy(state, env)
        next_state, reward, done, info = env.step(action)
        if learn_agent is not None:
            learn_agent.update(state, action, reward, next_state, done)
        state = next_state
        total_reward += reward
        equity_curve.append(info["equity"])

    trades = env.broker.trades if env.broker else []
    return EpisodeResult(
        final_equity=env.equity,
        total_reward=total_reward,
        n_trades=len(trades),
        n_buys=sum(1 for t in trades if t.kind == "BUY"),
        n_sells=sum(1 for t in trades if t.kind == "SELL"),
        n_expired_itm=sum(1 for t in trades if t.kind == "EXPIRE" and t.note == "ITM"),
        n_expired_otm=sum(1 for t in trades if t.kind == "EXPIRE" and t.note == "OTM"),
        equity_curve=equity_curve,
    )


def agent_policy(agent: QAgent, *, explore: bool):
    def _p(state, _env):
        return agent.act(state, explore=explore)
    return _p


def rsi_policy(strategy: RSIStrategy):
    def _p(state, env):
        return strategy.act(state, env)
    return _p
