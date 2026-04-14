import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tradebot — paper-trading simulator",
  description:
    "Train and backtest a reinforcement learning agent that trades call options. Simulation only — no real orders.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
