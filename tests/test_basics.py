"""Smoke tests covering pricing, broker, env, and a short training run."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import pytest

from tradebot.agent import QAgent
from tradebot.backtest import agent_policy, run_episode, rsi_policy
from tradebot.broker import PaperBroker
from tradebot.config import load_config
from tradebot.data import load_prices
from tradebot.env import BUY_CALL, EnvConfig, OptionsEnv, SELL
from tradebot.options import choose_strike, price_call
from tradebot.strategy import RSIStrategy


# -------------------------- Black–Scholes ---------------------------------

def test_call_price_matches_known_benchmark():
    # Standard textbook example: S=100, K=100, r=5%, T=1y, sigma=20%
    q = price_call(100.0, 100.0, 1.0, 0.05, 0.20)
    # Closed-form answer ~10.4506
    assert q.price == pytest.approx(10.4506, abs=1e-3)
    assert 0.0 < q.delta < 1.0
    assert q.gamma > 0.0
    assert q.vega > 0.0


def test_call_intrinsic_at_expiry():
    q = price_call(120.0, 100.0, 0.0, 0.05, 0.2)
    assert q.price == pytest.approx(20.0)
    assert q.delta == 1.0

    q_otm = price_call(90.0, 100.0, 0.0, 0.05, 0.2)
    assert q_otm.price == 0.0


def test_choose_strike_rounds():
    assert choose_strike(100.0, 0.02) == 102
    assert choose_strike(100.4, 0.0) == 100


# -------------------------- Broker -----------------------------------------

def test_broker_buy_sell_roundtrip():
    br = PaperBroker(cash=10_000.0, commission_per_contract=0.0, slippage_bps=0.0)
    today = date(2024, 1, 2)
    expiry = today + timedelta(days=30)
    tr = br.buy_call(dt=today, ticker="SPY", strike=100.0, expiry=expiry,
                     contracts=1, quote_price=2.5)
    assert tr is not None
    assert br.cash == pytest.approx(10_000.0 - 2.5 * 100)
    assert br.has_position()

    trades = br.sell_all(dt=today, quote_fn=lambda p: 3.0)
    assert len(trades) == 1
    assert br.cash == pytest.approx(10_000.0 - 2.5 * 100 + 3.0 * 100)
    assert not br.has_position()


def test_broker_expires_itm_and_otm():
    br = PaperBroker(cash=10_000.0, commission_per_contract=0.0, slippage_bps=0.0)
    today = date(2024, 1, 2)
    exp = today + timedelta(days=10)
    br.buy_call(dt=today, ticker="SPY", strike=100.0, expiry=exp,
                contracts=1, quote_price=1.0)
    # Spot above strike → ITM
    trades = br.expire(dt=exp, spot=105.0)
    assert len(trades) == 1
    assert trades[0].note == "ITM"
    assert br.cash > 10_000.0 - 100  # got 5*100 back plus cash


# -------------------------- Env + agent -----------------------------------

def _mini_env():
    cfg = load_config()
    series = load_prices(
        "TEST",
        "2023-01-01",
        "2023-04-01",
        use_synthetic_if_offline=True,
        cache_dir=None,
    )
    # Force synthetic for determinism
    from tradebot.data import _synthetic_series
    series = _synthetic_series("TEST", "2023-01-01", "2023-04-01", seed=1)
    env_cfg = EnvConfig(
        starting_cash=cfg.simulation.starting_cash,
        commission_per_contract=cfg.simulation.commission_per_contract,
        slippage_bps=cfg.simulation.slippage_bps,
        contract_multiplier=cfg.simulation.contract_multiplier,
        risk_free_rate=cfg.options.risk_free_rate,
        implied_volatility=cfg.options.implied_volatility,
        dte_days=cfg.options.dte_days,
        strike_offset_pct=cfg.options.strike_offset_pct,
        rsi_bins=list(cfg.training.rsi_bins),
        ret_bins=list(cfg.training.ret_bins),
    )
    return OptionsEnv(series, env_cfg)


def test_env_reset_step():
    env = _mini_env()
    s = env.reset()
    assert len(s) == 3
    s, r, done, info = env.step(BUY_CALL)
    assert "equity" in info
    assert isinstance(r, float)
    assert not done


def test_rsi_strategy_runs():
    env = _mini_env()
    strat = RSIStrategy()
    res = run_episode(env, rsi_policy(strat))
    assert res.final_equity > 0
    # Should be able to open at least one position with synthetic data
    assert res.n_buys >= 0


def test_agent_trains_and_persists(tmp_path: Path):
    env = _mini_env()
    agent = QAgent(alpha=0.2, epsilon=0.5, epsilon_end=0.1, epsilon_decay=0.9)
    for _ in range(5):
        run_episode(env, agent_policy(agent, explore=True), learn_agent=agent)
        agent.decay_epsilon()
    assert len(agent.q) > 0  # learned *something*

    out = tmp_path / "a.pkl"
    agent.save(out)
    reloaded = QAgent.load(out)
    assert reloaded.q == agent.q
