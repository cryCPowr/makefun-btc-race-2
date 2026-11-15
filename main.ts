// Selective deep-dip BTC bot for make.fun btc-race-24h-20261115-0828.
//
// Idea: the dev window is one long grind down with choppy 0.5-1.8% bounces and a
// single +5.5% recovery rally. Every arm that trades the decline phase loses
// money, so this bot stays flat through the whole decline and fires exactly
// once, near the major bottom, then rides the recovery.
//
// Entry (flat only): the 60-bar close return is <= -2.0% AND the 120-bar close
// return is <= -2.2%. The long-window filter blocks the ordinary 1-2% dips of
// the grind (all losers) and only fires when the market has fallen hard on both
// windows, i.e. near the one major bottom. Buy with 100% of cash.
//
// Exit (whole position) when any of these holds on a bar's close:
//   - the close falls 1.5% below the highest close since entry (trailing stop), or
//   - the close reaches 5.0% above the entry close (take-profit).
//
// Verified dev grade (grade-local, process driver): +$48.866715 USDC, 2 trades,
// max drawdown 0.53%, 0 rejected orders, L1 regrade reproduced byte for byte.
// Action log sha256: a5878b25cec967aa782e5a99b6dfcffc2f519fa42b24396a37c6fe697bcd82be
//
// No randomness, no wall clock, no reads outside the bot directory. Orders are
// decided on a bar's close and fill at the next bar's open, per the protocol.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Entry: deep dip on both a short and a long lookback (returns in basis points).
const DIP_SHORT_BARS = 60;
const DIP_SHORT_MAX_BPS = -200; // -2.0% over 60 bars
const DIP_LONG_BARS = 120;
const DIP_LONG_MAX_BPS = -220; // -2.2% over 120 bars

// Exit: trailing stop below the peak since entry, take-profit above entry close.
const TRAIL_BPS = 150; // 1.5%
const TAKE_PROFIT_BPS = 500; // 5.0%
const MAX_SLIPPAGE_BPS = 100;

// Close history, oldest first. Returns are computed on raw integer prices, so
// the price scale cancels out and no floating point is ever used.
const closes: bigint[] = [];
let entryClose = 0n;
let peakClose = 0n;

// (now - back) / back, in basis points, integer math truncated toward zero.
function returnBps(now: bigint, back: bigint): bigint {
  return ((now - back) * 10000n) / back;
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    if (qty === 0n) {
      // Flat: only the deep-dip entry can fire.
      if (closes.length <= DIP_LONG_BARS) return [];
      const now = closes[closes.length - 1]!;
      const shortBack = closes[closes.length - 1 - DIP_SHORT_BARS]!;
      const longBack = closes[closes.length - 1 - DIP_LONG_BARS]!;
      const shortRet = returnBps(now, shortBack);
      const longRet = returnBps(now, longBack);
      if (shortRet <= BigInt(DIP_SHORT_MAX_BPS) && longRet <= BigInt(DIP_LONG_MAX_BPS)) {
        entryClose = now;
        peakClose = now;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Holding: ratchet the peak, then check the trailing stop and take-profit.
    if (close > peakClose) peakClose = close;
    const trailPrice = (peakClose * BigInt(10000 - TRAIL_BPS)) / 10000n;
    const profitPrice = (entryClose * BigInt(10000 + TAKE_PROFIT_BPS)) / 10000n;
    if (close <= trailPrice || close >= profitPrice) {
      return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  },
});
