# tradebot

A **paper-trading** simulator and trainer for buying/selling call options.
Everything runs locally against historical or synthetic price series — no
broker credentials, no real orders. Intended for research and testing only.

> **Disclaimer.** This project is for educational purposes. Options trading
> involves substantial risk. Do not wire this code up to a real brokerage.

## Features

- Historical data via `yfinance`, with a GBM synthetic fallback when offline.
- Black–Scholes call pricer + greeks (delta, gamma, theta, vega).
- Paper broker with commissions, slippage, and expiration handling.
- Tabular Q-learning agent that learns when to buy/hold/sell calls.
- Rule-based RSI strategy for a sanity-check baseline.
- Backtester + CLI (`train`, `backtest`, `paper`).

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Quickstart

```bash
# 1. Train an agent on SPY (falls back to synthetic data if offline)
python -m tradebot.cli train --ticker SPY --episodes 200 --out runs/spy.pkl

# 2. Backtest the trained agent on a held-out window
python -m tradebot.cli backtest --ticker SPY --start 2024-01-01 --end 2024-12-31 \
    --agent runs/spy.pkl

# 3. Run a paper-trading loop on the latest synthetic bars
python -m tradebot.cli paper --ticker SPY --agent runs/spy.pkl --steps 60
```

Without `--agent`, `backtest` and `paper` use the rule-based RSI strategy
defined in `config.yaml`.

## Layout

```
tradebot/
├── config.yaml          # defaults for data / options / training
├── tradebot/
│   ├── data.py          # yfinance + synthetic GBM loader
│   ├── options.py       # Black–Scholes call pricer + greeks
│   ├── indicators.py    # RSI, returns, etc.
│   ├── broker.py        # Paper broker / portfolio
│   ├── env.py           # RL environment (state, action, reward)
│   ├── agent.py         # Tabular Q-learning agent
│   ├── strategy.py      # RSI rule-based baseline
│   ├── backtest.py      # Episode runner used by both train and backtest
│   └── cli.py           # `python -m tradebot.cli ...`
└── tests/
```

## Safety

`broker.py` is a pure simulation — there is no network code that could place a
real order. The `paper` command just extends the historical series with
synthetic future bars and runs the same simulated broker. Adding a live
brokerage adapter is intentionally left out.
