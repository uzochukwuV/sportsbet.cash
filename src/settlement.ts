/**
 * SportsBet.cash - Settlement Module
 *
 * Handles the redemption of winning outcome tokens for BCH.
 * After a match concludes, token holders can redeem their positions.
 */

import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
} from 'cashscript';
import { hexToBin, binToHex } from '@bitauth/libauth';
import type {
  Match,
  MatchState,
  SettlementResult,
  UTXO,
  Network,
} from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PRICE_PER_UNIT = 10000n; // 10,000 sats = 0.0001 BCH per token unit
const DUST_LIMIT = 546n;
const TX_FEE = 1000n;

// =============================================================================
// SETTLEMENT CALCULATIONS
// =============================================================================

/**
 * Determine the outcome of a match based on final scores
 */
export function determineOutcome(
  homeScoreFinal: number,
  awayScoreFinal: number
): 'HOME' | 'AWAY' | 'DRAW' {
  if (homeScoreFinal > awayScoreFinal) {
    return 'HOME';
  } else if (awayScoreFinal > homeScoreFinal) {
    return 'AWAY';
  } else {
    return 'DRAW';
  }
}

/**
 * Calculate payout for token redemption
 */
export function calculatePayout(
  tokenAmount: bigint,
  outcome: 'HOME' | 'AWAY' | 'DRAW',
  tokenType: 'HOME_WIN' | 'AWAY_WIN',
  pricePerUnit: bigint = DEFAULT_PRICE_PER_UNIT
): bigint {
  // Determine payout multiplier (in basis points)
  let multiplier: bigint;

  if (outcome === 'DRAW') {
    // Draw: both tokens worth 50%
    multiplier = 5000n;
  } else if (
    (outcome === 'HOME' && tokenType === 'HOME_WIN') ||
    (outcome === 'AWAY' && tokenType === 'AWAY_WIN')
  ) {
    // Winner: 100%
    multiplier = 10000n;
  } else {
    // Loser: 0%
    multiplier = 0n;
  }

  // Calculate payout
  const payout = (tokenAmount * multiplier * pricePerUnit) / 10000n;

  return payout;
}

/**
 * Check if tokens are redeemable
 */
export function isRedeemable(
  outcome: 'HOME' | 'AWAY' | 'DRAW',
  tokenType: 'HOME_WIN' | 'AWAY_WIN'
): boolean {
  if (outcome === 'DRAW') {
    return true;
  }

  return (
    (outcome === 'HOME' && tokenType === 'HOME_WIN') ||
    (outcome === 'AWAY' && tokenType === 'AWAY_WIN')
  );
}

// =============================================================================
// SETTLEMENT MANAGER CLASS
// =============================================================================

/**
 * Manages settlement and redemption of outcome tokens
 */
export class SettlementManager {
  private provider: ElectrumNetworkProvider;
  private settlementContract: Contract | null = null;
  private pricePerUnit: bigint;
  private network: Network;

  constructor(
    provider: ElectrumNetworkProvider,
    network: Network = 'chipnet',
    pricePerUnit: bigint = DEFAULT_PRICE_PER_UNIT
  ) {
    this.provider = provider;
    this.network = network;
    this.pricePerUnit = pricePerUnit;
  }

  /**
   * Initialize with settlement contract
   */
  setSettlementContract(contract: Contract): void {
    this.settlementContract = contract;
  }

  /**
   * Get user's redeemable positions for a match
   */
  async getRedeemablePositions(
    match: Match,
    userTokenUtxos: UTXO[]
  ): Promise<{
    homeTokens: bigint;
    awayTokens: bigint;
    homeValue: bigint;
    awayValue: bigint;
    totalValue: bigint;
  }> {
    if (match.state !== MatchState.FINAL) {
      return {
        homeTokens: 0n,
        awayTokens: 0n,
        homeValue: 0n,
        awayValue: 0n,
        totalValue: 0n,
      };
    }

    const outcome = determineOutcome(
      match.scores.homeScoreFinal,
      match.scores.awayScoreFinal
    );

    // Filter user's tokens for this match
    const homeTokens = userTokenUtxos
      .filter((u) => u.token?.category === match.homeTokenCategory)
      .reduce((sum, u) => sum + (u.token?.amount || 0n), 0n);

    const awayTokens = userTokenUtxos
      .filter((u) => u.token?.category === match.awayTokenCategory)
      .reduce((sum, u) => sum + (u.token?.amount || 0n), 0n);

    // Calculate values
    const homeValue = calculatePayout(homeTokens, outcome, 'HOME_WIN', this.pricePerUnit);
    const awayValue = calculatePayout(awayTokens, outcome, 'AWAY_WIN', this.pricePerUnit);

    return {
      homeTokens,
      awayTokens,
      homeValue,
      awayValue,
      totalValue: homeValue + awayValue,
    };
  }

  /**
   * Redeem winning tokens for BCH
   */
  async redeemTokens(
    match: Match,
    tokenUtxo: UTXO,
    userAddress: string,
    signatureTemplate: SignatureTemplate
  ): Promise<SettlementResult> {
    if (!this.settlementContract) {
      throw new Error('Settlement contract not initialized');
    }

    if (match.state !== MatchState.FINAL) {
      throw new Error('Match not yet settled');
    }

    // Determine token type
    const tokenType: 'HOME_WIN' | 'AWAY_WIN' =
      tokenUtxo.token?.category === match.homeTokenCategory
        ? 'HOME_WIN'
        : 'AWAY_WIN';

    // Calculate outcome and payout
    const outcome = determineOutcome(
      match.scores.homeScoreFinal,
      match.scores.awayScoreFinal
    );

    if (!isRedeemable(outcome, tokenType)) {
      return {
        txId: '',
        tokensRedeemed: tokenUtxo.token?.amount || 0n,
        bchReceived: 0n,
        outcome: 'lose',
      };
    }

    const tokenAmount = tokenUtxo.token?.amount || 0n;
    const payout = calculatePayout(tokenAmount, outcome, tokenType, this.pricePerUnit);

    // Get settlement contract UTXOs
    const settlementUtxos = await this.settlementContract.getUtxos();
    const settlementUtxo = settlementUtxos.find(
      (u) => u.satoshis >= payout + TX_FEE
    );

    if (!settlementUtxo) {
      throw new Error('Insufficient funds in settlement contract');
    }

    // Get match state NFT
    // This would be fetched from the pool contract
    // For now, assume it's passed separately

    // Build redemption transaction
    const tx = this.settlementContract.functions
      .redeemWinning()
      .from(settlementUtxo)
      .fromP2PKH(tokenUtxo, signatureTemplate)
      .to(userAddress, payout);

    const txResult = await tx.send();

    const outcomeStr: 'win' | 'lose' | 'draw' =
      outcome === 'DRAW' ? 'draw' : 'win';

    return {
      txId: txResult.txid,
      tokensRedeemed: tokenAmount,
      bchReceived: payout,
      outcome: outcomeStr,
    };
  }

  /**
   * Batch redeem multiple token UTXOs
   */
  async batchRedeem(
    match: Match,
    tokenUtxos: UTXO[],
    userAddress: string,
    signatureTemplate: SignatureTemplate
  ): Promise<SettlementResult[]> {
    const results: SettlementResult[] = [];

    for (const utxo of tokenUtxos) {
      try {
        const result = await this.redeemTokens(
          match,
          utxo,
          userAddress,
          signatureTemplate
        );
        results.push(result);
      } catch (error) {
        console.error(`Failed to redeem token UTXO ${utxo.txid}:${utxo.vout}`, error);
        // Continue with other UTXOs
      }
    }

    return results;
  }

  /**
   * Get settlement pool balance
   */
  async getSettlementPoolBalance(): Promise<bigint> {
    if (!this.settlementContract) {
      throw new Error('Settlement contract not initialized');
    }

    const utxos = await this.settlementContract.getUtxos();
    return utxos.reduce((sum, u) => sum + u.satoshis, 0n);
  }

  /**
   * Fund settlement pool
   */
  async fundSettlementPool(
    amount: bigint,
    funderUtxo: UTXO,
    signatureTemplate: SignatureTemplate
  ): Promise<string> {
    if (!this.settlementContract) {
      throw new Error('Settlement contract not initialized');
    }

    const tx = this.settlementContract.functions
      .fundPool()
      .fromP2PKH(funderUtxo, signatureTemplate)
      .to(this.settlementContract.address, amount);

    const txResult = await tx.send();
    return txResult.txid;
  }
}

// =============================================================================
// SETTLEMENT STATISTICS
// =============================================================================

/**
 * Calculate settlement statistics for a match
 */
export function calculateSettlementStats(
  match: Match,
  totalHomeTokens: bigint,
  totalAwayTokens: bigint,
  pricePerUnit: bigint = DEFAULT_PRICE_PER_UNIT
): {
  outcome: 'HOME' | 'AWAY' | 'DRAW';
  winningTokens: bigint;
  losingTokens: bigint;
  totalPayout: bigint;
  homePayoutPerToken: bigint;
  awayPayoutPerToken: bigint;
} {
  const outcome = determineOutcome(
    match.scores.homeScoreFinal,
    match.scores.awayScoreFinal
  );

  let winningTokens: bigint;
  let losingTokens: bigint;
  let homePayoutPerToken: bigint;
  let awayPayoutPerToken: bigint;

  if (outcome === 'DRAW') {
    winningTokens = totalHomeTokens + totalAwayTokens;
    losingTokens = 0n;
    homePayoutPerToken = pricePerUnit / 2n;
    awayPayoutPerToken = pricePerUnit / 2n;
  } else if (outcome === 'HOME') {
    winningTokens = totalHomeTokens;
    losingTokens = totalAwayTokens;
    homePayoutPerToken = pricePerUnit;
    awayPayoutPerToken = 0n;
  } else {
    winningTokens = totalAwayTokens;
    losingTokens = totalHomeTokens;
    homePayoutPerToken = 0n;
    awayPayoutPerToken = pricePerUnit;
  }

  const homePayout = calculatePayout(totalHomeTokens, outcome, 'HOME_WIN', pricePerUnit);
  const awayPayout = calculatePayout(totalAwayTokens, outcome, 'AWAY_WIN', pricePerUnit);
  const totalPayout = homePayout + awayPayout;

  return {
    outcome,
    winningTokens,
    losingTokens,
    totalPayout,
    homePayoutPerToken,
    awayPayoutPerToken,
  };
}

/**
 * Calculate profit/loss for a position
 */
export function calculatePnL(
  tokenAmount: bigint,
  tokenType: 'HOME_WIN' | 'AWAY_WIN',
  averageCost: bigint, // What user paid per token
  match: Match,
  pricePerUnit: bigint = DEFAULT_PRICE_PER_UNIT
): {
  pnl: bigint;
  pnlPercent: number;
  redemptionValue: bigint;
} {
  const outcome = determineOutcome(
    match.scores.homeScoreFinal,
    match.scores.awayScoreFinal
  );

  const redemptionValue = calculatePayout(
    tokenAmount,
    outcome,
    tokenType,
    pricePerUnit
  );

  const totalCost = tokenAmount * averageCost;
  const pnl = redemptionValue - totalCost;
  const pnlPercent = totalCost > 0n
    ? Number((pnl * 10000n) / totalCost) / 100
    : 0;

  return {
    pnl,
    pnlPercent,
    redemptionValue,
  };
}

// =============================================================================
// REFUND CALCULATIONS (for cancelled matches)
// =============================================================================

/**
 * Calculate refund for cancelled match
 */
export function calculateCancelledRefund(
  tokenAmount: bigint,
  pricePerUnit: bigint = DEFAULT_PRICE_PER_UNIT
): bigint {
  // Cancelled matches refund at 50% (market midpoint)
  return (tokenAmount * pricePerUnit) / 2n;
}

/**
 * Process refund for cancelled match
 */
export async function processRefund(
  settlementContract: Contract,
  tokenUtxo: UTXO,
  userAddress: string,
  signatureTemplate: SignatureTemplate,
  pricePerUnit: bigint = DEFAULT_PRICE_PER_UNIT
): Promise<{ txId: string; refundAmount: bigint }> {
  const tokenAmount = tokenUtxo.token?.amount || 0n;
  const refundAmount = calculateCancelledRefund(tokenAmount, pricePerUnit);

  const tx = settlementContract.functions
    .redeemCancelled()
    .fromP2PKH(tokenUtxo, signatureTemplate)
    .to(userAddress, refundAmount);

  const txResult = await tx.send();

  return {
    txId: txResult.txid,
    refundAmount,
  };
}
