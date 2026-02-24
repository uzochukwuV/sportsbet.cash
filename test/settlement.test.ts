/**
 * SportsBet.cash - Settlement Tests
 *
 * Tests for outcome determination and payout calculations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  determineOutcome,
  calculatePayout,
  isRedeemable,
  calculateSettlementStats,
  calculatePnL,
  calculateCancelledRefund,
} from '../src/settlement.js';
import { MatchState } from '../src/types.js';
import type { Match, MatchScores } from '../src/types.js';

const PRICE_PER_UNIT = 10000n; // 10,000 sats per token

describe('Outcome Determination', () => {
  it('should determine HOME win', () => {
    const outcome = determineOutcome(105, 98);
    assert.strictEqual(outcome, 'HOME');
  });

  it('should determine AWAY win', () => {
    const outcome = determineOutcome(95, 102);
    assert.strictEqual(outcome, 'AWAY');
  });

  it('should determine DRAW', () => {
    const outcome = determineOutcome(100, 100);
    assert.strictEqual(outcome, 'DRAW');
  });

  it('should handle zero scores', () => {
    const outcome = determineOutcome(0, 0);
    assert.strictEqual(outcome, 'DRAW');
  });

  it('should handle large scores', () => {
    const outcome = determineOutcome(150, 145);
    assert.strictEqual(outcome, 'HOME');
  });
});

describe('Payout Calculations', () => {
  describe('HOME wins', () => {
    it('should pay full value to HOME_WIN token holders', () => {
      const payout = calculatePayout(1000n, 'HOME', 'HOME_WIN', PRICE_PER_UNIT);
      assert.strictEqual(payout, 1000n * PRICE_PER_UNIT);
    });

    it('should pay nothing to AWAY_WIN token holders', () => {
      const payout = calculatePayout(1000n, 'HOME', 'AWAY_WIN', PRICE_PER_UNIT);
      assert.strictEqual(payout, 0n);
    });
  });

  describe('AWAY wins', () => {
    it('should pay full value to AWAY_WIN token holders', () => {
      const payout = calculatePayout(1000n, 'AWAY', 'AWAY_WIN', PRICE_PER_UNIT);
      assert.strictEqual(payout, 1000n * PRICE_PER_UNIT);
    });

    it('should pay nothing to HOME_WIN token holders', () => {
      const payout = calculatePayout(1000n, 'AWAY', 'HOME_WIN', PRICE_PER_UNIT);
      assert.strictEqual(payout, 0n);
    });
  });

  describe('DRAW', () => {
    it('should pay half value to HOME_WIN token holders', () => {
      const payout = calculatePayout(1000n, 'DRAW', 'HOME_WIN', PRICE_PER_UNIT);
      assert.strictEqual(payout, (1000n * PRICE_PER_UNIT) / 2n);
    });

    it('should pay half value to AWAY_WIN token holders', () => {
      const payout = calculatePayout(1000n, 'DRAW', 'AWAY_WIN', PRICE_PER_UNIT);
      assert.strictEqual(payout, (1000n * PRICE_PER_UNIT) / 2n);
    });
  });
});

describe('Redeemability Check', () => {
  it('should allow HOME_WIN redemption when HOME wins', () => {
    assert.strictEqual(isRedeemable('HOME', 'HOME_WIN'), true);
  });

  it('should not allow AWAY_WIN redemption when HOME wins', () => {
    assert.strictEqual(isRedeemable('HOME', 'AWAY_WIN'), false);
  });

  it('should allow AWAY_WIN redemption when AWAY wins', () => {
    assert.strictEqual(isRedeemable('AWAY', 'AWAY_WIN'), true);
  });

  it('should not allow HOME_WIN redemption when AWAY wins', () => {
    assert.strictEqual(isRedeemable('AWAY', 'HOME_WIN'), false);
  });

  it('should allow both token types in DRAW', () => {
    assert.strictEqual(isRedeemable('DRAW', 'HOME_WIN'), true);
    assert.strictEqual(isRedeemable('DRAW', 'AWAY_WIN'), true);
  });
});

describe('Settlement Statistics', () => {
  const createMockMatch = (homeScore: number, awayScore: number): Match => ({
    config: {
      matchId: 'test',
      sportType: 0,
      homeTeam: 'HOM1',
      awayTeam: 'AWY1',
      startTime: 0,
      halftimeTime: 0,
      endTime: 0,
      initialLiquidity: 100000n,
    },
    state: MatchState.FINAL,
    scores: {
      homeScore1H: Math.floor(homeScore / 2),
      awayScore1H: Math.floor(awayScore / 2),
      homeScoreFinal: homeScore,
      awayScoreFinal: awayScore,
    },
    oracleCommitment: '',
    poolAddress: '',
    homeTokenCategory: '',
    awayTokenCategory: '',
    createdAt: 0,
    updatedAt: 0,
  });

  it('should calculate stats for HOME win', () => {
    const match = createMockMatch(105, 98);
    const stats = calculateSettlementStats(match, 60000n, 40000n, PRICE_PER_UNIT);

    assert.strictEqual(stats.outcome, 'HOME');
    assert.strictEqual(stats.winningTokens, 60000n);
    assert.strictEqual(stats.losingTokens, 40000n);
    assert.strictEqual(stats.homePayoutPerToken, PRICE_PER_UNIT);
    assert.strictEqual(stats.awayPayoutPerToken, 0n);
  });

  it('should calculate stats for AWAY win', () => {
    const match = createMockMatch(95, 102);
    const stats = calculateSettlementStats(match, 60000n, 40000n, PRICE_PER_UNIT);

    assert.strictEqual(stats.outcome, 'AWAY');
    assert.strictEqual(stats.winningTokens, 40000n);
    assert.strictEqual(stats.losingTokens, 60000n);
    assert.strictEqual(stats.homePayoutPerToken, 0n);
    assert.strictEqual(stats.awayPayoutPerToken, PRICE_PER_UNIT);
  });

  it('should calculate stats for DRAW', () => {
    const match = createMockMatch(100, 100);
    const stats = calculateSettlementStats(match, 60000n, 40000n, PRICE_PER_UNIT);

    assert.strictEqual(stats.outcome, 'DRAW');
    assert.strictEqual(stats.winningTokens, 100000n);
    assert.strictEqual(stats.losingTokens, 0n);
    assert.strictEqual(stats.homePayoutPerToken, PRICE_PER_UNIT / 2n);
    assert.strictEqual(stats.awayPayoutPerToken, PRICE_PER_UNIT / 2n);
  });

  it('should calculate total payout correctly', () => {
    const match = createMockMatch(105, 98);
    const stats = calculateSettlementStats(match, 60000n, 40000n, PRICE_PER_UNIT);

    // Only winning tokens get paid
    const expectedPayout = 60000n * PRICE_PER_UNIT;
    assert.strictEqual(stats.totalPayout, expectedPayout);
  });
});

describe('P&L Calculation', () => {
  const createMockMatch = (homeScore: number, awayScore: number): Match => ({
    config: {
      matchId: 'test',
      sportType: 0,
      homeTeam: 'HOM1',
      awayTeam: 'AWY1',
      startTime: 0,
      halftimeTime: 0,
      endTime: 0,
      initialLiquidity: 100000n,
    },
    state: MatchState.FINAL,
    scores: {
      homeScore1H: Math.floor(homeScore / 2),
      awayScore1H: Math.floor(awayScore / 2),
      homeScoreFinal: homeScore,
      awayScoreFinal: awayScore,
    },
    oracleCommitment: '',
    poolAddress: '',
    homeTokenCategory: '',
    awayTokenCategory: '',
    createdAt: 0,
    updatedAt: 0,
  });

  it('should calculate profit for winning position', () => {
    const match = createMockMatch(105, 98); // HOME wins
    const tokenAmount = 1000n;
    const avgCost = 5000n; // Bought at 50% price

    const result = calculatePnL(
      tokenAmount,
      'HOME_WIN',
      avgCost,
      match,
      PRICE_PER_UNIT
    );

    // Paid: 1000 * 5000 = 5,000,000 sats
    // Redemption: 1000 * 10000 = 10,000,000 sats
    // PnL: +5,000,000 sats
    assert.strictEqual(result.pnl, 5000000n);
    assert.ok(result.pnlPercent > 0);
    assert.strictEqual(result.redemptionValue, 10000000n);
  });

  it('should calculate loss for losing position', () => {
    const match = createMockMatch(95, 102); // AWAY wins
    const tokenAmount = 1000n;
    const avgCost = 6000n; // Bought at 60% price

    const result = calculatePnL(
      tokenAmount,
      'HOME_WIN',
      avgCost,
      match,
      PRICE_PER_UNIT
    );

    // Paid: 1000 * 6000 = 6,000,000 sats
    // Redemption: 0 sats (losing tokens)
    // PnL: -6,000,000 sats
    assert.strictEqual(result.pnl, -6000000n);
    assert.strictEqual(result.pnlPercent, -100);
    assert.strictEqual(result.redemptionValue, 0n);
  });

  it('should calculate partial return in draw', () => {
    const match = createMockMatch(100, 100); // DRAW
    const tokenAmount = 1000n;
    const avgCost = 6000n; // Bought at 60% price

    const result = calculatePnL(
      tokenAmount,
      'HOME_WIN',
      avgCost,
      match,
      PRICE_PER_UNIT
    );

    // Paid: 1000 * 6000 = 6,000,000 sats
    // Redemption: 1000 * 5000 = 5,000,000 sats (50% in draw)
    // PnL: -1,000,000 sats
    assert.strictEqual(result.pnl, -1000000n);
    assert.strictEqual(result.redemptionValue, 5000000n);
  });

  it('should calculate break-even correctly', () => {
    const match = createMockMatch(105, 98);
    const tokenAmount = 1000n;
    const avgCost = PRICE_PER_UNIT; // Bought at 100% price

    const result = calculatePnL(
      tokenAmount,
      'HOME_WIN',
      avgCost,
      match,
      PRICE_PER_UNIT
    );

    // Break even
    assert.strictEqual(result.pnl, 0n);
    assert.strictEqual(result.pnlPercent, 0);
  });
});

describe('Cancelled Match Refunds', () => {
  it('should refund at 50% for cancelled matches', () => {
    const tokenAmount = 1000n;
    const refund = calculateCancelledRefund(tokenAmount, PRICE_PER_UNIT);

    assert.strictEqual(refund, (tokenAmount * PRICE_PER_UNIT) / 2n);
  });

  it('should handle large token amounts', () => {
    const tokenAmount = 1000000n;
    const refund = calculateCancelledRefund(tokenAmount, PRICE_PER_UNIT);

    assert.strictEqual(refund, (tokenAmount * PRICE_PER_UNIT) / 2n);
  });

  it('should handle zero tokens', () => {
    const refund = calculateCancelledRefund(0n, PRICE_PER_UNIT);
    assert.strictEqual(refund, 0n);
  });
});

describe('Edge Cases', () => {
  it('should handle single token payout', () => {
    const payout = calculatePayout(1n, 'HOME', 'HOME_WIN', PRICE_PER_UNIT);
    assert.strictEqual(payout, PRICE_PER_UNIT);
  });

  it('should handle very large token amounts', () => {
    const largeAmount = BigInt(10 ** 12);
    const payout = calculatePayout(largeAmount, 'HOME', 'HOME_WIN', PRICE_PER_UNIT);
    assert.strictEqual(payout, largeAmount * PRICE_PER_UNIT);
  });

  it('should handle different price per unit', () => {
    const customPrice = 100000n; // 100,000 sats
    const payout = calculatePayout(1000n, 'HOME', 'HOME_WIN', customPrice);
    assert.strictEqual(payout, 1000n * customPrice);
  });
});
