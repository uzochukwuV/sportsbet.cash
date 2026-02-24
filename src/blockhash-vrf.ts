/**
 * SportsBet.cash - Block Hash VRF Module
 *
 * Uses future block hashes as verifiable randomness source.
 * This eliminates the need for oracle interaction during reveals.
 *
 * Security Model:
 * - Randomness = hash(blockHash[targetBlock] || matchId)
 * - Miner manipulation requires forfeiting block reward (~6.25 BCH)
 * - Using multiple consecutive blocks increases manipulation cost
 *
 * UX Benefits:
 * - No oracle needed for reveals
 * - Automatic, predictable timing
 * - Anyone can trigger settlement
 * - No waiting for oracle to come online
 */

import {
  sha256,
  instantiateSha256,
  hexToBin,
  binToHex,
} from '@bitauth/libauth';
import type { MatchScores, SportType } from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

// Score ranges per sport type
const SCORE_RANGES: Record<SportType, { min: number; max: number }> = {
  0: { min: 30, max: 75 },   // Basketball: 30-75 per half
  1: { min: 0, max: 4 },     // Football (soccer): 0-4 per half
  2: { min: 0, max: 28 },    // American Football: 0-28 per half
};

// Number of blocks to use for randomness (more = harder to manipulate)
const BLOCKS_FOR_RANDOMNESS = 3;

// Average BCH block time in seconds
const BLOCK_TIME_SECONDS = 600; // 10 minutes

// =============================================================================
// BLOCK HASH VRF
// =============================================================================

let sha256Instance: Awaited<ReturnType<typeof instantiateSha256>> | null = null;

async function getSha256(): Promise<ReturnType<typeof instantiateSha256>> {
  if (!sha256Instance) {
    sha256Instance = await instantiateSha256();
  }
  return sha256Instance;
}

/**
 * Calculate the target block heights for a match
 *
 * @param currentBlock - Current block height
 * @param halftimeDelayBlocks - Blocks until halftime (e.g., 6 = ~1 hour)
 * @param endDelayBlocks - Blocks until end (e.g., 12 = ~2 hours)
 */
export function calculateTargetBlocks(
  currentBlock: number,
  halftimeDelayBlocks: number,
  endDelayBlocks: number
): {
  halftimeBlock: number;
  endBlock: number;
  halftimeBlocksUsed: number[];
  endBlocksUsed: number[];
} {
  const halftimeBlock = currentBlock + halftimeDelayBlocks;
  const endBlock = currentBlock + endDelayBlocks;

  // Use multiple consecutive blocks for stronger randomness
  const halftimeBlocksUsed = Array.from(
    { length: BLOCKS_FOR_RANDOMNESS },
    (_, i) => halftimeBlock + i
  );
  const endBlocksUsed = Array.from(
    { length: BLOCKS_FOR_RANDOMNESS },
    (_, i) => endBlock + i
  );

  return {
    halftimeBlock,
    endBlock,
    halftimeBlocksUsed,
    endBlocksUsed,
  };
}

/**
 * Estimate time until a target block
 */
export function estimateTimeToBlock(
  currentBlock: number,
  targetBlock: number
): number {
  const blocksRemaining = targetBlock - currentBlock;
  return blocksRemaining * BLOCK_TIME_SECONDS;
}

/**
 * Generate randomness seed from multiple block hashes
 *
 * @param blockHashes - Array of block hashes (32 bytes each)
 * @param matchId - Unique match identifier
 */
export async function generateSeedFromBlocks(
  blockHashes: Uint8Array[],
  matchId: Uint8Array
): Promise<Uint8Array> {
  const sha256 = await getSha256();

  // Concatenate all block hashes and match ID
  const totalLength = blockHashes.reduce((sum, h) => sum + h.length, 0) + matchId.length;
  const data = new Uint8Array(totalLength);

  let offset = 0;
  for (const hash of blockHashes) {
    data.set(hash, offset);
    offset += hash.length;
  }
  data.set(matchId, offset);

  // Double hash for additional security
  const firstHash = sha256.hash(data);
  return sha256.hash(firstHash);
}

/**
 * Generate scores from a seed (block hash derived)
 */
export async function generateScoresFromSeed(
  seed: Uint8Array,
  phase: 'halftime' | 'final',
  sportType: SportType
): Promise<{ homeScore: number; awayScore: number }> {
  const sha256 = await getSha256();

  // Create phase-specific derivation
  const marker = phase === 'halftime' ? 0x48 : 0x46; // 'H' or 'F'
  const data = new Uint8Array(seed.length + 1);
  data.set(seed);
  data[seed.length] = marker;

  const scoreHash = sha256.hash(data);

  // Get score range for sport type
  const range = SCORE_RANGES[sportType];
  const scoreRange = range.max - range.min + 1;

  // Extract scores from hash bytes
  const homeRaw = (scoreHash[0] << 8) | scoreHash[1];
  const awayRaw = (scoreHash[2] << 8) | scoreHash[3];

  const homeScore = range.min + (homeRaw % scoreRange);
  const awayScore = range.min + (awayRaw % scoreRange);

  return { homeScore, awayScore };
}

/**
 * Generate complete match scores from block hashes
 */
export async function generateMatchScoresFromBlocks(
  halftimeBlockHashes: Uint8Array[],
  endBlockHashes: Uint8Array[],
  matchId: Uint8Array,
  sportType: SportType
): Promise<MatchScores> {
  const halftimeSeed = await generateSeedFromBlocks(halftimeBlockHashes, matchId);
  const endSeed = await generateSeedFromBlocks(endBlockHashes, matchId);

  const halftime = await generateScoresFromSeed(halftimeSeed, 'halftime', sportType);
  const secondHalf = await generateScoresFromSeed(endSeed, 'final', sportType);

  return {
    homeScore1H: halftime.homeScore,
    awayScore1H: halftime.awayScore,
    homeScoreFinal: halftime.homeScore + secondHalf.homeScore,
    awayScoreFinal: halftime.awayScore + secondHalf.awayScore,
  };
}

// =============================================================================
// BLOCK HASH ORACLE (fetches block data)
// =============================================================================

export interface BlockInfo {
  height: number;
  hash: string;
  timestamp: number;
}

export interface BlockHashProvider {
  getCurrentBlock(): Promise<number>;
  getBlockHash(height: number): Promise<string>;
  getBlockInfo(height: number): Promise<BlockInfo>;
  waitForBlock(height: number): Promise<BlockInfo>;
}

/**
 * Create a block hash provider using Electrum
 */
export function createElectrumBlockProvider(
  electrumProvider: any // ElectrumNetworkProvider from cashscript
): BlockHashProvider {
  return {
    async getCurrentBlock(): Promise<number> {
      // Use electrum to get current block height
      const info = await electrumProvider.getBlockHeight();
      return info;
    },

    async getBlockHash(height: number): Promise<string> {
      const header = await electrumProvider.getBlockHeader(height);
      return header;
    },

    async getBlockInfo(height: number): Promise<BlockInfo> {
      const hash = await this.getBlockHash(height);
      return {
        height,
        hash,
        timestamp: Date.now(), // Would need additional call for actual timestamp
      };
    },

    async waitForBlock(height: number): Promise<BlockInfo> {
      let currentHeight = await this.getCurrentBlock();

      while (currentHeight < height) {
        // Wait for next block (poll every 30 seconds)
        await new Promise((resolve) => setTimeout(resolve, 30000));
        currentHeight = await this.getCurrentBlock();
      }

      return this.getBlockInfo(height);
    },
  };
}

/**
 * Fetch multiple block hashes for randomness
 */
export async function fetchBlockHashes(
  provider: BlockHashProvider,
  startBlock: number,
  count: number = BLOCKS_FOR_RANDOMNESS
): Promise<{ hashes: Uint8Array[]; blocks: BlockInfo[] }> {
  const blocks: BlockInfo[] = [];
  const hashes: Uint8Array[] = [];

  for (let i = 0; i < count; i++) {
    const blockInfo = await provider.getBlockInfo(startBlock + i);
    blocks.push(blockInfo);
    hashes.push(hexToBin(blockInfo.hash));
  }

  return { hashes, blocks };
}

// =============================================================================
// MATCH CONFIGURATION HELPER
// =============================================================================

/**
 * Configure a match with block-based timing
 */
export interface BlockBasedMatchConfig {
  matchId: string;
  sportType: SportType;
  homeTeam: string;
  awayTeam: string;
  creationBlock: number;
  tradingDurationBlocks: number;    // How many blocks trading phase 1 lasts
  halftimeDurationBlocks: number;   // How many blocks halftime trading lasts
  blocksForRandomness: number;      // How many blocks to use for randomness
}

export function createBlockBasedMatch(
  currentBlock: number,
  sportType: SportType,
  homeTeam: string,
  awayTeam: string,
  tradingDurationBlocks: number = 6,  // ~1 hour
  halftimeDurationBlocks: number = 3, // ~30 minutes
): BlockBasedMatchConfig {
  const matchId = generateMatchIdFromBlock(currentBlock);

  return {
    matchId,
    sportType,
    homeTeam,
    awayTeam,
    creationBlock: currentBlock,
    tradingDurationBlocks,
    halftimeDurationBlocks,
    blocksForRandomness: BLOCKS_FOR_RANDOMNESS,
  };
}

/**
 * Generate match ID incorporating block height for uniqueness
 */
function generateMatchIdFromBlock(blockHeight: number): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 0xffffffff);

  const buffer = new ArrayBuffer(16);
  const view = new DataView(buffer);
  view.setUint32(0, blockHeight, true);
  view.setBigUint64(4, BigInt(timestamp), true);
  view.setUint32(12, random, true);

  return binToHex(new Uint8Array(buffer).slice(0, 8));
}

/**
 * Calculate all timing for a match
 */
export function calculateMatchTimeline(config: BlockBasedMatchConfig): {
  tradingEndsBlock: number;
  halftimeRevealBlock: number;
  halftimeBlocksUsed: number[];
  halftimeTradingEndsBlock: number;
  finalRevealBlock: number;
  finalBlocksUsed: number[];
  estimatedHalftimeTime: Date;
  estimatedEndTime: Date;
} {
  const tradingEndsBlock = config.creationBlock + config.tradingDurationBlocks;
  const halftimeRevealBlock = tradingEndsBlock;
  const halftimeBlocksUsed = Array.from(
    { length: config.blocksForRandomness },
    (_, i) => halftimeRevealBlock + i
  );

  const halftimeTradingEndsBlock =
    halftimeRevealBlock + config.blocksForRandomness + config.halftimeDurationBlocks;
  const finalRevealBlock = halftimeTradingEndsBlock;
  const finalBlocksUsed = Array.from(
    { length: config.blocksForRandomness },
    (_, i) => finalRevealBlock + i
  );

  const now = Date.now();
  const blocksToHalftime = halftimeRevealBlock - config.creationBlock;
  const blocksToEnd = finalRevealBlock - config.creationBlock;

  return {
    tradingEndsBlock,
    halftimeRevealBlock,
    halftimeBlocksUsed,
    halftimeTradingEndsBlock,
    finalRevealBlock,
    finalBlocksUsed,
    estimatedHalftimeTime: new Date(now + blocksToHalftime * BLOCK_TIME_SECONDS * 1000),
    estimatedEndTime: new Date(now + blocksToEnd * BLOCK_TIME_SECONDS * 1000),
  };
}

// =============================================================================
// VERIFICATION
// =============================================================================

/**
 * Verify that scores were correctly derived from block hashes
 * Anyone can call this to verify the match was fair
 */
export async function verifyScoresFromBlocks(
  halftimeBlockHashes: string[],
  endBlockHashes: string[],
  matchId: string,
  claimedScores: MatchScores,
  sportType: SportType
): Promise<{ valid: boolean; reason?: string; expectedScores?: MatchScores }> {
  const halftimeHashes = halftimeBlockHashes.map(hexToBin);
  const endHashes = endBlockHashes.map(hexToBin);
  const matchIdBytes = hexToBin(matchId);

  const expectedScores = await generateMatchScoresFromBlocks(
    halftimeHashes,
    endHashes,
    matchIdBytes,
    sportType
  );

  if (
    claimedScores.homeScore1H !== expectedScores.homeScore1H ||
    claimedScores.awayScore1H !== expectedScores.awayScore1H ||
    claimedScores.homeScoreFinal !== expectedScores.homeScoreFinal ||
    claimedScores.awayScoreFinal !== expectedScores.awayScoreFinal
  ) {
    return {
      valid: false,
      reason: 'Scores do not match expected values from block hashes',
      expectedScores,
    };
  }

  return { valid: true, expectedScores };
}

// =============================================================================
// SECURITY ANALYSIS
// =============================================================================

/**
 * Calculate the cost for a miner to manipulate the outcome
 *
 * To manipulate, a miner must:
 * 1. Mine the target block
 * 2. Be willing to discard a valid block if outcome is unfavorable
 * 3. Potentially mine multiple blocks (if using multiple block hashes)
 */
export function calculateManipulationCost(
  blockRewardBCH: number = 6.25,
  blocksUsed: number = BLOCKS_FOR_RANDOMNESS,
  hashRatePercentage: number = 1 // % of network hash rate
): {
  minimumCostBCH: number;
  probabilityOfSuccess: number;
  expectedCostBCH: number;
} {
  // Cost of discarding one block
  const singleBlockCost = blockRewardBCH;

  // Probability of mining consecutive blocks
  const probSingleBlock = hashRatePercentage / 100;
  const probAllBlocks = Math.pow(probSingleBlock, blocksUsed);

  // Minimum cost (if they get lucky and mine all blocks)
  const minimumCostBCH = singleBlockCost * blocksUsed;

  // Expected cost (accounting for probability)
  const expectedCostBCH = minimumCostBCH / probAllBlocks;

  return {
    minimumCostBCH,
    probabilityOfSuccess: probAllBlocks,
    expectedCostBCH,
  };
}

/**
 * Recommend number of blocks based on pool size
 */
export function recommendBlocksForPoolSize(
  poolSizeBCH: number,
  blockRewardBCH: number = 6.25
): number {
  // Rule of thumb: manipulation cost should be at least 10x pool size
  const targetCost = poolSizeBCH * 10;

  // Each additional block roughly doubles manipulation difficulty
  let blocks = 1;
  let cost = blockRewardBCH;

  while (cost < targetCost && blocks < 10) {
    blocks++;
    cost *= 2; // Simplified: actual increase is exponential with hash rate
  }

  return Math.max(BLOCKS_FOR_RANDOMNESS, blocks);
}
