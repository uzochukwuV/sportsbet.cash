/**
 * SportsBet.cash - VRF Oracle Module
 *
 * Implements verifiable random function via commit-reveal scheme.
 * This ensures fair, unpredictable, and verifiable score generation.
 *
 * Security Model:
 * 1. Oracle commits to secret BEFORE betting starts
 * 2. Users place bets (cannot predict outcome)
 * 3. Oracle reveals secret at designated time
 * 4. Anyone can verify reveal matches commitment
 * 5. Scores are deterministically derived from secret
 */

import {
  sha256,
  instantiateSha256,
  hexToBin,
  binToHex,
} from '@bitauth/libauth';
import type { MatchScores, SportType, OracleCommitment, OracleReveal, VRFVerification } from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

// Score ranges per sport type
const SCORE_RANGES: Record<SportType, { min: number; max: number }> = {
  0: { min: 30, max: 75 },   // Basketball: 30-75 per half
  1: { min: 0, max: 4 },     // Football (soccer): 0-4 per half
  2: { min: 0, max: 28 },    // American Football: 0-28 per half
};

// Phase markers for score derivation
const HALFTIME_MARKER = 0x48; // 'H'
const FINAL_MARKER = 0x46;    // 'F'

// =============================================================================
// VRF CORE FUNCTIONS
// =============================================================================

let sha256Instance: Awaited<ReturnType<typeof instantiateSha256>> | null = null;

async function getSha256(): Promise<ReturnType<typeof instantiateSha256>> {
  if (!sha256Instance) {
    sha256Instance = await instantiateSha256();
  }
  return sha256Instance;
}

/**
 * Generate a cryptographically secure random secret
 */
export function generateSecret(): Uint8Array {
  const secret = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(secret);
  } else {
    // Fallback for Node.js
    const { randomBytes } = require('crypto');
    const bytes = randomBytes(32);
    secret.set(bytes);
  }
  return secret;
}

/**
 * Create commitment from secret and match ID
 *
 * commitment = SHA256(SHA256(secret || matchId))
 * Double hash for additional security
 */
export async function createCommitment(
  secret: Uint8Array,
  matchId: Uint8Array
): Promise<Uint8Array> {
  const sha256 = await getSha256();

  // Concatenate secret and matchId
  const data = new Uint8Array(secret.length + matchId.length);
  data.set(secret);
  data.set(matchId, secret.length);

  // Double SHA256 (like Bitcoin's hash256)
  const firstHash = sha256.hash(data);
  const commitment = sha256.hash(firstHash);

  return commitment;
}

/**
 * Verify that a revealed secret matches the commitment
 */
export async function verifyCommitment(
  secret: Uint8Array,
  matchId: Uint8Array,
  commitment: Uint8Array
): Promise<VRFVerification> {
  const computedCommitment = await createCommitment(secret, matchId);

  const isValid = arraysEqual(computedCommitment, commitment);

  return {
    isValid,
    commitment: binToHex(commitment),
    computedCommitment: binToHex(computedCommitment),
    matchId: binToHex(matchId),
  };
}

/**
 * Generate scores from secret
 *
 * Uses deterministic derivation:
 * scoreHash = SHA256(secret || phaseMarker)
 * scores extracted from hash bytes
 */
export async function generateScores(
  secret: Uint8Array,
  phase: 'halftime' | 'final',
  sportType: SportType
): Promise<{ homeScore: number; awayScore: number }> {
  const sha256 = await getSha256();

  // Create phase-specific input
  const marker = phase === 'halftime' ? HALFTIME_MARKER : FINAL_MARKER;
  const data = new Uint8Array(secret.length + 1);
  data.set(secret);
  data[secret.length] = marker;

  const scoreHash = sha256.hash(data);

  // Get score range for sport type
  const range = SCORE_RANGES[sportType];
  const scoreRange = range.max - range.min + 1;

  // Extract scores from hash bytes
  // Use first 2 bytes for home, next 2 for away
  const homeRaw = (scoreHash[0] << 8) | scoreHash[1];
  const awayRaw = (scoreHash[2] << 8) | scoreHash[3];

  const homeScore = range.min + (homeRaw % scoreRange);
  const awayScore = range.min + (awayRaw % scoreRange);

  return { homeScore, awayScore };
}

/**
 * Generate complete match scores (both halves)
 */
export async function generateMatchScores(
  secret: Uint8Array,
  sportType: SportType
): Promise<MatchScores> {
  const halftime = await generateScores(secret, 'halftime', sportType);
  const secondHalf = await generateScores(secret, 'final', sportType);

  return {
    homeScore1H: halftime.homeScore,
    awayScore1H: halftime.awayScore,
    homeScoreFinal: halftime.homeScore + secondHalf.homeScore,
    awayScoreFinal: halftime.awayScore + secondHalf.awayScore,
  };
}

// =============================================================================
// ORACLE MANAGER CLASS
// =============================================================================

/**
 * Oracle manager for creating and revealing match commitments
 */
export class OracleManager {
  private secrets: Map<string, Uint8Array> = new Map();
  private commitments: Map<string, OracleCommitment> = new Map();

  /**
   * Create a new match commitment
   *
   * @param matchId - Unique match identifier (8 bytes hex)
   * @returns The commitment to be posted on-chain
   */
  async createMatchCommitment(matchId: string): Promise<OracleCommitment> {
    const matchIdBytes = hexToBin(matchId);
    if (matchIdBytes.length !== 8) {
      throw new Error('Match ID must be 8 bytes (16 hex characters)');
    }

    // Generate and store secret securely
    const secret = generateSecret();
    this.secrets.set(matchId, secret);

    // Create commitment
    const commitment = await createCommitment(secret, matchIdBytes);

    const result: OracleCommitment = {
      matchId,
      commitment: binToHex(commitment),
      createdAt: Date.now(),
    };

    this.commitments.set(matchId, result);
    return result;
  }

  /**
   * Reveal scores for a match
   *
   * @param matchId - Match identifier
   * @param phase - 'halftime' or 'final'
   * @param sportType - Type of sport for score ranges
   */
  async revealScores(
    matchId: string,
    phase: 'halftime' | 'final',
    sportType: SportType
  ): Promise<OracleReveal> {
    const secret = this.secrets.get(matchId);
    if (!secret) {
      throw new Error(`No secret found for match ${matchId}`);
    }

    const scores = await generateMatchScores(secret, sportType);

    return {
      matchId,
      secret: binToHex(secret),
      phase,
      generatedScores: scores,
    };
  }

  /**
   * Get stored commitment for a match
   */
  getCommitment(matchId: string): OracleCommitment | undefined {
    return this.commitments.get(matchId);
  }

  /**
   * Verify a reveal against stored commitment
   */
  async verifyReveal(
    matchId: string,
    revealedSecret: string
  ): Promise<VRFVerification> {
    const commitment = this.commitments.get(matchId);
    if (!commitment) {
      throw new Error(`No commitment found for match ${matchId}`);
    }

    const secretBytes = hexToBin(revealedSecret);
    const matchIdBytes = hexToBin(matchId);
    const commitmentBytes = hexToBin(commitment.commitment);

    return verifyCommitment(secretBytes, matchIdBytes, commitmentBytes);
  }

  /**
   * Import an existing secret (for oracle recovery)
   */
  importSecret(matchId: string, secretHex: string): void {
    const secret = hexToBin(secretHex);
    if (secret.length !== 32) {
      throw new Error('Secret must be 32 bytes');
    }
    this.secrets.set(matchId, secret);
  }

  /**
   * Export secret for secure backup (CRITICAL: store securely!)
   */
  exportSecret(matchId: string): string | undefined {
    const secret = this.secrets.get(matchId);
    return secret ? binToHex(secret) : undefined;
  }

  /**
   * Clear secrets after match settlement (security best practice)
   */
  clearMatchData(matchId: string): void {
    this.secrets.delete(matchId);
    this.commitments.delete(matchId);
  }
}

// =============================================================================
// STANDALONE VERIFICATION
// =============================================================================

/**
 * Standalone verification that anyone can perform
 * Verify scores were correctly derived from the revealed secret
 */
export async function verifyMatchScores(
  revealedSecret: string,
  matchId: string,
  commitment: string,
  claimedScores: MatchScores,
  sportType: SportType
): Promise<{ valid: boolean; reason?: string }> {
  const secretBytes = hexToBin(revealedSecret);
  const matchIdBytes = hexToBin(matchId);
  const commitmentBytes = hexToBin(commitment);

  // Step 1: Verify commitment
  const verification = await verifyCommitment(secretBytes, matchIdBytes, commitmentBytes);
  if (!verification.isValid) {
    return {
      valid: false,
      reason: `Commitment verification failed. Expected: ${commitment}, Got: ${verification.computedCommitment}`,
    };
  }

  // Step 2: Generate expected scores
  const expectedScores = await generateMatchScores(secretBytes, sportType);

  // Step 3: Compare scores
  if (
    claimedScores.homeScore1H !== expectedScores.homeScore1H ||
    claimedScores.awayScore1H !== expectedScores.awayScore1H ||
    claimedScores.homeScoreFinal !== expectedScores.homeScoreFinal ||
    claimedScores.awayScoreFinal !== expectedScores.awayScoreFinal
  ) {
    return {
      valid: false,
      reason: `Score mismatch. Expected: ${JSON.stringify(expectedScores)}, Got: ${JSON.stringify(claimedScores)}`,
    };
  }

  return { valid: true };
}

/**
 * Generate a preview of what scores would be
 * (for testing/simulation only - don't use revealed secrets!)
 */
export async function previewScores(
  secret: string,
  sportType: SportType
): Promise<MatchScores> {
  const secretBytes = hexToBin(secret);
  return generateMatchScores(secretBytes, sportType);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Compare two Uint8Arrays for equality
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Generate a unique match ID
 */
export function generateMatchId(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    const { randomBytes } = require('crypto');
    bytes.set(randomBytes(8));
  }
  return binToHex(bytes);
}

/**
 * Encode match ID from human-readable format
 * e.g., "LAL-GSW-20240315" → 8-byte hash
 */
export async function encodeMatchId(humanId: string): Promise<string> {
  const sha256 = await getSha256();
  const encoded = new TextEncoder().encode(humanId);
  const hash = sha256.hash(encoded);
  return binToHex(hash.slice(0, 8));
}
