/**
 * SportsBet.cash - On-Chain Sports Betting AMM for Bitcoin Cash
 *
 * A fully on-chain prediction market for simulated sports matches.
 * Uses VRF (commit-reveal) for verifiable random score generation
 * and AMM mechanics (CPMM) for outcome token trading.
 *
 * @module sportsbet
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type {
  // Enums
  MatchState,
  SportType,
  OutcomeType,
  Network,
  // Core types
  MatchConfig,
  MatchScores,
  Match,
  PoolState,
  UserPosition,
  TradeParams,
  TradeResult,
  SettlementResult,
  // Oracle types
  OracleCommitment,
  OracleReveal,
  VRFVerification,
  // Contract types
  ContractParams,
  DeployedContracts,
  UTXO,
  // API types
  ApiResponse,
  MatchListResponse,
  PricePoint,
  MatchStats,
  // Utility types
  CommitmentEncoder,
  PriceCalculator,
  ScoreGenerator,
  // Event types
  MatchEvent,
  EventCallback,
} from './types.js';

// Re-export enums as values
export { MatchState, SportType } from './types.js';

// =============================================================================
// AMM EXPORTS
// =============================================================================

export {
  // Price calculations
  calculatePrices,
  calculateTokensOut,
  calculateBchOut,
  calculateBchRequired,
  calculatePriceImpact,
  calculateMinTokensOut,
  // Pool state
  parsePoolState,
  encodePoolState,
  // AMM Pool class
  AmmPool,
} from './amm.js';

// =============================================================================
// ORACLE EXPORTS
// =============================================================================

export {
  // Core VRF functions
  generateSecret,
  createCommitment,
  verifyCommitment,
  generateScores,
  generateMatchScores,
  // Oracle Manager
  OracleManager,
  // Verification
  verifyMatchScores,
  previewScores,
  // Utilities
  generateMatchId,
  encodeMatchId,
} from './oracle.js';

// =============================================================================
// MATCH MANAGEMENT EXPORTS
// =============================================================================

export {
  // Match Manager
  MatchManager,
  // Utilities
  createMatchTimeline,
  formatScores,
  getSportName,
  estimateMatchDuration,
} from './match.js';

// =============================================================================
// SETTLEMENT EXPORTS
// =============================================================================

export {
  // Calculations
  determineOutcome,
  calculatePayout,
  isRedeemable,
  // Settlement Manager
  SettlementManager,
  // Statistics
  calculateSettlementStats,
  calculatePnL,
  // Refunds
  calculateCancelledRefund,
  processRefund,
} from './settlement.js';

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

import { ElectrumNetworkProvider } from 'cashscript';
import { MatchManager } from './match.js';
import { OracleManager } from './oracle.js';
import { SettlementManager } from './settlement.js';
import type { Network, DeployedContracts } from './types.js';

/**
 * Create a complete SportsBet.cash client
 */
export function createSportsBetClient(
  network: Network = 'chipnet',
  contracts?: DeployedContracts
): {
  provider: ElectrumNetworkProvider;
  matchManager: MatchManager;
  oracleManager: OracleManager;
  settlementManager: SettlementManager;
} {
  const provider = new ElectrumNetworkProvider(network);

  const defaultContracts: DeployedContracts = contracts || {
    oracle: '',
    matchFactory: '',
    settlement: '',
    ammPoolTemplate: '',
  };

  const matchManager = new MatchManager(provider, defaultContracts, network);
  const oracleManager = new OracleManager();
  const settlementManager = new SettlementManager(provider, network);

  return {
    provider,
    matchManager,
    oracleManager,
    settlementManager,
  };
}

/**
 * Quick start for testing/demo
 */
export async function quickStart(network: Network = 'chipnet') {
  console.log('SportsBet.cash - On-Chain Sports Betting AMM');
  console.log('============================================');
  console.log(`Network: ${network}`);
  console.log('');
  console.log('Features:');
  console.log('  - AMM-based prediction markets (like Polymarket)');
  console.log('  - VRF commit-reveal for verifiable randomness');
  console.log('  - Halftime trading with progressive score reveals');
  console.log('  - Multiple sport types (basketball, football, etc.)');
  console.log('');
  console.log('Quick Example:');
  console.log('');
  console.log('  import { createSportsBetClient, SportType } from "sportsbet";');
  console.log('');
  console.log('  const client = createSportsBetClient("chipnet");');
  console.log('');
  console.log('  // Create a match');
  console.log('  const match = await client.matchManager.createMatch({');
  console.log('    sportType: SportType.BASKETBALL,');
  console.log('    homeTeam: "LAL1",');
  console.log('    awayTeam: "GSW1",');
  console.log('    startTime: Math.floor(Date.now() / 1000) + 3600,');
  console.log('    halftimeTime: Math.floor(Date.now() / 1000) + 5400,');
  console.log('    endTime: Math.floor(Date.now() / 1000) + 7200,');
  console.log('    initialLiquidity: 1000000n');
  console.log('  });');
  console.log('');

  return createSportsBetClient(network);
}

// =============================================================================
// VERSION INFO
// =============================================================================

export const VERSION = '0.1.0';
export const PROTOCOL_VERSION = 1;
