# Active trend + dip combo BTC bot

Entry for make.fun "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261115-0828`). Trades Coinbase Wrapped BTC (cbBTC) against
USDC, long only, starting from $1,000 of paper money.

## Strategy

The dev leaderboard is unofficial and does not decide the rewards; only the
live 24h race does. So this bot is built to be solid and active for the live
race, not to maximise a dev number. It trades on up-legs as well as dips,
stays out of flat markets where no trade can cover the ~$4.30 round-trip
cost, and keeps drawdown low with tight exits.

Three entry arms (flat only, checked in order), all buying 100% of cash:

- **Momentum** — EMA(8) crosses above EMA(24) with the gap between them
  ≥ 0.05% of the price at the cross. The gap filter keeps it off whipsaws.
- **Breakout** — the close breaks above the highest high of the previous
  60 bars by ≥ 0.05%, and the 60-bar high-low range is ≥ 1.5%. The range
  gate keeps the bot out of flat markets.
- **Deep-dip** — the 60-bar close return is ≤ −2.0% and the 120-bar close
  return is ≤ −2.2%. Only fires near a major bottom; catches the recovery
  rally.

Exits (whole position, per arm): momentum / breakout arms use a 0.4%
trailing stop, a 2.5% take-profit and a 1.5% hard stop; the deep-dip arm
uses a 1.5% trailing stop and a 5.0% take-profit. No randomness, no wall
clock, no network.

## Verified dev grade (local harness, `grade-local --driver process`)

- **Net PnL: +$41.450558 USDC** (return +4.15%)
- Trades: 6 fills (3 round trips), win rate 0.667
- Max drawdown: 1.06%
- Fees: $2.41; at 2x fees +$38.97
- Guardrails met, 0 rejected orders, L1 regrade reproduced byte for byte
- Action log sha256: `488c6281b21dd7ba6ae052f4601dea97574ae8619ebd1eefad28483101295af3`

Robustness check on the previous race's dev window (flat, 4.1% range):
**$0.00, 0 trades** — the bot stays out of flat markets instead of bleeding
on chop.
