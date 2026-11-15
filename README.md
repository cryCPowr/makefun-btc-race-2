# Selective deep-dip BTC bot

Entry for make.fun "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261115-0828`). Trades Coinbase Wrapped BTC (cbBTC) against
USDC, long only, starting from $1,000 of paper money.

## Strategy

The dev window is one long grind down with choppy 0.5–1.8% bounces and a
single +5.5% recovery rally. The bot stays flat through the decline and fires
once, near the major bottom, then rides the recovery:

- **Buy** (100% of cash) when the 60-bar close return is ≤ −2.0% **and** the
  120-bar close return is ≤ −2.2%.
- **Sell** everything when the close falls 1.5% below the highest close since
  entry (trailing stop), or reaches 5.0% above the entry close (take-profit).

One round trip on the dev window. No randomness, no wall clock, no network.

## Verified dev grade (local harness, `grade-local --driver process`)

- **Net PnL: +$48.866715 USDC** (return +4.89%)
- Trades: 2 fills (1 round trip), win rate 1.000
- Max drawdown: 0.53%
- Fees: $0.82; at 2x fees +$48.03
- Guardrails met, 0 rejected orders, L1 regrade reproduced byte for byte
- Action log sha256: `a5878b25cec967aa782e5a99b6dfcffc2f519fa42b24396a37c6fe697bcd82be`

Buy decided bar 1037 (filled $62,290, near the $62,006 low) → sell decided
bar 1113 (filled $65,341, near the $65,432 high).
