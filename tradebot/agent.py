"""Tabular Q-learning agent.

State and action spaces are discrete (see ``env.py``), so we can keep the
Q-table as a plain dict. Serialization is pickle-based and fits in a few KB.
"""
from __future__ import annotations

import pickle
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Tuple

from .env import N_ACTIONS, State


@dataclass
class QAgent:
    gamma: float = 0.97
    alpha: float = 0.1
    epsilon: float = 1.0
    epsilon_end: float = 0.05
    epsilon_decay: float = 0.995
    seed: int = 42
    q: Dict[Tuple[State, int], float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    # ------------------------------------------------------------------
    # Policy
    # ------------------------------------------------------------------

    def _q(self, s: State, a: int) -> float:
        return self.q.get((s, a), 0.0)

    def best_action(self, s: State) -> int:
        best_a, best_v = 0, float("-inf")
        for a in range(N_ACTIONS):
            v = self._q(s, a)
            if v > best_v:
                best_v = v
                best_a = a
        return best_a

    def act(self, s: State, *, explore: bool = True) -> int:
        if explore and self._rng.random() < self.epsilon:
            return self._rng.randrange(N_ACTIONS)
        return self.best_action(s)

    # ------------------------------------------------------------------
    # Learning
    # ------------------------------------------------------------------

    def update(self, s: State, a: int, r: float, s_next: State, done: bool) -> None:
        current = self._q(s, a)
        if done:
            target = r
        else:
            best_next = max(self._q(s_next, a2) for a2 in range(N_ACTIONS))
            target = r + self.gamma * best_next
        self.q[(s, a)] = current + self.alpha * (target - current)

    def decay_epsilon(self) -> None:
        self.epsilon = max(self.epsilon_end, self.epsilon * self.epsilon_decay)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str | Path) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "wb") as f:
            pickle.dump(
                {
                    "gamma": self.gamma, "alpha": self.alpha,
                    "epsilon": self.epsilon, "epsilon_end": self.epsilon_end,
                    "epsilon_decay": self.epsilon_decay, "seed": self.seed,
                    "q": self.q,
                },
                f,
            )

    @classmethod
    def load(cls, path: str | Path) -> "QAgent":
        with open(path, "rb") as f:
            data = pickle.load(f)
        agent = cls(
            gamma=data["gamma"], alpha=data["alpha"], epsilon=data["epsilon"],
            epsilon_end=data["epsilon_end"], epsilon_decay=data["epsilon_decay"],
            seed=data["seed"],
        )
        agent.q = data["q"]
        return agent
