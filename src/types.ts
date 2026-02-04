/**
 * SportsBet.cash - TypeScript Types
 *
 * Type definitions for the on-chain sports betting AMM system.
 */

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Match lifecycle states
 */
export enum MatchState {
  CREATED = 0,           // Match created, waiting for trading to start
  TRADING = 1,           // First trading phase (pre-match betting)
  HALFTIME_REVEALED = 2, // Halftime scores revealed, brief pause
  HALFTIME_TRADING = 3,  // Second trading phase (halftime betting)
  FINAL = 4,             // Final scores revealed, ready for settlement
  CANCELLED = 5,         // Match cancelled, refunds available
}

/**
 * Sport types with different scoring characteristics
 */
export enum SportType {
  BASKETBALL = 0,        // High scoring (60-150 per half)
  FOOTBALL = 1,          // Low scoring (0-5 per half) - Soccer
  AMERICAN_FOOTBALL = 2, // Medium scoring (0-35 per half)
}

/**
 * Outcome token types
 */
export enum OutcomeType {
  HOME_WIN = 'HOME_WIN',
  AWAY_WIN = 'AWAY_WIN',
}

/**
 * Network configuration
 */
export type Network = 'mainnet' | 'chipnet';

// =============================================================================
// CORE TYPES
// =============================================================================

/**
 * Match configuration
 */
export interface MatchConfig {
  matchId: string;           // Unique 8-byte hex identifier
  sportType: SportType;
  homeTeam: string;          // 4-byte team code (e.g., 'LAL1')
  awayTeam: string;          // 4-byte team code (e.g., 'GSW1')
  startTime: number;         // Unix timestamp - trading starts
  halftimeTime: number;      // Unix timestamp - halftime reveal
  endTime: number;           // Unix timestamp - final reveal
  initialLiquidity: bigint;  // Initial tokens per side
}

/**
 * Match scores
 */
export interface MatchScores {
  homeScore1H: number;
  awayScore1H: number;
  homeScoreFinal: number;
  awayScoreFinal: number;
}

/**
 * Complete match state
 */
export interface Match {
  config: MatchConfig;
  state: MatchState;
  scores: MatchScores;
  oracleCommitment: string;  // 32-byte hex
  poolAddress: string;       // Contract address
  homeTokenCategory: string; // Token category hex
  awayTokenCategory: string; // Token category hex
  createdAt: number;
  updatedAt: number;
}

/**
 * AMM Pool reserves and pricing
 */
export interface PoolState {
  reserveHome: bigint;       // HOME tokens in pool
  reserveAway: bigint;       // AWAY tokens in pool
  k: bigint;                 // Constant product (reserveHome * reserveAway)
  priceHome: number;         // Current price of HOME token (0-1)
  priceAway: number;         // Current price of AWAY token (0-1)
  totalValueLocked: bigint;  // Total BCH in pool (satoshis)
}

/**
 * User position in a match
 */
export interface UserPosition {
  matchId: string;
  homeTokens: bigint;        // HOME tokens owned
  awayTokens: bigint;        // AWAY tokens owned
  averageCostHome: bigint;   // Avg purchase price (sats per token)
  averageCostAway: bigint;   // Avg purchase price (sats per token)
  unrealizedPnL: bigint;     // Current unrealized P&L
}

/**
 * Trade parameters
 */
export interface TradeParams {
  matchId: string;
  outcomeType: OutcomeType;
  amount: bigint;            // Amount of tokens to buy/sell
  maxSlippage: number;       // Maximum slippage tolerance (0.01 = 1%)
  isBuy: boolean;            // true = buy tokens, false = sell tokens
}

/**
 * Trade result
 */
export interface TradeResult {
  txId: string;
  tokensTraded: bigint;
  bchAmount: bigint;
  effectivePrice: number;
  fee: bigint;
  newPoolState: PoolState;
}

/**
 * Settlement result
 */
export interface SettlementResult {
  txId: string;
  tokensRedeemed: bigint;
  bchReceived: bigint;
  outcome: 'win' | 'lose' | 'draw';
}

// =============================================================================
// VRF / ORACLE TYPES
// =============================================================================

/**
 * Oracle commitment for VRF
 */
export interface OracleCommitment {
  matchId: string;
  commitment: string;        // hash256(secret || matchId)
  createdAt: number;
}

/**
 * Oracle reveal data
 */
export interface OracleReveal {
  matchId: string;
  secret: string;            // 32-byte hex secret
  phase: 'halftime' | 'final';
  generatedScores: MatchScores;
}

/**
 * VRF proof verification
 */
export interface VRFVerification {
  isValid: boolean;
  commitment: string;
  computedCommitment: string;
  matchId: string;
}

// =============================================================================
// CONTRACT TYPES
// =============================================================================

/**
 * Contract deployment parameters
 */
export interface ContractParams {
  oraclePkh: string;         // 20-byte hex public key hash
  treasuryPkh: string;       // 20-byte hex public key hash
  feeNumerator: number;      // Fee in basis points (30 = 0.3%)
  feeDenominator: number;    // Denominator (10000)
  pricePerUnit: bigint;      // Satoshis per token unit
  initialLiquidity: bigint;  // Initial tokens per side
}

/**
 * Contract addresses for a deployed system
 */
export interface DeployedContracts {
  oracle: string;
  matchFactory: string;
  settlement: string;
  ammPoolTemplate: string;   // Template for per-match pools
}

/**
 * UTXO representation
 */
export interface UTXO {
  txid: string;
  vout: number;
  satoshis: bigint;
  token?: {
    category: string;
    amount: bigint;
    nft?: {
      capability: 'none' | 'mutable' | 'minting';
      commitment: string;
    };
  };
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

/**
 * Match list response
 */
export interface MatchListResponse {
  matches: Match[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Price history point
 */
export interface PricePoint {
  timestamp: number;
  priceHome: number;
  priceAway: number;
  volume: bigint;
}

/**
 * Match statistics
 */
export interface MatchStats {
  matchId: string;
  totalVolume: bigint;
  totalTrades: number;
  uniqueTraders: number;
  priceHistory: PricePoint[];
  largestTrade: bigint;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

/**
 * Encoding helpers for commitment format
 */
export interface CommitmentEncoder {
  encodePoolState(state: MatchState, reserves: PoolState, scores: MatchScores, commitment: string): Uint8Array;
  decodePoolState(commitment: Uint8Array): { state: MatchState; reserves: PoolState; scores: MatchScores };
}

/**
 * Price calculation utilities
 */
export interface PriceCalculator {
  calculateBuyPrice(reserveToken: bigint, reserveOther: bigint, amount: bigint, fee: number): bigint;
  calculateSellPrice(reserveToken: bigint, reserveOther: bigint, amount: bigint, fee: number): bigint;
  calculatePriceImpact(reserveToken: bigint, reserveOther: bigint, amount: bigint): number;
  calculateTokensOut(bchIn: bigint, reserveToken: bigint, reserveOther: bigint, fee: number): bigint;
}

/**
 * Score generator for VRF
 */
export interface ScoreGenerator {
  generateFromSecret(secret: Uint8Array, matchId: Uint8Array, phase: 'halftime' | 'final', sportType: SportType): MatchScores;
  verifyCommitment(secret: Uint8Array, matchId: Uint8Array, commitment: Uint8Array): boolean;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * Match events for indexing/tracking
 */
export type MatchEvent =
  | { type: 'MATCH_CREATED'; match: Match }
  | { type: 'TRADING_STARTED'; matchId: string; timestamp: number }
  | { type: 'TRADE_EXECUTED'; matchId: string; trade: TradeResult }
  | { type: 'HALFTIME_REVEALED'; matchId: string; scores: MatchScores }
  | { type: 'HALFTIME_TRADING_STARTED'; matchId: string; timestamp: number }
  | { type: 'FINAL_REVEALED'; matchId: string; scores: MatchScores }
  | { type: 'SETTLEMENT'; matchId: string; settlement: SettlementResult }
  | { type: 'MATCH_CANCELLED'; matchId: string; reason: string };

/**
 * Event listener callback
 */
export type EventCallback = (event: MatchEvent) => void;
