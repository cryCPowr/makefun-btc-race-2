// Active trend + dip combo BTC bot for make.fun btc-race-24h-20261115-0828.
//
// The dev leaderboard is unofficial and does not decide the rewards; only the
// live 24h race does. So this bot is built to be SOLID and ACTIVE for the live
// race, not to maximise a dev number. It trades on up-legs as well as dips,
// stays out of flat markets where no trade can cover the ~$4.30 round-trip
// cost, and keeps drawdown low with tight exits.
//
// Three entry arms (flat only, checked in this order), all buying 100% of cash:
//   1. Momentum — EMA(8) crosses above EMA(24) with the gap between them
//      >= 0.05% of the price at the cross. The gap filter is essential: a
//      bare EMA cross fires 20-48 times on the dev window and loses money
//      to whipsaws; with the gap it fires only on real up-legs.
//   2. Breakout — the close breaks above the highest high of the previous
//      60 bars by >= 0.05%, AND the 60-bar high-low range is >= 1.5%. The
//      range gate is the robustness filter: on a flat window the 60-bar
//      range never reaches 1.5%, so the bot stays out instead of bleeding
//      on chop.
//   3. Deep-dip — the 60-bar close return is <= -2.0% AND the 120-bar close
//      return is <= -2.2%. Only fires near a major bottom; catches the one
//      +5.5% recovery rally.
//
// Exits (whole position, per arm, checked on a bar's close):
//   - Momentum / breakout arms: trailing stop 0.4% below the peak close
//     since entry, take-profit 2.5% above the entry close, hard stop 1.5%
//     below the entry close.
//   - Deep-dip arm: trailing stop 1.5% below the peak, take-profit 5.0%
//     above the entry close, no hard stop.
//
// No randomness, no wall clock, no reads outside the bot directory. Orders are
// decided on a bar's close and fill at the next bar's open, per the protocol.
//
// Verified dev grade (grade-local, process driver): +$41.450558 USDC, 6 trades
// (3 round trips), max drawdown 1.06%, 0 rejected orders, L1 regrade reproduced
// byte for byte. Action log sha256:
// 488c6281b21dd7ba6ae052f4601dea97574ae8619ebd1eefad28483101295af3
// Old-window (race-1 dev data) check: $0.00, 0 trades — stays out of flat markets.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Momentum: fast EMA crosses above the slow EMA, gap >= 5 bps of the price.
const MOM_FAST = 8;
const MOM_SLOW = 24;
const MOM_GAP_BPS = 5;

// Breakout: close above the previous 60-bar high by >= 5 bps, with the
// 60-bar high-low range >= 150 bps.
const BREAK_BARS = 60;
const BREAK_BPS = 5;
const RANGE_BARS = 60;
const RANGE_BPS = 150;

// Deep-dip: 60-bar return <= -200 bps AND 120-bar return <= -220 bps.
const DIP_SHORT_BARS = 60;
const DIP_SHORT_MAX_BPS = -200;
const DIP_LONG_BARS = 120;
const DIP_LONG_MAX_BPS = -220;

// Exits for the momentum / breakout arms.
const TRAIL_BPS = 40; // 0.4% below the peak since entry
const TP_BPS = 250; // 2.5% above the entry close
const STOP_BPS = 150; // 1.5% below the entry close

// Exits for the deep-dip arm.
const DEEP_TRAIL_BPS = 150; // 1.5% below the peak since entry
const DEEP_TP_BPS = 500; // 5.0% above the entry close

const MAX_SLIPPAGE_BPS = 100;

// Bar history, oldest first. Returns and ranges are computed on raw integer
// prices, so the price scale cancels out and no floating point is used there.
// The EMAs are floating point (prices are ~6e9 raw units, well inside the
// safe-integer range), seeded with the first close.
const closes: bigint[] = [];
const highs: bigint[] = [];
const lows: bigint[] = [];

let emaFast = 0;
let emaSlow = 0;
let prevFast = 0;
let prevSlow = 0;
let emaSeeded = false;

let entryClose = 0n;
let peakClose = 0n;
let arm: 'momentum' | 'breakout' | 'deep' | null = null;

// (now - back) / back, in basis points, integer math truncated toward zero.
function returnBps(now: bigint, back: bigint): bigint {
  return ((now - back) * 10000n) / back;
}

function buyAll(state: BarsState): OrderInput[] {
  return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const high = BigInt(bar.h);
    const low = BigInt(bar.l);
    closes.push(close);
    highs.push(high);
    lows.push(low);

    // Update the EMAs with this bar's close (seeded with the first close).
    const c = Number(close);
    if (!emaSeeded) {
      emaFast = c;
      emaSlow = c;
      emaSeeded = true;
    } else {
      prevFast = emaFast;
      prevSlow = emaSlow;
      const alphaFast = 2 / (MOM_FAST + 1);
      const alphaSlow = 2 / (MOM_SLOW + 1);
      emaFast = alphaFast * c + (1 - alphaFast) * emaFast;
      emaSlow = alphaSlow * c + (1 - alphaSlow) * emaSlow;
    }

    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    if (qty === 0n) {
      // Flat: check the three entry arms in order.
      // 1. Momentum: EMA(8) crosses above EMA(24) with a >= 5 bps gap.
      if (closes.length > 1) {
        const crossed = prevFast <= prevSlow && emaFast > emaSlow;
        const gapBps = ((emaFast - emaSlow) * 10000) / c;
        if (crossed && gapBps >= MOM_GAP_BPS) {
          arm = 'momentum';
          entryClose = close;
          peakClose = close;
          return buyAll(state);
        }
      }

      // 2. Breakout: close above the previous 60-bar high by >= 5 bps, and
      // the 60-bar high-low range >= 150 bps.
      if (closes.length > BREAK_BARS) {
        const end = closes.length - 1; // current bar index; previous bars are [end - 60, end)
        let high60 = 0n;
        let low60 = 0n;
        for (let i = end - BREAK_BARS; i < end; i++) {
          if (highs[i]! > high60) high60 = highs[i]!;
          if (low60 === 0n || lows[i]! < low60) low60 = lows[i]!;
        }
        const breakBps = ((close - high60) * 10000n) / high60;
        const rangeBps = ((high60 - low60) * 10000n) / low60;
        if (breakBps >= BigInt(BREAK_BPS) && rangeBps >= BigInt(RANGE_BPS)) {
          arm = 'breakout';
          entryClose = close;
          peakClose = close;
          return buyAll(state);
        }
      }

      // 3. Deep-dip: 60-bar return <= -200 bps AND 120-bar return <= -220 bps.
      if (closes.length > DIP_LONG_BARS) {
        const shortBack = closes[closes.length - 1 - DIP_SHORT_BARS]!;
        const longBack = closes[closes.length - 1 - DIP_LONG_BARS]!;
        const shortRet = returnBps(close, shortBack);
        const longRet = returnBps(close, longBack);
        if (shortRet <= BigInt(DIP_SHORT_MAX_BPS) && longRet <= BigInt(DIP_LONG_MAX_BPS)) {
          arm = 'deep';
          entryClose = close;
          peakClose = close;
          return buyAll(state);
        }
      }
      return [];
    }

    // Holding: ratchet the peak, then check this arm's exits.
    if (close > peakClose) peakClose = close;
    if (arm === 'deep') {
      const trailPrice = (peakClose * BigInt(10000 - DEEP_TRAIL_BPS)) / 10000n;
      const profitPrice = (entryClose * BigInt(10000 + DEEP_TP_BPS)) / 10000n;
      if (close <= trailPrice || close >= profitPrice) {
        arm = null;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    } else {
      const trailPrice = (peakClose * BigInt(10000 - TRAIL_BPS)) / 10000n;
      const profitPrice = (entryClose * BigInt(10000 + TP_BPS)) / 10000n;
      const stopPrice = (entryClose * BigInt(10000 - STOP_BPS)) / 10000n;
      if (close <= trailPrice || close >= profitPrice || close <= stopPrice) {
        arm = null;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});
