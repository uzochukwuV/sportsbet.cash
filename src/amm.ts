/**
 * SportsBet.cash - AMM (Automated Market Maker) Module
 *
 * Implements Constant Product Market Maker (CPMM) logic for outcome token trading.
 * Formula: x * y = k
 */

import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
} from 'cashscript';
import {
  hexToBin,
  binToHex,
  sha256,
  instantiateSha256,
} from '@bitauth/libauth';
import type {
  PoolState,
  TradeParams,
  TradeResult,
  OutcomeType,
  UTXO,
  Network,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const FEE_NUMERATOR = 30n;        // 0.3% fee
const FEE_DENOMINATOR = 10000n;
const DUST_LIMIT = 546n;
const TX_FEE = 1000n;

// =============================================================================
// PRICE CALCULATIONS
// =============================================================================

/**
 * Calculate current prices from pool reserves
 */
export function calculatePrices(reserveHome: bigint, reserveAway: bigint): { priceHome: number; priceAway: number } {
  const total = reserveHome + reserveAway;
  if (total === 0n) {
    return { priceHome: 0.5, priceAway: 0.5 };
  }

  const priceHome = Number(reserveAway) / Number(total);
  const priceAway = Number(reserveHome) / Number(total);

  return { priceHome, priceAway };
}

/**
 * Calculate tokens received when buying with BCH
 *
 * Using CPMM formula:
 * tokensOut = (reserve * effectiveIn) / (otherReserve + effectiveIn)
 */
export function calculateTokensOut(
  bchIn: bigint,
  reserveToken: bigint,
  reserveOther: bigint,
  feeNumerator: bigint = FEE_NUMERATOR,
  feeDenominator: bigint = FEE_DENOMINATOR
): bigint {
  // Apply fee
  const effectiveIn = (bchIn * (feeDenominator - feeNumerator)) / feeDenominator;

  // CPMM calculation
  const tokensOut = (reserveToken * effectiveIn) / (reserveOther + effectiveIn);

  return tokensOut;
}

/**
 * Calculate BCH received when selling tokens
 */
export function calculateBchOut(
  tokensIn: bigint,
  reserveToken: bigint,
  reserveOther: bigint,
  feeNumerator: bigint = FEE_NUMERATOR,
  feeDenominator: bigint = FEE_DENOMINATOR
): bigint {
  // Apply fee
  const effectiveIn = (tokensIn * (feeDenominator - feeNumerator)) / feeDenominator;

  // CPMM calculation
  const bchOut = (reserveOther * effectiveIn) / (reserveToken + effectiveIn);

  return bchOut;
}

/**
 * Calculate BCH required to buy a specific amount of tokens
 */
export function calculateBchRequired(
  tokensWanted: bigint,
  reserveToken: bigint,
  reserveOther: bigint,
  feeNumerator: bigint = FEE_NUMERATOR,
  feeDenominator: bigint = FEE_DENOMINATOR
): bigint {
  // Inverse of tokensOut formula
  // tokensOut = (reserveToken * effectiveIn) / (reserveOther + effectiveIn)
  // Solving for effectiveIn:
  // effectiveIn = (tokensOut * reserveOther) / (reserveToken - tokensOut)

  if (tokensWanted >= reserveToken) {
    throw new Error('Cannot buy more tokens than in reserve');
  }

  const effectiveIn = (tokensWanted * reserveOther) / (reserveToken - tokensWanted);

  // Reverse fee calculation
  const bchRequired = (effectiveIn * feeDenominator) / (feeDenominator - feeNumerator);

  return bchRequired + 1n; // Add 1 sat for rounding
}

/**
 * Calculate price impact of a trade
 */
export function calculatePriceImpact(
  amount: bigint,
  reserveToken: bigint,
  reserveOther: bigint,
  isBuy: boolean
): number {
  const { priceHome: priceBefore } = calculatePrices(reserveToken, reserveOther);

  let newReserveToken: bigint;
  let newReserveOther: bigint;

  if (isBuy) {
    const tokensOut = calculateTokensOut(amount, reserveToken, reserveOther);
    newReserveToken = reserveToken - tokensOut;
    newReserveOther = reserveOther + amount;
  } else {
    const bchOut = calculateBchOut(amount, reserveToken, reserveOther);
    newReserveToken = reserveToken + amount;
    newReserveOther = reserveOther - bchOut;
  }

  const { priceHome: priceAfter } = calculatePrices(newReserveToken, newReserveOther);

  return Math.abs(priceAfter - priceBefore) / priceBefore;
}

/**
 * Calculate minimum tokens out with slippage protection
 */
export function calculateMinTokensOut(
  expectedTokens: bigint,
  maxSlippage: number
): bigint {
  const slippageMultiplier = 1 - maxSlippage;
  return BigInt(Math.floor(Number(expectedTokens) * slippageMultiplier));
}

// =============================================================================
// POOL STATE MANAGEMENT
// =============================================================================

/**
 * Parse pool state from NFT commitment bytes
 */
export function parsePoolState(commitment: Uint8Array): PoolState {
  // Format:
  // [0]: state (1 byte)
  // [1-8]: reserveHome (8 bytes, little-endian)
  // [9-16]: reserveAway (8 bytes, little-endian)
  // ... rest is oracle/match data

  const reserveHomeBytes = commitment.slice(1, 9);
  const reserveAwayBytes = commitment.slice(9, 17);

  const reserveHome = bytesToBigInt(reserveHomeBytes);
  const reserveAway = bytesToBigInt(reserveAwayBytes);

  const k = reserveHome * reserveAway;
  const { priceHome, priceAway } = calculatePrices(reserveHome, reserveAway);

  // Estimate TVL (this is simplified - actual TVL depends on pool BCH balance)
  const totalValueLocked = reserveHome + reserveAway; // In token units

  return {
    reserveHome,
    reserveAway,
    k,
    priceHome,
    priceAway,
    totalValueLocked,
  };
}

/**
 * Encode pool state to NFT commitment bytes
 */
export function encodePoolState(
  state: number,
  reserveHome: bigint,
  reserveAway: bigint,
  existingData: Uint8Array
): Uint8Array {
  const result = new Uint8Array(existingData.length);

  // State byte
  result[0] = state;

  // Reserve Home (8 bytes, little-endian)
  const homeBytes = bigIntToBytes(reserveHome, 8);
  result.set(homeBytes, 1);

  // Reserve Away (8 bytes, little-endian)
  const awayBytes = bigIntToBytes(reserveAway, 8);
  result.set(awayBytes, 9);

  // Copy remaining data (oracle commitment, scores, etc.)
  result.set(existingData.slice(17), 17);

  return result;
}

// =============================================================================
// AMM CONTRACT INTERACTION
// =============================================================================

/**
 * AMM Pool client for interacting with prediction market pools
 */
export class AmmPool {
  private contract: Contract;
  private provider: ElectrumNetworkProvider;
  private homeTokenCategory: string;
  private awayTokenCategory: string;

  constructor(
    contract: Contract,
    provider: ElectrumNetworkProvider,
    homeTokenCategory: string,
    awayTokenCategory: string
  ) {
    this.contract = contract;
    this.provider = provider;
    this.homeTokenCategory = homeTokenCategory;
    this.awayTokenCategory = awayTokenCategory;
  }

  /**
   * Get current pool state
   */
  async getPoolState(): Promise<PoolState> {
    const utxos = await this.contract.getUtxos();
    const poolUtxo = utxos.find((u) => u.token?.nft);

    if (!poolUtxo || !poolUtxo.token?.nft?.commitment) {
      throw new Error('Pool state NFT not found');
    }

    const commitment = hexToBin(poolUtxo.token.nft.commitment);
    return parsePoolState(commitment);
  }

  /**
   * Calculate quote for buying tokens
   */
  async quoteBuy(
    outcomeType: OutcomeType,
    bchAmount: bigint
  ): Promise<{ tokensOut: bigint; effectivePrice: number; priceImpact: number }> {
    const state = await this.getPoolState();

    const isHome = outcomeType === 'HOME_WIN';
    const reserveToken = isHome ? state.reserveHome : state.reserveAway;
    const reserveOther = isHome ? state.reserveAway : state.reserveHome;

    const tokensOut = calculateTokensOut(bchAmount, reserveToken, reserveOther);
    const effectivePrice = Number(bchAmount) / Number(tokensOut);
    const priceImpact = calculatePriceImpact(bchAmount, reserveToken, reserveOther, true);

    return { tokensOut, effectivePrice, priceImpact };
  }

  /**
   * Calculate quote for selling tokens
   */
  async quoteSell(
    outcomeType: OutcomeType,
    tokenAmount: bigint
  ): Promise<{ bchOut: bigint; effectivePrice: number; priceImpact: number }> {
    const state = await this.getPoolState();

    const isHome = outcomeType === 'HOME_WIN';
    const reserveToken = isHome ? state.reserveHome : state.reserveAway;
    const reserveOther = isHome ? state.reserveAway : state.reserveHome;

    const bchOut = calculateBchOut(tokenAmount, reserveToken, reserveOther);
    const effectivePrice = Number(bchOut) / Number(tokenAmount);
    const priceImpact = calculatePriceImpact(tokenAmount, reserveToken, reserveOther, false);

    return { bchOut, effectivePrice, priceImpact };
  }

  /**
   * Execute a buy trade
   */
  async buyTokens(
    params: TradeParams,
    userUtxos: UTXO[],
    userAddress: string,
    signatureTemplate: SignatureTemplate
  ): Promise<TradeResult> {
    const state = await this.getPoolState();
    const isHome = params.outcomeType === 'HOME_WIN';

    // Calculate expected output
    const { tokensOut, effectivePrice, priceImpact } = await this.quoteBuy(
      params.outcomeType,
      params.amount
    );

    // Slippage check
    if (priceImpact > params.maxSlippage) {
      throw new Error(`Price impact ${priceImpact} exceeds max slippage ${params.maxSlippage}`);
    }

    const minTokensOut = calculateMinTokensOut(tokensOut, params.maxSlippage);

    // Build transaction
    // Input 0: Pool UTXO
    // Input 1: User BCH
    // Output 0: Updated pool
    // Output 1: User receives tokens
    // Output 2: User change

    const poolUtxos = await this.contract.getUtxos();
    const poolUtxo = poolUtxos.find((u) => u.token?.nft);

    if (!poolUtxo) {
      throw new Error('Pool UTXO not found');
    }

    // Find user UTXO with enough BCH
    const userUtxo = userUtxos.find((u) => u.satoshis >= params.amount + TX_FEE);
    if (!userUtxo) {
      throw new Error('Insufficient BCH in user UTXOs');
    }

    // Call contract function
    const tx = this.contract.functions
      .buyTokens(isHome, minTokensOut)
      .from(poolUtxo)
      .fromP2PKH(userUtxo, signatureTemplate);

    // Calculate new reserves
    const reserveToken = isHome ? state.reserveHome : state.reserveAway;
    const reserveOther = isHome ? state.reserveAway : state.reserveHome;
    const newReserveToken = reserveToken - tokensOut;
    const newReserveOther = reserveOther + params.amount;

    const newPoolState: PoolState = {
      reserveHome: isHome ? newReserveToken : newReserveOther,
      reserveAway: isHome ? newReserveOther : newReserveToken,
      k: newReserveToken * newReserveOther,
      ...calculatePrices(
        isHome ? newReserveToken : newReserveOther,
        isHome ? newReserveOther : newReserveToken
      ),
      totalValueLocked: state.totalValueLocked,
    };

    // Send transaction
    const txResult = await tx.send();

    const fee = (params.amount * FEE_NUMERATOR) / FEE_DENOMINATOR;

    return {
      txId: txResult.txid,
      tokensTraded: tokensOut,
      bchAmount: params.amount,
      effectivePrice,
      fee,
      newPoolState,
    };
  }

  /**
   * Execute a sell trade
   */
  async sellTokens(
    params: TradeParams,
    userTokenUtxo: UTXO,
    userAddress: string,
    signatureTemplate: SignatureTemplate
  ): Promise<TradeResult> {
    const state = await this.getPoolState();
    const isHome = params.outcomeType === 'HOME_WIN';

    // Calculate expected output
    const { bchOut, effectivePrice, priceImpact } = await this.quoteSell(
      params.outcomeType,
      params.amount
    );

    if (priceImpact > params.maxSlippage) {
      throw new Error(`Price impact ${priceImpact} exceeds max slippage ${params.maxSlippage}`);
    }

    const minBchOut = BigInt(Math.floor(Number(bchOut) * (1 - params.maxSlippage)));

    const poolUtxos = await this.contract.getUtxos();
    const poolUtxo = poolUtxos.find((u) => u.token?.nft);

    if (!poolUtxo) {
      throw new Error('Pool UTXO not found');
    }

    // Verify user has correct token type
    const expectedCategory = isHome ? this.homeTokenCategory : this.awayTokenCategory;
    if (userTokenUtxo.token?.category !== expectedCategory) {
      throw new Error('Invalid token category');
    }

    const tx = this.contract.functions
      .sellTokens(isHome, minBchOut)
      .from(poolUtxo)
      .fromP2PKH(userTokenUtxo, signatureTemplate);

    const txResult = await tx.send();

    // Calculate new state
    const reserveToken = isHome ? state.reserveHome : state.reserveAway;
    const reserveOther = isHome ? state.reserveAway : state.reserveHome;
    const newReserveToken = reserveToken + params.amount;
    const newReserveOther = reserveOther - bchOut;

    const newPoolState: PoolState = {
      reserveHome: isHome ? newReserveToken : newReserveOther,
      reserveAway: isHome ? newReserveOther : newReserveToken,
      k: newReserveToken * newReserveOther,
      ...calculatePrices(
        isHome ? newReserveToken : newReserveOther,
        isHome ? newReserveOther : newReserveToken
      ),
      totalValueLocked: state.totalValueLocked,
    };

    const fee = (params.amount * FEE_NUMERATOR) / FEE_DENOMINATOR;

    return {
      txId: txResult.txid,
      tokensTraded: params.amount,
      bchAmount: bchOut,
      effectivePrice,
      fee,
      newPoolState,
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert bytes to BigInt (little-endian)
 */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Convert BigInt to bytes (little-endian)
 */
function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}
