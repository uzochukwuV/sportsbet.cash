/**
 * SportsBet.cash - Interactive Demo
 *
 * This script demonstrates the complete flow of:
 * 1. Creating a prediction market for a simulated basketball game
 * 2. VRF commitment for fair randomness
 * 3. Price discovery via CPMM (like Uniswap)
 * 4. Halftime score reveal and trading
 * 5. Final settlement
 */

import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  OracleManager,
  generateMatchId,
  calculatePrices,
  calculateTokensOut,
  calculateBchOut,
  calculatePriceImpact,
  previewScores,
  verifyMatchScores,
  determineOutcome,
  calculatePayout,
  calculateSettlementStats,
} from '../src/index.js';
import { SportType, MatchState } from '../src/types.js';

// =============================================================================
// DEMO CONFIGURATION
// =============================================================================

const INITIAL_LIQUIDITY = 1_000_000_000n; // 10 BCH per side in satoshis (sats-denominated CPMM)
const PRICE_PER_UNIT = 10_000n;           // 10,000 sats per token unit (0.0001 BCH)

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatSats(sats: bigint): string {
  const bch = Number(sats) / 100_000_000;
  return `${bch.toFixed(8)} BCH (${sats.toLocaleString()} sats)`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printHeader(title: string): void {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60) + '\n');
}

function printSubHeader(title: string): void {
  console.log('\n' + '-'.repeat(40));
  console.log(`  ${title}`);
  console.log('-'.repeat(40));
}

// =============================================================================
// MAIN DEMO
// =============================================================================

async function runDemo() {
  printHeader('SportsBet.cash - On-Chain Sports Betting Demo');

  console.log('This demo simulates a complete prediction market lifecycle:');
  console.log('  - Lakers vs Warriors basketball game');
  console.log('  - AMM-style trading with CPMM pricing');
  console.log('  - VRF commit-reveal for verifiable random scores');
  console.log('  - Halftime trading with price updates');
  console.log('  - Final settlement and payouts');

  // =========================================================================
  // STEP 1: Create Match with VRF Commitment
  // =========================================================================

  printHeader('Step 1: Match Creation with VRF Commitment');

  const oracle = new OracleManager();
  const matchId = generateMatchId();

  console.log(`Match ID: ${matchId}`);
  console.log('Sport: Basketball (NBA)');
  console.log('Teams: Los Angeles Lakers vs Golden State Warriors');
  console.log('');

  // Oracle creates commitment BEFORE any betting starts
  const commitment = await oracle.createMatchCommitment(matchId);

  console.log('Oracle Commitment (published BEFORE trading):');
  console.log(`  ${commitment.commitment}`);
  console.log('');
  console.log('Security: Oracle cannot predict outcome after commitment.');
  console.log('         Users cannot predict outcome before reveal.');
  console.log('         Anyone can verify reveal matches commitment.');

  // =========================================================================
  // STEP 2: Initial Pool State (50/50 odds)
  // =========================================================================

  printHeader('Step 2: AMM Pool Initialization');

  let reserveHome = INITIAL_LIQUIDITY;
  let reserveAway = INITIAL_LIQUIDITY;
  const k = reserveHome * reserveAway;

  console.log('Constant Product Market Maker (CPMM):');
  console.log(`  Formula: x * y = k`);
  console.log(`  k = ${k.toLocaleString()}`);
  console.log('');

  let prices = calculatePrices(reserveHome, reserveAway);

  console.log('Initial Pool State (reserves in satoshis):');
  console.log(`  HOME_WIN reserve: ${formatSats(reserveHome)}`);
  console.log(`  AWAY_WIN reserve: ${formatSats(reserveAway)}`);
  console.log(`  Price HOME_WIN: ${formatPercent(prices.priceHome)} (implied probability)`);
  console.log(`  Price AWAY_WIN: ${formatPercent(prices.priceAway)} (implied probability)`);
  console.log('');
  console.log('Decimal odds:');
  console.log(`  Lakers to win: ${(1 / prices.priceHome).toFixed(2)}x`);
  console.log(`  Warriors to win: ${(1 / prices.priceAway).toFixed(2)}x`);

  // =========================================================================
  // STEP 3: Trading Phase 1 - Users Place Bets
  // =========================================================================

  printHeader('Step 3: Trading Phase 1 (Pre-Match Betting)');

  // Simulate multiple trades
  const trades = [
    { user: 'Alice', side: 'HOME', bch: 50_000_000n },  // 0.5 BCH on Lakers
    { user: 'Bob', side: 'AWAY', bch: 30_000_000n },    // 0.3 BCH on Warriors
    { user: 'Carol', side: 'HOME', bch: 100_000_000n }, // 1.0 BCH on Lakers
    { user: 'Dave', side: 'AWAY', bch: 80_000_000n },   // 0.8 BCH on Warriors
    { user: 'Eve', side: 'HOME', bch: 200_000_000n },   // 2.0 BCH on Lakers
  ];

  for (const trade of trades) {
    const isHome = trade.side === 'HOME';
    const reserveToken = isHome ? reserveHome : reserveAway;
    const reserveOther = isHome ? reserveAway : reserveHome;

    // Sats-denominated CPMM: satsBought drains from reserveToken, bchIn adds to reserveOther
    const effectiveIn = (trade.bch * 9970n) / 10000n; // 0.3% fee
    const satsBought = (reserveToken * effectiveIn) / (reserveOther + effectiveIn);
    const tokensOut = satsBought / PRICE_PER_UNIT;
    const priceImpact = calculatePriceImpact(trade.bch, reserveToken, reserveOther, true);

    if (isHome) {
      reserveHome -= satsBought;
      reserveAway += trade.bch;
    } else {
      reserveAway -= satsBought;
      reserveHome += trade.bch;
    }

    prices = calculatePrices(reserveHome, reserveAway);

    printSubHeader(`${trade.user} buys ${trade.side}_WIN tokens`);
    console.log(`  BCH spent: ${formatSats(trade.bch)}`);
    console.log(`  Tokens received: ${tokensOut.toLocaleString()}`);
    console.log(`  Price impact: ${formatPercent(priceImpact)}`);
    console.log(`  New prices: HOME=${formatPercent(prices.priceHome)}, AWAY=${formatPercent(prices.priceAway)}`);
  }

  console.log('\nPool after Trading Phase 1:');
  console.log(`  HOME_WIN reserve: ${formatSats(reserveHome)}`);
  console.log(`  AWAY_WIN reserve: ${formatSats(reserveAway)}`);
  console.log(`  Lakers implied probability: ${formatPercent(prices.priceHome)}`);
  console.log(`  Warriors implied probability: ${formatPercent(prices.priceAway)}`);

  // =========================================================================
  // STEP 4: Halftime Score Reveal
  // =========================================================================

  printHeader('Step 4: Halftime - VRF Score Reveal');

  console.log('Oracle reveals the secret...');
  const halftimeReveal = await oracle.revealScores(matchId, 'halftime', SportType.BASKETBALL);

  // Only show full secret when DEBUG is explicitly enabled to avoid logging secrets in CI/shared environments
  const secretDisplay = process.env.DEBUG === '1'
    ? halftimeReveal.secret
    : `${halftimeReveal.secret.slice(0, 8)}...[redacted]`;
  console.log(`\nRevealed Secret: ${secretDisplay}`);
  console.log('');
  console.log('Generated Halftime Scores:');
  console.log(`  Lakers: ${halftimeReveal.generatedScores.homeScore1H}`);
  console.log(`  Warriors: ${halftimeReveal.generatedScores.awayScore1H}`);
  console.log('');

  // Verify the reveal
  const verification = await oracle.verifyReveal(matchId, halftimeReveal.secret);
  console.log(`Verification: ${verification.isValid ? 'VALID' : 'INVALID'}`);
  console.log('Anyone can verify: SHA256(SHA256(secret || matchId)) == commitment');

  // =========================================================================
  // STEP 5: Halftime Trading
  // =========================================================================

  printHeader('Step 5: Halftime Trading');

  const halftimeScore = `${halftimeReveal.generatedScores.homeScore1H}-${halftimeReveal.generatedScores.awayScore1H}`;
  const lakersLeading = halftimeReveal.generatedScores.homeScore1H > halftimeReveal.generatedScores.awayScore1H;

  console.log(`Halftime Score: Lakers ${halftimeScore} Warriors`);
  console.log(`${lakersLeading ? 'Lakers' : 'Warriors'} leading!`);
  console.log('');
  console.log('Market reacts to halftime score...');

  // Simulate market reaction (sats-denominated: satsBought drains from winning side's reserve)
  const reactTrade = 150_000_000n;
  const reactEffective = (reactTrade * 9970n) / 10000n;
  if (lakersLeading) {
    // More people buy Lakers: drain HOME reserve, add to AWAY reserve
    const satsBought = (reserveHome * reactEffective) / (reserveAway + reactEffective);
    reserveHome -= satsBought;
    reserveAway += reactTrade;
  } else {
    // More people buy Warriors: drain AWAY reserve, add to HOME reserve
    const satsBought = (reserveAway * reactEffective) / (reserveHome + reactEffective);
    reserveAway -= satsBought;
    reserveHome += reactTrade;
  }

  prices = calculatePrices(reserveHome, reserveAway);

  console.log('\nPool after Halftime Trading:');
  console.log(`  Lakers probability: ${formatPercent(prices.priceHome)}`);
  console.log(`  Warriors probability: ${formatPercent(prices.priceAway)}`);
  console.log(`  Lakers odds: ${(1 / prices.priceHome).toFixed(2)}x`);
  console.log(`  Warriors odds: ${(1 / prices.priceAway).toFixed(2)}x`);

  // =========================================================================
  // STEP 6: Final Score Reveal
  // =========================================================================

  printHeader('Step 6: Final Score - Game Ends');

  const finalReveal = await oracle.revealScores(matchId, 'final', SportType.BASKETBALL);

  console.log('Final Scores Revealed:');
  console.log(`  Lakers: ${finalReveal.generatedScores.homeScoreFinal}`);
  console.log(`  Warriors: ${finalReveal.generatedScores.awayScoreFinal}`);
  console.log('');

  const outcome = determineOutcome(
    finalReveal.generatedScores.homeScoreFinal,
    finalReveal.generatedScores.awayScoreFinal
  );

  if (outcome === 'HOME') {
    console.log('LAKERS WIN!');
  } else if (outcome === 'AWAY') {
    console.log('WARRIORS WIN!');
  } else {
    console.log('TIE GAME!');
  }

  // Full verification
  const fullVerification = await verifyMatchScores(
    finalReveal.secret,
    matchId,
    commitment.commitment,
    finalReveal.generatedScores,
    SportType.BASKETBALL
  );

  console.log(`\nFull Score Verification: ${fullVerification.valid ? 'PASSED' : 'FAILED'}`);

  // =========================================================================
  // STEP 7: Settlement
  // =========================================================================

  printHeader('Step 7: Settlement');

  // Simulate user positions
  const userPositions = [
    { user: 'Alice', homeTokens: 45_000n, awayTokens: 0n, avgCost: 11_000n },
    { user: 'Bob', homeTokens: 0n, awayTokens: 28_000n, avgCost: 10_700n },
    { user: 'Carol', homeTokens: 85_000n, awayTokens: 0n, avgCost: 11_500n },
    { user: 'Dave', homeTokens: 0n, awayTokens: 72_000n, avgCost: 11_100n },
    { user: 'Eve', homeTokens: 160_000n, awayTokens: 0n, avgCost: 12_200n },
  ];

  console.log('Settlement Results:');
  console.log('-'.repeat(60));

  for (const pos of userPositions) {
    const homeValue = calculatePayout(pos.homeTokens, outcome, 'HOME_WIN', PRICE_PER_UNIT);
    const awayValue = calculatePayout(pos.awayTokens, outcome, 'AWAY_WIN', PRICE_PER_UNIT);
    const totalValue = homeValue + awayValue;

    const homeCost = pos.homeTokens * pos.avgCost;
    const awayCost = pos.awayTokens * pos.avgCost;
    const totalCost = homeCost + awayCost;

    const pnl = totalValue - totalCost;
    const pnlPercent = totalCost > 0n ? Number(pnl * 100n / totalCost) : 0;

    console.log(`\n${pos.user}:`);
    if (pos.homeTokens > 0n) {
      console.log(`  HOME_WIN tokens: ${pos.homeTokens.toLocaleString()}`);
      console.log(`  Redemption: ${formatSats(homeValue)}`);
    }
    if (pos.awayTokens > 0n) {
      console.log(`  AWAY_WIN tokens: ${pos.awayTokens.toLocaleString()}`);
      console.log(`  Redemption: ${formatSats(awayValue)}`);
    }
    console.log(`  Total Payout: ${formatSats(totalValue)}`);
    console.log(`  P&L: ${pnl >= 0n ? '+' : ''}${formatSats(pnl)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%)`);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================

  printHeader('Demo Complete!');

  console.log('Key Takeaways:');
  console.log('');
  console.log('1. VRF Commitment Ensures Fairness:');
  console.log('   - Oracle commits to randomness BEFORE betting');
  console.log('   - Cannot manipulate outcome based on bet patterns');
  console.log('   - Anyone can verify the reveal matches commitment');
  console.log('');
  console.log('2. AMM Provides Continuous Liquidity:');
  console.log('   - No order book needed');
  console.log('   - Prices adjust automatically based on demand');
  console.log('   - Users can enter/exit positions anytime');
  console.log('');
  console.log('3. Halftime Trading Creates Engagement:');
  console.log('   - Scores revealed progressively');
  console.log('   - Market reacts to new information');
  console.log('   - Multiple trading opportunities');
  console.log('');
  console.log('4. Automatic Settlement:');
  console.log('   - Winner tokens redeem for full value');
  console.log('   - Loser tokens worth nothing');
  console.log('   - Draw splits value 50/50');
  console.log('');
  console.log('All on-chain. Trustless. Verifiable.');
}

// Run the demo
runDemo().catch(console.error);
