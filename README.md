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
- **Live (Alpaca) tab** — read the connected account, list positions, find
  near-the-money call contracts, and place guarded paper orders.
- Adjustable market params (drift, vol, seed, days), options params (DTE,
  strike offset, IV, r), and broker frictions (commission, slippage).

### Connecting a brokerage (Alpaca)

> **Why Alpaca and not Robinhood?** Robinhood has no official public API.
> Using the reverse-engineered one violates their ToS and stores your
> username/password on the server, which is not something I'm going to wire
> up on a public Vercel URL. Alpaca issues real API keys, has a free paper-
> trading account with real market data, and supports options — which is
> exactly what this project needs.

1. Create a free account at [alpaca.markets](https://alpaca.markets/) and
   grab a **paper** key ID + secret from the dashboard.
2. Set them as environment variables:
   - **Local:** copy `.env.local.example` to `.env.local` and fill in.
   - **Vercel:** Project → Settings → Environment Variables → add
     `ALPACA_KEY_ID` and `ALPACA_SECRET_KEY` (scope: Production + Preview).
     Redeploy.
3. The **Live (Alpaca)** tab will light up and start showing account status.

All broker traffic is proxied through server-only Next.js Route Handlers
under `/api/broker/*`. Keys never leave the server. The order endpoint
additionally requires the literal phrase `I UNDERSTAND` in the request body
and enforces a server-side `ALPACA_MAX_QTY` cap (default 10).

### Going live (real money — read first)

The paper endpoint (`https://paper-api.alpaca.markets`, the default) uses
fake money. To point at the live endpoint you must set **both**:

```
ALPACA_BASE_URL=https://api.alpaca.markets
ALPACA_ALLOW_LIVE=true
```

Missing either flag keeps you on paper. The UI clearly labels the active
endpoint as `PAPER` or `LIVE`. Treat live-mode deploys like production:
separate Vercel project, restricted team access, and a small `ALPACA_MAX_QTY`.

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
