"""Command-line interface: train, backtest, paper."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .agent import QAgent
from .backtest import EpisodeResult, agent_policy, run_episode, rsi_policy
from .config import load_config
from .data import extend_synthetic, load_prices
from .env import EnvConfig, OptionsEnv
from .strategy import RSIStrategy


def _env_cfg(cfg) -> EnvConfig:
    return EnvConfig(
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


def _print_result(tag: str, r: EpisodeResult, starting: float) -> None:
    pnl = r.final_equity - starting
    pct = 100.0 * pnl / starting if starting else 0.0
    print(
        f"[{tag}] equity=${r.final_equity:,.2f}  "
        f"pnl=${pnl:,.2f} ({pct:+.2f}%)  "
        f"trades={r.n_trades} (buy={r.n_buys}, sell={r.n_sells}, "
        f"expired_itm={r.n_expired_itm}, expired_otm={r.n_expired_otm})"
    )


# ----------------------------------------------------------------------
# commands
# ----------------------------------------------------------------------

def cmd_train(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    series = load_prices(
        args.ticker or cfg.market.ticker,
        args.start or cfg.market.start,
        args.end or cfg.market.end,
        use_synthetic_if_offline=cfg.market.use_synthetic_if_offline,
        cache_dir=cfg.paths.data_cache,
    )
    print(f"Loaded {len(series)} bars for {series.ticker} "
          f"({'synthetic' if series.synthetic else 'real'})")

    env = OptionsEnv(series, _env_cfg(cfg))
    agent = QAgent(
        gamma=cfg.training.gamma,
        alpha=cfg.training.alpha,
        epsilon=cfg.training.epsilon_start,
        epsilon_end=cfg.training.epsilon_end,
        epsilon_decay=cfg.training.epsilon_decay,
        seed=cfg.training.seed,
    )

    episodes = args.episodes or cfg.training.episodes
    best = float("-inf")
    for ep in range(1, episodes + 1):
        res = run_episode(env, agent_policy(agent, explore=True), learn_agent=agent)
        agent.decay_epsilon()
        if res.final_equity > best:
            best = res.final_equity
        if ep == 1 or ep % max(1, episodes // 10) == 0 or ep == episodes:
            print(f"ep {ep:4d}/{episodes}  eps={agent.epsilon:.3f}  "
                  f"equity=${res.final_equity:,.2f}  best=${best:,.2f}")

    out = Path(args.out) if args.out else Path(cfg.paths.model_dir) / f"{series.ticker}.pkl"
    agent.save(out)
    print(f"Saved agent to {out}  (|Q|={len(agent.q)})")
    return 0


def cmd_backtest(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    series = load_prices(
        args.ticker or cfg.market.ticker,
        args.start or cfg.market.start,
        args.end or cfg.market.end,
        use_synthetic_if_offline=cfg.market.use_synthetic_if_offline,
        cache_dir=cfg.paths.data_cache,
    )
    env = OptionsEnv(series, _env_cfg(cfg))

    if args.agent:
        agent = QAgent.load(args.agent)
        policy = agent_policy(agent, explore=False)
        tag = "agent"
    else:
        strat = RSIStrategy(
            rsi_buy_below=cfg.strategy.rsi_buy_below,
            rsi_sell_above=cfg.strategy.rsi_sell_above,
            take_profit_pct=cfg.strategy.take_profit_pct,
            stop_loss_pct=cfg.strategy.stop_loss_pct,
        )
        policy = rsi_policy(strat)
        tag = "rsi"

    result = run_episode(env, policy)
    _print_result(tag, result, cfg.simulation.starting_cash)
    return 0


def cmd_paper(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    series = load_prices(
        args.ticker or cfg.market.ticker,
        args.start or cfg.market.start,
        args.end or cfg.market.end,
        use_synthetic_if_offline=cfg.market.use_synthetic_if_offline,
        cache_dir=cfg.paths.data_cache,
    )
    steps = args.steps
    series = extend_synthetic(series, steps=steps)
    env = OptionsEnv(series, _env_cfg(cfg))

    if args.agent:
        agent = QAgent.load(args.agent)
        policy = agent_policy(agent, explore=False)
        tag = "paper[agent]"
    else:
        strat = RSIStrategy(
            rsi_buy_below=cfg.strategy.rsi_buy_below,
            rsi_sell_above=cfg.strategy.rsi_sell_above,
            take_profit_pct=cfg.strategy.take_profit_pct,
            stop_loss_pct=cfg.strategy.stop_loss_pct,
        )
        policy = rsi_policy(strat)
        tag = "paper[rsi]"

    state = env.reset()
    done = False
    last_n = 0
    while not done:
        action = policy(state, env)
        state, reward, done, info = env.step(action)
        # Only print the *simulated future* portion, not the warmup replay.
        if env.t > len(series) - steps:
            if last_n != env.t:
                print(f"{info['dt']}  spot=${info['spot']:.2f}  "
                      f"action={['HOLD','BUY','SELL'][info['action']]:4s}  "
                      f"equity=${info['equity']:,.2f}")
                last_n = env.t

    print(f"[{tag}] final equity = ${env.equity:,.2f}")
    return 0


# ----------------------------------------------------------------------
# entry point
# ----------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="tradebot",
        description="Paper-trading simulator and trainer for call options "
                    "(simulation only — does not place real orders).",
    )
    p.add_argument("--config", default=None, help="path to config.yaml")
    sub = p.add_subparsers(dest="cmd", required=True)

    pt = sub.add_parser("train", help="train a Q-learning agent")
    pt.add_argument("--ticker")
    pt.add_argument("--start")
    pt.add_argument("--end")
    pt.add_argument("--episodes", type=int)
    pt.add_argument("--out")
    pt.set_defaults(func=cmd_train)

    pb = sub.add_parser("backtest", help="evaluate an agent or the RSI baseline")
    pb.add_argument("--ticker")
    pb.add_argument("--start")
    pb.add_argument("--end")
    pb.add_argument("--agent", help="path to a trained agent .pkl")
    pb.set_defaults(func=cmd_backtest)

    pp = sub.add_parser("paper", help="simulate forward on synthetic future bars")
    pp.add_argument("--ticker")
    pp.add_argument("--start")
    pp.add_argument("--end")
    pp.add_argument("--agent", help="path to a trained agent .pkl")
    pp.add_argument("--steps", type=int, default=30,
                    help="number of synthetic future bars to simulate")
    pp.set_defaults(func=cmd_paper)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
