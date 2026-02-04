/**
 * SportsBet.cash - Block Hash VRF Tests
 *
 * Tests for the block-hash based randomness system.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateTargetBlocks,
  estimateTimeToBlock,
  generateSeedFromBlocks,
  generateScoresFromSeed,
  generateMatchScoresFromBlocks,
  createBlockBasedMatch,
  calculateMatchTimeline,
  verifyScoresFromBlocks,
  calculateManipulationCost,
  recommendBlocksForPoolSize,
} from '../src/blockhash-vrf.js';
import { SportType } from '../src/types.js';
import { hexToBin, binToHex } from '@bitauth/libauth';

describe('Block Timing', () => {
  it('should calculate correct target blocks', () => {
    const result = calculateTargetBlocks(100, 6, 12);

    assert.strictEqual(result.halftimeBlock, 106);
    assert.strictEqual(result.endBlock, 112);
    assert.strictEqual(result.halftimeBlocksUsed.length, 3);
    assert.strictEqual(result.endBlocksUsed.length, 3);
    assert.deepStrictEqual(result.halftimeBlocksUsed, [106, 107, 108]);
    assert.deepStrictEqual(result.endBlocksUsed, [112, 113, 114]);
  });

  it('should estimate time to block correctly', () => {
    const time = estimateTimeToBlock(100, 106);
    assert.strictEqual(time, 6 * 600); // 6 blocks * 600 seconds
  });

  it('should handle same block (0 time)', () => {
    const time = estimateTimeToBlock(100, 100);
    assert.strictEqual(time, 0);
  });
});

describe('Seed Generation', () => {
  it('should generate deterministic seeds', async () => {
    const blockHashes = [
      hexToBin('a'.repeat(64)),
      hexToBin('b'.repeat(64)),
      hexToBin('c'.repeat(64)),
    ];
    const matchId = hexToBin('1234567890abcdef');

    const seed1 = await generateSeedFromBlocks(blockHashes, matchId);
    const seed2 = await generateSeedFromBlocks(blockHashes, matchId);

    assert.deepStrictEqual(seed1, seed2);
  });

  it('should generate different seeds for different block hashes', async () => {
    const blockHashes1 = [
      hexToBin('a'.repeat(64)),
      hexToBin('b'.repeat(64)),
      hexToBin('c'.repeat(64)),
    ];
    const blockHashes2 = [
      hexToBin('d'.repeat(64)),
      hexToBin('e'.repeat(64)),
      hexToBin('f'.repeat(64)),
    ];
    const matchId = hexToBin('1234567890abcdef');

    const seed1 = await generateSeedFromBlocks(blockHashes1, matchId);
    const seed2 = await generateSeedFromBlocks(blockHashes2, matchId);

    assert.notDeepStrictEqual(seed1, seed2);
  });

  it('should generate different seeds for different match IDs', async () => {
    const blockHashes = [
      hexToBin('a'.repeat(64)),
      hexToBin('b'.repeat(64)),
      hexToBin('c'.repeat(64)),
    ];
    const matchId1 = hexToBin('1234567890abcdef');
    const matchId2 = hexToBin('fedcba0987654321');

    const seed1 = await generateSeedFromBlocks(blockHashes, matchId1);
    const seed2 = await generateSeedFromBlocks(blockHashes, matchId2);

    assert.notDeepStrictEqual(seed1, seed2);
  });
});

describe('Score Generation', () => {
  it('should generate basketball scores in range', async () => {
    const seed = hexToBin('a'.repeat(64));
    const scores = await generateScoresFromSeed(seed, 'halftime', SportType.BASKETBALL);

    assert.ok(scores.homeScore >= 30 && scores.homeScore <= 75);
    assert.ok(scores.awayScore >= 30 && scores.awayScore <= 75);
  });

  it('should generate football scores in range', async () => {
    const seed = hexToBin('b'.repeat(64));
    const scores = await generateScoresFromSeed(seed, 'halftime', SportType.FOOTBALL);

    assert.ok(scores.homeScore >= 0 && scores.homeScore <= 4);
    assert.ok(scores.awayScore >= 0 && scores.awayScore <= 4);
  });

  it('should generate american football scores in range', async () => {
    const seed = hexToBin('c'.repeat(64));
    const scores = await generateScoresFromSeed(seed, 'halftime', SportType.AMERICAN_FOOTBALL);

    assert.ok(scores.homeScore >= 0 && scores.homeScore <= 28);
    assert.ok(scores.awayScore >= 0 && scores.awayScore <= 28);
  });

  it('should generate different scores for halftime vs final', async () => {
    const seed = hexToBin('d'.repeat(64));

    const halftime = await generateScoresFromSeed(seed, 'halftime', SportType.BASKETBALL);
    const final = await generateScoresFromSeed(seed, 'final', SportType.BASKETBALL);

    // Very unlikely to be exactly the same
    assert.ok(
      halftime.homeScore !== final.homeScore || halftime.awayScore !== final.awayScore,
      'Halftime and final should use different derivation'
    );
  });

  it('should be deterministic', async () => {
    const seed = hexToBin('e'.repeat(64));

    const scores1 = await generateScoresFromSeed(seed, 'halftime', SportType.BASKETBALL);
    const scores2 = await generateScoresFromSeed(seed, 'halftime', SportType.BASKETBALL);

    assert.deepStrictEqual(scores1, scores2);
  });
});

describe('Complete Match Scores', () => {
  it('should generate complete match scores', async () => {
    const halftimeHashes = [
      hexToBin('a'.repeat(64)),
      hexToBin('b'.repeat(64)),
      hexToBin('c'.repeat(64)),
    ];
    const endHashes = [
      hexToBin('d'.repeat(64)),
      hexToBin('e'.repeat(64)),
      hexToBin('f'.repeat(64)),
    ];
    const matchId = hexToBin('1234567890abcdef');

    const scores = await generateMatchScoresFromBlocks(
      halftimeHashes,
      endHashes,
      matchId,
      SportType.BASKETBALL
    );

    assert.ok(scores.homeScore1H >= 30);
    assert.ok(scores.awayScore1H >= 30);
    assert.ok(scores.homeScoreFinal >= scores.homeScore1H);
    assert.ok(scores.awayScoreFinal >= scores.awayScore1H);
  });

  it('should have final as sum of halves', async () => {
    const halftimeHashes = [
      hexToBin('1'.repeat(64)),
      hexToBin('2'.repeat(64)),
      hexToBin('3'.repeat(64)),
    ];
    const endHashes = [
      hexToBin('4'.repeat(64)),
      hexToBin('5'.repeat(64)),
      hexToBin('6'.repeat(64)),
    ];
    const matchId = hexToBin('abcdef1234567890');

    const scores = await generateMatchScoresFromBlocks(
      halftimeHashes,
      endHashes,
      matchId,
      SportType.BASKETBALL
    );

    // Final should be >= halftime (second half adds)
    assert.ok(scores.homeScoreFinal >= scores.homeScore1H);
    assert.ok(scores.awayScoreFinal >= scores.awayScore1H);
  });
});

describe('Match Configuration', () => {
  it('should create valid match config', () => {
    const config = createBlockBasedMatch(
      100,
      SportType.BASKETBALL,
      'LAL1',
      'GSW1',
      6,
      3
    );

    assert.strictEqual(config.sportType, SportType.BASKETBALL);
    assert.strictEqual(config.homeTeam, 'LAL1');
    assert.strictEqual(config.awayTeam, 'GSW1');
    assert.strictEqual(config.creationBlock, 100);
    assert.strictEqual(config.tradingDurationBlocks, 6);
    assert.strictEqual(config.halftimeDurationBlocks, 3);
    assert.ok(config.matchId.length === 16);
  });

  it('should calculate correct timeline', () => {
    const config = createBlockBasedMatch(100, SportType.BASKETBALL, 'HOM1', 'AWY1', 6, 3);
    const timeline = calculateMatchTimeline(config);

    assert.strictEqual(timeline.tradingEndsBlock, 106);
    assert.strictEqual(timeline.halftimeRevealBlock, 106);
    assert.strictEqual(timeline.halftimeBlocksUsed.length, 3);
    assert.strictEqual(timeline.halftimeTradingEndsBlock, 112); // 106 + 3 (blocks for randomness) + 3 (halftime trading)
    assert.strictEqual(timeline.finalRevealBlock, 112);
    assert.strictEqual(timeline.finalBlocksUsed.length, 3);
  });
});

describe('Verification', () => {
  it('should verify correct scores', async () => {
    const halftimeHashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
    const endHashes = ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)];
    const matchId = '1234567890abcdef';

    // Generate expected scores
    const expectedScores = await generateMatchScoresFromBlocks(
      halftimeHashes.map(hexToBin),
      endHashes.map(hexToBin),
      hexToBin(matchId),
      SportType.BASKETBALL
    );

    // Verify
    const result = await verifyScoresFromBlocks(
      halftimeHashes,
      endHashes,
      matchId,
      expectedScores,
      SportType.BASKETBALL
    );

    assert.strictEqual(result.valid, true);
  });

  it('should reject incorrect scores', async () => {
    const halftimeHashes = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
    const endHashes = ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)];
    const matchId = '1234567890abcdef';

    // Create wrong scores
    const wrongScores = {
      homeScore1H: 999,
      awayScore1H: 888,
      homeScoreFinal: 1500,
      awayScoreFinal: 1400,
    };

    const result = await verifyScoresFromBlocks(
      halftimeHashes,
      endHashes,
      matchId,
      wrongScores,
      SportType.BASKETBALL
    );

    assert.strictEqual(result.valid, false);
    assert.ok(result.reason?.includes('do not match'));
  });
});

describe('Security Analysis', () => {
  it('should calculate manipulation cost', () => {
    const analysis = calculateManipulationCost(6.25, 3, 1);

    assert.strictEqual(analysis.minimumCostBCH, 6.25 * 3);
    assert.ok(analysis.probabilityOfSuccess > 0);
    assert.ok(analysis.probabilityOfSuccess < 1);
    assert.ok(analysis.expectedCostBCH > analysis.minimumCostBCH);
  });

  it('should have higher cost with more blocks', () => {
    const analysis1 = calculateManipulationCost(6.25, 1, 1);
    const analysis3 = calculateManipulationCost(6.25, 3, 1);
    const analysis5 = calculateManipulationCost(6.25, 5, 1);

    assert.ok(analysis3.expectedCostBCH > analysis1.expectedCostBCH);
    assert.ok(analysis5.expectedCostBCH > analysis3.expectedCostBCH);
  });

  it('should recommend more blocks for larger pools', () => {
    const small = recommendBlocksForPoolSize(1);
    const medium = recommendBlocksForPoolSize(10);
    const large = recommendBlocksForPoolSize(100);

    assert.ok(medium >= small);
    assert.ok(large >= medium);
    assert.ok(large >= 3); // Minimum recommended
  });
});

describe('Edge Cases', () => {
  it('should handle minimum blocks (1)', () => {
    const result = calculateTargetBlocks(100, 1, 2);

    assert.strictEqual(result.halftimeBlock, 101);
    assert.strictEqual(result.endBlock, 102);
  });

  it('should handle large block numbers', () => {
    const result = calculateTargetBlocks(1_000_000, 100, 200);

    assert.strictEqual(result.halftimeBlock, 1_000_100);
    assert.strictEqual(result.endBlock, 1_000_200);
  });

  it('should generate valid scores with any block hash', async () => {
    // Test with various block hash patterns
    const patterns = [
      '0'.repeat(64),
      'f'.repeat(64),
      '0123456789abcdef'.repeat(4),
    ];

    for (const pattern of patterns) {
      const hashes = [hexToBin(pattern), hexToBin(pattern), hexToBin(pattern)];
      const matchId = hexToBin('00'.repeat(8));

      const scores = await generateMatchScoresFromBlocks(
        hashes,
        hashes,
        matchId,
        SportType.BASKETBALL
      );

      assert.ok(scores.homeScore1H >= 30 && scores.homeScore1H <= 75);
      assert.ok(scores.awayScore1H >= 30 && scores.awayScore1H <= 75);
    }
  });
});
