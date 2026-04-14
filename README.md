# tradebot

A **paper-trading** simulator and trainer for buying/selling call options.
Everything runs locally against synthetic or historical price series — no
broker credentials, no real orders. Intended for research and testing only.

> **Disclaimer.** This project is for educational purposes. Options trading
> involves substantial risk. Do not wire this code up to a real brokerage.

There are two ways to use it:

1. **Web dashboard** (Next.js, deployable to Vercel) — train a Q-learning
   agent in the browser and backtest it against an RSI baseline, live.
2. **Python CLI** — the same simulation with more features (yfinance data,
   RSI/TA indicators, pickle-able agents).

---

## Web dashboard (Vercel)

### Local

```bash
npm install
npm run dev
# → http://localhost:3000
```

### Deploy to Vercel

Zero-config. Vercel auto-detects Next.js.

```bash
npm install -g vercel
vercel        # first-time, answer the prompts (framework = Next.js)
vercel --prod
```

Or push to a Git remote and hit **Import Project** on
[vercel.com/new](https://vercel.com/new) — pick this repo, accept the
defaults, and you're live.

The app is fully static + client-side:
- Synthetic GBM price paths are generated in-browser (deterministic seed).
- Training and backtesting both run in the user's tab (no backend).
- No API keys, no env vars, no serverless functions needed.

### Features

- **Backtest tab** — run the RSI baseline or your trained agent; see
  equity curve, spot overlay, P/L stats, and a full trade log.
- **Train tab** — configure Q-learning hyperparameters, watch episode-by-
  episode progress, then hop back to Backtest and flip “Use trained agent”.
- Adjustable market params (drift, vol, seed, days), options params (DTE,
  strike offset, IV, r), and broker frictions (commission, slippage).

---

## Python CLI

### Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Quickstart

```bash
# Train an agent on SPY (falls back to synthetic data if offline)
python -m tradebot.cli train --ticker SPY --episodes 200 --out runs/spy.pkl

# Backtest the trained agent on a held-out window
python -m tradebot.cli backtest --ticker SPY --start 2024-01-01 --end 2024-12-31 \
    --agent runs/spy.pkl

# Paper-trade on synthetic future bars appended to the real series
python -m tradebot.cli paper --ticker SPY --agent runs/spy.pkl --steps 60
```

Without `--agent`, `backtest` and `paper` use the rule-based RSI strategy
defined in `config.yaml`.

Run the test suite:

```bash
pytest -q
```

---

## Layout

```
tradebot/
├── app/                 # Next.js app-router UI (Vercel entry point)
│   ├── Dashboard.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── lib/                 # TypeScript port of the simulation core
│   ├── agent.ts         # Tabular Q-learning
│   ├── backtest.ts      # Episode runner
│   ├── broker.ts        # Paper broker + trades
│   ├── data.ts          # Synthetic GBM generator
│   ├── env.ts           # RL env (state, action, reward)
│   ├── indicators.ts    # RSI, log returns
│   ├── options.ts       # Black-Scholes call pricer + greeks
│   ├── rng.ts           # Seeded PRNG (Mulberry32 + Box-Muller)
│   └── strategy.ts      # RSI baseline
├── tradebot/            # Python package (CLI, yfinance, pickle models)
├── tests/               # pytest smoke tests
├── config.yaml          # Python CLI defaults
├── package.json         # Next.js / Vercel
└── requirements.txt     # Python
```

## Safety

`broker.py` / `broker.ts` are pure simulations — there is no network code
that could place a real order. Adding a live brokerage adapter is
intentionally left out.
