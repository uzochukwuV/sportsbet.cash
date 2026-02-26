/**
 * SportsBet.cash - AMM Tests
 *
 * Tests for the Constant Product Market Maker (CPMM) logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculatePrices,
  calculateTokensOut,
  calculateBchOut,
  calculateBchRequired,
  calculatePriceImpact,
  calculateMinTokensOut,
  parsePoolState,
  encodePoolState,
} from '../src/amm.js';

describe('Price Calculations', () => {
  it('should calculate 50/50 prices for equal reserves', () => {
    const { priceHome, priceAway } = calculatePrices(1000n, 1000n);

    assert.strictEqual(priceHome, 0.5, 'Home price should be 0.5');
    assert.strictEqual(priceAway, 0.5, 'Away price should be 0.5');
  });

  it('should sum to 1.0', () => {
    const { priceHome, priceAway } = calculatePrices(7500n, 2500n);

    assert.ok(
      Math.abs(priceHome + priceAway - 1.0) < 0.0001,
      'Prices should sum to 1.0'
    );
  });

  it('should calculate correct prices for unequal reserves', () => {
    // 75% HOME, 25% AWAY in reserves means HOME is cheaper (more supply)
    const { priceHome, priceAway } = calculatePrices(7500n, 2500n);

    // Price = otherReserve / total
    // priceHome = 2500 / 10000 = 0.25
    assert.strictEqual(priceHome, 0.25, 'Home price should be 0.25');
    assert.strictEqual(priceAway, 0.75, 'Away price should be 0.75');
  });

  it('should handle zero reserves gracefully', () => {
    const { priceHome, priceAway } = calculatePrices(0n, 0n);

    assert.strictEqual(priceHome, 0.5, 'Should default to 0.5');
    assert.strictEqual(priceAway, 0.5, 'Should default to 0.5');
  });
});

describe('Token Out Calculation (Buying)', () => {
  it('should calculate tokens out with no fee', () => {
    // reserveSats = 10000, otherReserveSats = 10000, bchIn = 1000, pricePerUnit = 1 (raw formula test)
    // satsBought = (10000 * 1000) / (10000 + 1000) = 10000000 / 11000 = 909
    // tokensOut = satsBought / 1 = 909
    const tokensOut = calculateTokensOut(1000n, 10000n, 10000n, 0n, 10000n, 1n);

    assert.strictEqual(tokensOut, 909n, 'Should get ~909 tokens');
  });

  it('should return fewer tokens with fee', () => {
    const tokensOutNoFee = calculateTokensOut(1000n, 10000n, 10000n, 0n, 10000n, 1n);
    const tokensOutWithFee = calculateTokensOut(1000n, 10000n, 10000n, 30n, 10000n, 1n);

    assert.ok(
      tokensOutWithFee < tokensOutNoFee,
      'Tokens with fee should be less'
    );
  });

  it('should handle large trades', () => {
    // Buying half the reserve (pricePerUnit=1 for raw formula test)
    const tokensOut = calculateTokensOut(10000n, 10000n, 10000n, 0n, 10000n, 1n);

    // satsBought = (10000 * 10000) / (10000 + 10000) = 5000
    assert.strictEqual(tokensOut, 5000n, 'Should get 5000 tokens');
  });

  it('should approach but never reach full reserve', () => {
    // Even a very large trade can't drain the pool completely (pricePerUnit=1 for raw formula test)
    const tokensOut = calculateTokensOut(1000000n, 10000n, 10000n, 0n, 10000n, 1n);

    assert.ok(tokensOut < 10000n, 'Can never drain full reserve');
  });
});

describe('BCH Out Calculation (Selling)', () => {
  it('should calculate BCH out when selling tokens', () => {
    // pricePerUnit=1n: raw formula test, reserves and tokens in same unit
    // satsIn = 1000*1=1000; bchOut = (10000*1000)/(10000+1000) = 909
    const bchOut = calculateBchOut(1000n, 10000n, 10000n, 0n, 10000n, 1n);

    assert.strictEqual(bchOut, 909n, 'Should get ~909 BCH');
  });

  it('should be symmetric with buying (minus fees)', () => {
    // pricePerUnit=1n: raw formula test
    const reserveToken = 10000n;
    const reserveOther = 10000n;

    const bchIn = 526n;
    const tokensBought = calculateTokensOut(bchIn, reserveToken, reserveOther, 0n, 10000n, 1n);

    // With pricePerUnit=1, satsBought = tokensBought, so reserve update is consistent
    const newReserveToken = reserveToken - tokensBought;
    const newReserveOther = reserveOther + bchIn;

    const bchBack = calculateBchOut(tokensBought, newReserveToken, newReserveOther, 0n, 10000n, 1n);

    assert.ok(bchBack <= bchIn, 'Should get back less or equal BCH');
  });
});

describe('BCH Required Calculation', () => {
  it('should calculate BCH required for exact token amount', () => {
    // pricePerUnit=1n: raw formula test
    const tokensWanted = 500n;
    const bchRequired = calculateBchRequired(tokensWanted, 10000n, 10000n, 0n, 10000n, 1n);

    const actualTokens = calculateTokensOut(bchRequired, 10000n, 10000n, 0n, 10000n, 1n);

    assert.ok(actualTokens >= tokensWanted, 'Should get at least the tokens wanted');
  });

  it('should throw for impossible amounts', () => {
    // satsBought = 10001 * 1 = 10001 >= reserveSats=10000, so throws
    assert.throws(
      () => calculateBchRequired(10001n, 10000n, 10000n, 0n, 10000n, 1n),
      /Cannot buy more tokens than in reserve/
    );
  });

  it('should account for fees', () => {
    const tokensWanted = 500n;
    const bchNoFee = calculateBchRequired(tokensWanted, 10000n, 10000n, 0n, 10000n, 1n);
    const bchWithFee = calculateBchRequired(tokensWanted, 10000n, 10000n, 30n, 10000n, 1n);

    assert.ok(bchWithFee > bchNoFee, 'Should need more BCH with fees');
  });
});

describe('Price Impact', () => {
  it('should calculate price impact for buy', () => {
    const impact = calculatePriceImpact(1000n, 10000n, 10000n, true);

    assert.ok(impact > 0, 'Price impact should be positive');
    assert.ok(impact < 1, 'Price impact should be less than 100%');
  });

  it('should calculate price impact for sell', () => {
    const impact = calculatePriceImpact(1000n, 10000n, 10000n, false);

    assert.ok(impact > 0, 'Price impact should be positive');
  });

  it('should have higher impact for larger trades', () => {
    const smallImpact = calculatePriceImpact(100n, 10000n, 10000n, true);
    const largeImpact = calculatePriceImpact(5000n, 10000n, 10000n, true);

    assert.ok(largeImpact > smallImpact, 'Larger trades should have more impact');
  });

  it('should have lower impact on deeper pools', () => {
    const shallowImpact = calculatePriceImpact(1000n, 10000n, 10000n, true);
    const deepImpact = calculatePriceImpact(1000n, 100000n, 100000n, true);

    assert.ok(deepImpact < shallowImpact, 'Deeper pools should have less impact');
  });
});

describe('Slippage Protection', () => {
  it('should calculate minimum tokens with slippage', () => {
    const expected = 1000n;
    const minTokens = calculateMinTokensOut(expected, 0.01); // 1% slippage

    assert.strictEqual(minTokens, 990n, 'Should be 99% of expected');
  });

  it('should handle zero slippage', () => {
    const expected = 1000n;
    const minTokens = calculateMinTokensOut(expected, 0);

    assert.strictEqual(minTokens, 1000n, 'Zero slippage should return exact amount');
  });

  it('should handle high slippage tolerance', () => {
    const expected = 1000n;
    const minTokens = calculateMinTokensOut(expected, 0.5); // 50% slippage

    assert.strictEqual(minTokens, 500n, '50% slippage should return half');
  });
});

describe('Constant Product Invariant', () => {
  it('should maintain k after trade (approximately)', () => {
    // pricePerUnit=1n: satsBought = tokensOut, so reserve update is in consistent units
    const reserveHome = 10000n;
    const reserveAway = 10000n;
    const k = reserveHome * reserveAway;

    const bchIn = 2000n;
    // With pricePerUnit=1n, satsBought == tokensOut (same unit)
    const satsBought = calculateTokensOut(bchIn, reserveHome, reserveAway, 0n, 10000n, 1n);

    const newReserveHome = reserveHome - satsBought;
    const newReserveAway = reserveAway + bchIn;
    const newK = newReserveHome * newReserveAway;

    // k should be preserved (with no fee here; with fee k increases)
    assert.ok(
      newK >= k,
      'k should be maintained or increased with fees'
    );
  });
});

describe('Pool State Encoding/Decoding', () => {
  it('should encode and decode pool state', () => {
    const state = 1; // TRADING
    const reserveHome = 12345n;
    const reserveAway = 67890n;

    // Create dummy commitment data
    const existingData = new Uint8Array(82);
    existingData[0] = 0; // Original state

    const encoded = encodePoolState(state, reserveHome, reserveAway, existingData);

    assert.strictEqual(encoded[0], state, 'State should match');

    const decoded = parsePoolState(encoded);

    assert.strictEqual(decoded.reserveHome, reserveHome, 'Reserve home should match');
    assert.strictEqual(decoded.reserveAway, reserveAway, 'Reserve away should match');
  });

  it('should calculate k from parsed state', () => {
    const reserveHome = 10000n;
    const reserveAway = 10000n;

    const existingData = new Uint8Array(82);
    const encoded = encodePoolState(0, reserveHome, reserveAway, existingData);
    const decoded = parsePoolState(encoded);

    assert.strictEqual(decoded.k, reserveHome * reserveAway, 'k should be product of reserves');
  });

  it('should calculate prices from parsed state', () => {
    const reserveHome = 7500n;
    const reserveAway = 2500n;

    const existingData = new Uint8Array(82);
    const encoded = encodePoolState(0, reserveHome, reserveAway, existingData);
    const decoded = parsePoolState(encoded);

    assert.strictEqual(decoded.priceHome, 0.25, 'Home price should be 0.25');
    assert.strictEqual(decoded.priceAway, 0.75, 'Away price should be 0.75');
  });
});

describe('Edge Cases', () => {
  it('should handle very small reserves', () => {
    const { priceHome, priceAway } = calculatePrices(1n, 1n);

    assert.strictEqual(priceHome, 0.5);
    assert.strictEqual(priceAway, 0.5);
  });

  it('should handle very large reserves', () => {
    const largeReserve = BigInt(10 ** 15); // 1 quadrillion
    const { priceHome, priceAway } = calculatePrices(largeReserve, largeReserve);

    assert.strictEqual(priceHome, 0.5);
    assert.strictEqual(priceAway, 0.5);
  });

  it('should handle asymmetric large reserves', () => {
    const { priceHome, priceAway } = calculatePrices(
      BigInt(10 ** 15),
      BigInt(10 ** 12)
    );

    // Total = 1000000000000000 + 1000000000000 = 1001000000000000
    // priceHome = 1000000000000 / 1001000000000000 ≈ 0.000999
    assert.ok(priceHome < 0.01, 'Price should be very low');
    assert.ok(priceAway > 0.99, 'Away price should be very high');
  });
});

describe('Fee Calculation Accuracy', () => {
  it('should apply 0.3% fee correctly', () => {
    const bchIn = 10000n;
    const fee = 30n; // 0.3% = 30 basis points
    const denominator = 10000n;

    const effectiveIn = (bchIn * (denominator - fee)) / denominator;
    const expectedEffective = 9970n; // 10000 * 0.997

    assert.strictEqual(effectiveIn, expectedEffective, 'Fee should reduce by 0.3%');
  });

  it('should give fewer tokens with standard 0.3% fee', () => {
    // Use sats-scale reserves so satsBought/pricePerUnit gives meaningful token counts
    const bchIn = 100_000_000n; // 1 BCH
    const reserve = 1_000_000_000n; // 10 BCH per side

    const tokensNoFee = calculateTokensOut(bchIn, reserve, reserve, 0n, 10000n);
    const tokensWith03Fee = calculateTokensOut(bchIn, reserve, reserve, 30n, 10000n);

    // The CPMM formula is non-linear: a 0.3% fee on effectiveIn produces
    // a slightly different (non-linear) reduction in tokensOut.
    // Verify the fee reduces output and stays in a reasonable range (0.1%-0.6%).
    assert.ok(tokensWith03Fee < tokensNoFee, 'Fee should reduce tokens out');
    const reductionPercent = Number(tokensNoFee - tokensWith03Fee) / Number(tokensNoFee);
    assert.ok(
      reductionPercent > 0.001 && reductionPercent < 0.006,
      `Fee reduction should be ~0.3% (got ${(reductionPercent * 100).toFixed(3)}%)`
    );
  });
});
