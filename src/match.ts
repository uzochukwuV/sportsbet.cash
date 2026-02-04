/**
 * SportsBet.cash - Match Management Module
 *
 * Handles the complete lifecycle of prediction market matches:
 * - Match creation
 * - State transitions
 * - Halftime reveals
 * - Final settlement
 */

import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import { hexToBin, binToHex } from '@bitauth/libauth';
import { OracleManager, generateMatchId } from './oracle.js';
import { AmmPool, parsePoolState, calculatePrices } from './amm.js';
import type {
  Match,
  MatchConfig,
  MatchState,
  MatchScores,
  SportType,
  PoolState,
  Network,
  DeployedContracts,
  UTXO,
} from './types.js';

// =============================================================================
// MATCH MANAGER CLASS
// =============================================================================

/**
 * Manages the complete lifecycle of prediction market matches
 */
export class MatchManager {
  private provider: ElectrumNetworkProvider;
  private oracleManager: OracleManager;
  private contracts: DeployedContracts;
  private matches: Map<string, Match> = new Map();
  private network: Network;

  constructor(
    provider: ElectrumNetworkProvider,
    contracts: DeployedContracts,
    network: Network = 'chipnet'
  ) {
    this.provider = provider;
    this.contracts = contracts;
    this.oracleManager = new OracleManager();
    this.network = network;
  }

  // ===========================================================================
  // MATCH CREATION
  // ===========================================================================

  /**
   * Create a new prediction market match
   */
  async createMatch(
    config: Omit<MatchConfig, 'matchId'>,
    oracleSignature: SignatureTemplate
  ): Promise<Match> {
    // Generate unique match ID
    const matchId = generateMatchId();

    // Create oracle commitment
    const commitment = await this.oracleManager.createMatchCommitment(matchId);

    // Validate config
    this.validateConfig(config);

    const fullConfig: MatchConfig = {
      ...config,
      matchId,
    };

    // Create initial match state
    const match: Match = {
      config: fullConfig,
      state: MatchState.CREATED,
      scores: {
        homeScore1H: 0,
        awayScore1H: 0,
        homeScoreFinal: 0,
        awayScoreFinal: 0,
      },
      oracleCommitment: commitment.commitment,
      poolAddress: '', // Will be set after deployment
      homeTokenCategory: '', // Will be set after token creation
      awayTokenCategory: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // TODO: Deploy AMM pool contract with initial liquidity
    // This involves:
    // 1. Creating genesis transaction for token minting
    // 2. Deploying AMM pool with state NFT
    // 3. Minting HOME and AWAY fungible tokens

    this.matches.set(matchId, match);
    return match;
  }

  /**
   * Validate match configuration
   */
  private validateConfig(config: Omit<MatchConfig, 'matchId'>): void {
    const now = Math.floor(Date.now() / 1000);

    if (config.startTime <= now) {
      throw new Error('Start time must be in the future');
    }
    if (config.halftimeTime <= config.startTime) {
      throw new Error('Halftime time must be after start time');
    }
    if (config.endTime <= config.halftimeTime) {
      throw new Error('End time must be after halftime time');
    }
    if (config.homeTeam.length !== 4 || config.awayTeam.length !== 4) {
      throw new Error('Team codes must be 4 characters');
    }
    if (config.initialLiquidity <= 0n) {
      throw new Error('Initial liquidity must be positive');
    }
  }

  // ===========================================================================
  // STATE TRANSITIONS
  // ===========================================================================

  /**
   * Start trading phase (transition from CREATED to TRADING)
   */
  async startTrading(matchId: string): Promise<Match> {
    const match = this.getMatch(matchId);

    if (match.state !== MatchState.CREATED) {
      throw new Error(`Cannot start trading from state ${match.state}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < match.config.startTime) {
      throw new Error('Trading start time not reached');
    }

    // TODO: Call oracle contract startTrading function
    // This transitions the on-chain state

    match.state = MatchState.TRADING;
    match.updatedAt = Date.now();
    this.matches.set(matchId, match);

    return match;
  }

  /**
   * Reveal halftime scores
   */
  async revealHalftime(
    matchId: string,
    oracleSignature: SignatureTemplate
  ): Promise<Match> {
    const match = this.getMatch(matchId);

    if (match.state !== MatchState.TRADING) {
      throw new Error(`Cannot reveal halftime from state ${match.state}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < match.config.halftimeTime) {
      throw new Error('Halftime time not reached');
    }

    // Get scores from oracle
    const reveal = await this.oracleManager.revealScores(
      matchId,
      'halftime',
      match.config.sportType
    );

    // TODO: Call oracle contract revealHalftime function
    // Pass the secret to the contract for on-chain verification

    match.state = MatchState.HALFTIME_REVEALED;
    match.scores.homeScore1H = reveal.generatedScores.homeScore1H;
    match.scores.awayScore1H = reveal.generatedScores.awayScore1H;
    match.updatedAt = Date.now();
    this.matches.set(matchId, match);

    return match;
  }

  /**
   * Start halftime trading
   */
  async startHalftimeTrading(matchId: string): Promise<Match> {
    const match = this.getMatch(matchId);

    if (match.state !== MatchState.HALFTIME_REVEALED) {
      throw new Error(`Cannot start halftime trading from state ${match.state}`);
    }

    // TODO: Call oracle contract startHalftimeTrading function

    match.state = MatchState.HALFTIME_TRADING;
    match.updatedAt = Date.now();
    this.matches.set(matchId, match);

    return match;
  }

  /**
   * Reveal final scores
   */
  async revealFinal(
    matchId: string,
    oracleSignature: SignatureTemplate
  ): Promise<Match> {
    const match = this.getMatch(matchId);

    if (match.state !== MatchState.HALFTIME_TRADING) {
      throw new Error(`Cannot reveal final from state ${match.state}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now < match.config.endTime) {
      throw new Error('End time not reached');
    }

    // Get final scores from oracle
    const reveal = await this.oracleManager.revealScores(
      matchId,
      'final',
      match.config.sportType
    );

    // TODO: Call oracle contract revealFinal function

    match.state = MatchState.FINAL;
    match.scores = reveal.generatedScores;
    match.updatedAt = Date.now();
    this.matches.set(matchId, match);

    return match;
  }

  // ===========================================================================
  // MATCH QUERIES
  // ===========================================================================

  /**
   * Get match by ID
   */
  getMatch(matchId: string): Match {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Match ${matchId} not found`);
    }
    return match;
  }

  /**
   * Get all matches
   */
  getAllMatches(): Match[] {
    return Array.from(this.matches.values());
  }

  /**
   * Get matches by state
   */
  getMatchesByState(state: MatchState): Match[] {
    return Array.from(this.matches.values()).filter((m) => m.state === state);
  }

  /**
   * Get active matches (in trading states)
   */
  getActiveMatches(): Match[] {
    return Array.from(this.matches.values()).filter(
      (m) =>
        m.state === MatchState.TRADING ||
        m.state === MatchState.HALFTIME_TRADING
    );
  }

  /**
   * Get match outcome
   */
  getMatchOutcome(matchId: string): 'HOME' | 'AWAY' | 'DRAW' | null {
    const match = this.getMatch(matchId);

    if (match.state < MatchState.FINAL) {
      return null; // Not yet decided
    }

    const { homeScoreFinal, awayScoreFinal } = match.scores;

    if (homeScoreFinal > awayScoreFinal) {
      return 'HOME';
    } else if (awayScoreFinal > homeScoreFinal) {
      return 'AWAY';
    } else {
      return 'DRAW';
    }
  }

  // ===========================================================================
  // POOL INTERACTION
  // ===========================================================================

  /**
   * Get AMM pool for a match
   */
  async getPool(matchId: string): Promise<AmmPool> {
    const match = this.getMatch(matchId);

    if (!match.poolAddress) {
      throw new Error('Match pool not yet deployed');
    }

    // Load pool contract from address
    // TODO: Implement contract loading from compiled artifact
    throw new Error('Not implemented');
  }

  /**
   * Get current odds for a match
   */
  async getOdds(matchId: string): Promise<{
    homeOdds: number;
    awayOdds: number;
    impliedProbabilityHome: number;
    impliedProbabilityAway: number;
  }> {
    const pool = await this.getPool(matchId);
    const state = await pool.getPoolState();

    // Convert prices to decimal odds
    // Price of 0.50 = odds of 2.0 (1/0.50)
    const homeOdds = state.priceHome > 0 ? 1 / state.priceHome : Infinity;
    const awayOdds = state.priceAway > 0 ? 1 / state.priceAway : Infinity;

    return {
      homeOdds,
      awayOdds,
      impliedProbabilityHome: state.priceHome,
      impliedProbabilityAway: state.priceAway,
    };
  }

  // ===========================================================================
  // SETTLEMENT
  // ===========================================================================

  /**
   * Check if user can redeem tokens
   */
  canRedeem(matchId: string, outcomeType: 'HOME_WIN' | 'AWAY_WIN'): boolean {
    const match = this.getMatch(matchId);

    if (match.state !== MatchState.FINAL) {
      return false;
    }

    const outcome = this.getMatchOutcome(matchId);

    if (outcome === 'DRAW') {
      return true; // Both can redeem at 50%
    }

    return (
      (outcome === 'HOME' && outcomeType === 'HOME_WIN') ||
      (outcome === 'AWAY' && outcomeType === 'AWAY_WIN')
    );
  }

  /**
   * Calculate redemption value
   */
  calculateRedemptionValue(
    matchId: string,
    outcomeType: 'HOME_WIN' | 'AWAY_WIN',
    tokenAmount: bigint,
    pricePerUnit: bigint
  ): bigint {
    const outcome = this.getMatchOutcome(matchId);

    if (outcome === null) {
      throw new Error('Match not yet settled');
    }

    let multiplier: bigint;

    if (outcome === 'DRAW') {
      multiplier = 5000n; // 50%
    } else if (
      (outcome === 'HOME' && outcomeType === 'HOME_WIN') ||
      (outcome === 'AWAY' && outcomeType === 'AWAY_WIN')
    ) {
      multiplier = 10000n; // 100%
    } else {
      multiplier = 0n; // Losing tokens
    }

    return (tokenAmount * multiplier * pricePerUnit) / 10000n;
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  /**
   * Export match data for persistence
   */
  exportMatches(): string {
    const data = Array.from(this.matches.entries());
    return JSON.stringify(data, (_, v) =>
      typeof v === 'bigint' ? v.toString() + 'n' : v
    );
  }

  /**
   * Import match data from persistence
   */
  importMatches(json: string): void {
    const data = JSON.parse(json, (_, v) => {
      if (typeof v === 'string' && v.endsWith('n')) {
        return BigInt(v.slice(0, -1));
      }
      return v;
    });

    this.matches = new Map(data);
  }
}

// =============================================================================
// MATCH LIFECYCLE TIMELINE HELPERS
// =============================================================================

/**
 * Create a timeline for match display
 */
export function createMatchTimeline(match: Match): {
  phase: string;
  timeRemaining: number;
  nextPhase: string;
  progress: number;
}[] {
  const now = Math.floor(Date.now() / 1000);
  const { startTime, halftimeTime, endTime } = match.config;

  const phases = [
    {
      name: 'Pre-Trading',
      start: match.createdAt / 1000,
      end: startTime,
      next: 'Trading Opens',
    },
    {
      name: 'Trading Phase 1',
      start: startTime,
      end: halftimeTime,
      next: 'Halftime',
    },
    {
      name: 'Halftime',
      start: halftimeTime,
      end: halftimeTime + 300, // 5 min halftime
      next: 'Trading Phase 2',
    },
    {
      name: 'Trading Phase 2',
      start: halftimeTime + 300,
      end: endTime,
      next: 'Final',
    },
    {
      name: 'Settlement',
      start: endTime,
      end: endTime + 86400 * 30, // 30 day settlement window
      next: 'Closed',
    },
  ];

  return phases.map((phase) => ({
    phase: phase.name,
    timeRemaining: Math.max(0, phase.end - now),
    nextPhase: phase.next,
    progress: Math.min(
      100,
      Math.max(0, ((now - phase.start) / (phase.end - phase.start)) * 100)
    ),
  }));
}

/**
 * Format scores for display
 */
export function formatScores(
  scores: MatchScores,
  state: MatchState
): string {
  if (state < MatchState.HALFTIME_REVEALED) {
    return '-- : --';
  }

  if (state < MatchState.FINAL) {
    return `${scores.homeScore1H} : ${scores.awayScore1H} (1H)`;
  }

  return `${scores.homeScoreFinal} : ${scores.awayScoreFinal} (Final)`;
}

/**
 * Get sport name from type
 */
export function getSportName(sportType: SportType): string {
  switch (sportType) {
    case 0:
      return 'Basketball';
    case 1:
      return 'Football (Soccer)';
    case 2:
      return 'American Football';
    default:
      return 'Unknown';
  }
}

/**
 * Estimate match duration based on sport type
 */
export function estimateMatchDuration(sportType: SportType): number {
  switch (sportType) {
    case 0: // Basketball
      return 48 * 60; // 48 minutes
    case 1: // Football
      return 90 * 60; // 90 minutes
    case 2: // American Football
      return 60 * 60; // 60 minutes (game clock)
    default:
      return 60 * 60;
  }
}
