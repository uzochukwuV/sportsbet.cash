/**
 * SportsBet.cash - Block Hash VRF Demo
 *
 * This demo shows the IMPROVED approach using block hashes for randomness.
 * Key difference: NO ORACLE INTERACTION NEEDED for reveals!
 *
 * Flow:
 * 1. Match created, trading opens immediately
 * 2. After X blocks, ANYONE can reveal halftime scores
 * 3. Halftime trading
 * 4. After Y more blocks, ANYONE can reveal final scores
 * 5. Settlement - winners redeem
 */

import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  createBlockBasedMatch,
  calculateMatchTimeline,
  generateMatchScoresFromBlocks,
  verifyScoresFromBlocks,
  calculateManipulationCost,
  recommendBlocksForPoolSize,
  calculatePrices,
  calculateTokensOut,
  determineOutcome,
  calculatePayout,
} from '../src/index.js';
import { SportType } from '../src/types.js';

// =============================================================================
// DEMO HELPERS
// =============================================================================

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

function formatSats(sats: bigint): string {
  const bch = Number(sats) / 100_000_000;
  return `${bch.toFixed(8)} BCH`;
}

// Simulate block hashes (in reality, these come from the blockchain)
function simulateBlockHash(blockHeight: number): string {
  // Create deterministic "random" hash based on block height
  const seed = `block-${blockHeight}-${Math.sin(blockHeight) * 10000}`;
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += ((seed.charCodeAt(i % seed.length) + i * blockHeight) % 16).toString(16);
  }
  return hash;
}

// =============================================================================
// MAIN DEMO
// =============================================================================

async function runDemo() {
  printHeader('SportsBet.cash - Block Hash VRF Demo (Better UX!)');

  console.log('This demo shows the IMPROVED approach:');
  console.log('');
  console.log('OLD WAY (Commit-Reveal):');
  console.log('  - Oracle must commit secret before trading');
  console.log('  - Oracle must be online to reveal scores');
  console.log('  - If oracle goes offline, match is stuck!');
  console.log('  - Single point of failure');
  console.log('');
  console.log('NEW WAY (Block Hash VRF):');
  console.log('  - No oracle needed for reveals');
  console.log('  - Scores derived from future block hashes');
  console.log('  - ANYONE can trigger score reveal');
  console.log('  - Fully automatic, trustless');
  console.log('');

  // =========================================================================
  // STEP 1: Create Match
  // =========================================================================

  printHeader('Step 1: Create Match (No Oracle Commitment Needed!)');

  const currentBlock = 850000; // Simulated current block height

  const matchConfig = createBlockBasedMatch(
    currentBlock,
    SportType.BASKETBALL,
    'LAL1', // Lakers
    'GSW1', // Warriors
    6,      // Trading lasts 6 blocks (~1 hour)
    3       // Halftime trading lasts 3 blocks (~30 min)
  );

  const timeline = calculateMatchTimeline(matchConfig);

  console.log('Match Configuration:');
  console.log(`  Match ID: ${matchConfig.matchId}`);
  console.log(`  Sport: Basketball`);
  console.log(`  Teams: Lakers vs Warriors`);
  console.log(`  Created at block: ${matchConfig.creationBlock}`);
  console.log('');
  console.log('Timeline (based on block heights):');
  console.log(`  Trading Phase 1: blocks ${currentBlock} - ${timeline.tradingEndsBlock}`);
  console.log(`  Halftime reveal uses blocks: ${timeline.halftimeBlocksUsed.join(', ')}`);
  console.log(`  Halftime Trading: blocks ${timeline.halftimeRevealBlock + 3} - ${timeline.halftimeTradingEndsBlock}`);
  console.log(`  Final reveal uses blocks: ${timeline.finalBlocksUsed.join(', ')}`);
  console.log('');
  console.log('No oracle commitment needed! Randomness comes from future blocks.');

  // =========================================================================
  // STEP 2: Trading Phase 1
  // =========================================================================

  printHeader('Step 2: Trading Phase 1 (Pre-Match)');

  let reserveHome = 100_000n;
  let reserveAway = 100_000n;

  const trades = [
    { user: 'Alice', side: 'HOME', amount: 50_000_000n },
    { user: 'Bob', side: 'AWAY', amount: 30_000_000n },
    { user: 'Carol', side: 'HOME', amount: 100_000_000n },
  ];

  for (const trade of trades) {
    const isHome = trade.side === 'HOME';
    const tokensOut = calculateTokensOut(
      trade.amount / 10000n, // Convert to token units
      isHome ? reserveHome : reserveAway,
      isHome ? reserveAway : reserveHome
    );

    if (isHome) {
      reserveHome -= tokensOut;
      reserveAway += trade.amount / 10000n;
    } else {
      reserveAway -= tokensOut;
      reserveHome += trade.amount / 10000n;
    }

    const prices = calculatePrices(reserveHome, reserveAway);

    console.log(`${trade.user} buys ${trade.side}_WIN for ${formatSats(trade.amount)}`);
    console.log(`  → Received ${tokensOut.toLocaleString()} tokens`);
    console.log(`  → New prices: HOME=${(prices.priceHome * 100).toFixed(1)}%, AWAY=${(prices.priceAway * 100).toFixed(1)}%`);
  }

  // =========================================================================
  // STEP 3: Halftime Reveal (ANYONE CAN DO THIS!)
  // =========================================================================

  printHeader('Step 3: Halftime Reveal (No Oracle Needed!)');

  console.log('Waiting for halftime blocks to be mined...');
  console.log(`Target blocks: ${timeline.halftimeBlocksUsed.join(', ')}`);
  console.log('');

  // Simulate block hashes (in reality, fetch from blockchain)
  const halftimeBlockHashes = timeline.halftimeBlocksUsed.map(simulateBlockHash);

  console.log('Block hashes (now public on blockchain):');
  halftimeBlockHashes.forEach((hash, i) => {
    console.log(`  Block ${timeline.halftimeBlocksUsed[i]}: ${hash.slice(0, 16)}...`);
  });
  console.log('');

  // Generate halftime scores
  const halftimeHashes = halftimeBlockHashes.map(hexToBin);
  const matchIdBytes = hexToBin(matchConfig.matchId.padEnd(16, '0'));

  const partialScores = await generateMatchScoresFromBlocks(
    halftimeHashes,
    halftimeHashes, // Use same for demo
    matchIdBytes,
    SportType.BASKETBALL
  );

  console.log('ANYONE can now call revealHalftime() with these block hashes!');
  console.log('');
  console.log('Halftime Scores (derived from block hashes):');
  console.log(`  Lakers: ${partialScores.homeScore1H}`);
  console.log(`  Warriors: ${partialScores.awayScore1H}`);
  console.log('');
  console.log('Key point: No oracle interaction! The scores are DETERMINISTIC');
  console.log('given the block hashes. Anyone can compute and verify them.');

  // =========================================================================
  // STEP 4: Halftime Trading
  // =========================================================================

  printHeader('Step 4: Halftime Trading');

  const lakersLeading = partialScores.homeScore1H > partialScores.awayScore1H;
  console.log(`${lakersLeading ? 'Lakers' : 'Warriors'} leading at halftime!`);
  console.log('');

  // Simulate market reaction
  if (lakersLeading) {
    const reactAmount = 80_000_000n;
    const tokensOut = calculateTokensOut(reactAmount / 10000n, reserveHome, reserveAway);
    reserveHome -= tokensOut;
    reserveAway += reactAmount / 10000n;
    console.log('Market reacts: more bets on Lakers');
  } else {
    const reactAmount = 80_000_000n;
    const tokensOut = calculateTokensOut(reactAmount / 10000n, reserveAway, reserveHome);
    reserveAway -= tokensOut;
    reserveHome += reactAmount / 10000n;
    console.log('Market reacts: more bets on Warriors');
  }

  const halftimePrices = calculatePrices(reserveHome, reserveAway);
  console.log(`New prices: HOME=${(halftimePrices.priceHome * 100).toFixed(1)}%, AWAY=${(halftimePrices.priceAway * 100).toFixed(1)}%`);

  // =========================================================================
  // STEP 5: Final Reveal
  // =========================================================================

  printHeader('Step 5: Final Score Reveal (Still No Oracle!)');

  const endBlockHashes = timeline.finalBlocksUsed.map(simulateBlockHash);

  console.log('Final blocks mined:');
  endBlockHashes.forEach((hash, i) => {
    console.log(`  Block ${timeline.finalBlocksUsed[i]}: ${hash.slice(0, 16)}...`);
  });
  console.log('');

  const endHashes = endBlockHashes.map(hexToBin);
  const finalScores = await generateMatchScoresFromBlocks(
    halftimeHashes,
    endHashes,
    matchIdBytes,
    SportType.BASKETBALL
  );

  console.log('Final Scores:');
  console.log(`  Lakers: ${finalScores.homeScoreFinal}`);
  console.log(`  Warriors: ${finalScores.awayScoreFinal}`);
  console.log('');

  const outcome = determineOutcome(finalScores.homeScoreFinal, finalScores.awayScoreFinal);
  console.log(outcome === 'HOME' ? 'LAKERS WIN!' : outcome === 'AWAY' ? 'WARRIORS WIN!' : 'TIE GAME!');

  // =========================================================================
  // STEP 6: Verification
  // =========================================================================

  printHeader('Step 6: Anyone Can Verify (Trustless!)');

  const verification = await verifyScoresFromBlocks(
    halftimeBlockHashes,
    endBlockHashes,
    matchConfig.matchId.padEnd(16, '0'),
    finalScores,
    SportType.BASKETBALL
  );

  console.log(`Verification: ${verification.valid ? 'PASSED' : 'FAILED'}`);
  console.log('');
  console.log('Anyone can verify the scores are correctly derived from block hashes!');
  console.log('No trust in oracle needed - it\'s pure math.');

  // =========================================================================
  // STEP 7: Security Analysis
  // =========================================================================

  printHeader('Step 7: Security Analysis');

  console.log('Q: Can miners manipulate the outcome?');
  console.log('');

  const securityAnalysis = calculateManipulationCost(6.25, 3, 1);

  console.log('Analysis (assuming 1% of network hashrate):');
  console.log(`  Minimum cost: ${securityAnalysis.minimumCostBCH.toFixed(2)} BCH`);
  console.log(`  Probability of mining 3 consecutive blocks: ${(securityAnalysis.probabilityOfSuccess * 100).toFixed(6)}%`);
  console.log(`  Expected cost to manipulate: ${securityAnalysis.expectedCostBCH.toFixed(0)} BCH`);
  console.log('');

  const poolSizes = [1, 10, 100];
  console.log('Recommended blocks for different pool sizes:');
  poolSizes.forEach(size => {
    const recommended = recommendBlocksForPoolSize(size);
    console.log(`  ${size} BCH pool: use ${recommended} blocks`);
  });

  // =========================================================================
  // Summary
  // =========================================================================

  printHeader('Summary: Block Hash VRF Advantages');

  console.log('1. NO ORACLE INTERACTION for reveals');
  console.log('   - Oracle only needed for initial pool setup');
  console.log('   - Reveals are automatic and trustless');
  console.log('');
  console.log('2. ANYONE can trigger state transitions');
  console.log('   - Call endTradingPhase1() after trading period');
  console.log('   - Call revealHalftime(blockHash1, blockHash2, blockHash3)');
  console.log('   - No waiting for oracle to come online!');
  console.log('');
  console.log('3. Scores are DETERMINISTIC');
  console.log('   - Given the block hashes, scores are fixed');
  console.log('   - Anyone can verify the math');
  console.log('');
  console.log('4. Miner manipulation is EXPENSIVE');
  console.log('   - Must forfeit block rewards');
  console.log('   - Using multiple blocks makes it exponentially harder');
  console.log('');
  console.log('5. Fully ON-CHAIN verification');
  console.log('   - Contract verifies score derivation');
  console.log('   - No external dependencies');
  console.log('');

  printHeader('Contract Interface Comparison');

  console.log('OLD (Commit-Reveal):');
  console.log('  1. Oracle calls createCommitment(secret)');
  console.log('  2. Trading...');
  console.log('  3. Oracle calls revealHalftime(secret) ← ORACLE MUST BE ONLINE');
  console.log('  4. Trading...');
  console.log('  5. Oracle calls revealFinal(secret) ← ORACLE MUST BE ONLINE');
  console.log('');
  console.log('NEW (Block Hash):');
  console.log('  1. Create match (set target blocks)');
  console.log('  2. Trading...');
  console.log('  3. ANYONE calls revealHalftime(blockHash1, blockHash2, blockHash3)');
  console.log('  4. Trading...');
  console.log('  5. ANYONE calls revealFinal(blockHash1, blockHash2, blockHash3)');
  console.log('');
  console.log('Much better UX!');
}

// Run the demo
runDemo().catch(console.error);
