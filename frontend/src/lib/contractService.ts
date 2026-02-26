/**
 * contractService.ts — Frontend-side contract interaction layer
 *
 * Parses on-chain pool state from NFT commitments and builds
 * CashScript-compatible transactions for buy/sell via WalletConnect.
 *
 * Commitment format (38 bytes, little-endian ints):
 *   [0]     state        (1 byte)  — 0=TRADING, 1=HT_PENDING, 2=HT_TRADING, 3=FINAL_PENDING, 4=SETTLED
 *   [1-8]   reserveHome  (8 bytes) — BCH sats in HOME side
 *   [9-16]  reserveAway  (8 bytes) — BCH sats in AWAY side
 *   [17-20] halftimeBlock(4 bytes)
 *   [21-24] endBlock     (4 bytes)
 *   [25]    sportType    (1 byte)
 *   [26-33] matchId      (8 bytes)
 *   [34-37] scores       (4 bytes) — home1H, away1H, homeFinal, awayFinal
 */

export const POOL_STATE = {
  TRADING: 0,
  HALFTIME_PENDING: 1,
  HALFTIME_TRADING: 2,
  FINAL_PENDING: 3,
  SETTLED: 4,
} as const;

export const FEE_NUMERATOR = 30n;
export const FEE_DENOMINATOR = 10000n;
export const PRICE_PER_UNIT = 10_000n; // sats per token unit
export const DUST = 546n;
export const TX_FEE = 1000n;

// ─── Byte helpers ─────────────────────────────────────────────────────────────

function readLE(bytes: Uint8Array, offset: number, length: number): bigint {
  let result = 0n;
  for (let i = length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[offset + i]);
  }
  return result;
}

function writeLE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Parsed pool state ────────────────────────────────────────────────────────

export interface ParsedPoolState {
  state: number;
  reserveHome: bigint;   // sats
  reserveAway: bigint;   // sats
  halftimeBlock: number;
  endBlock: number;
  sportType: number;
  matchId: string;       // 8-byte hex
  scores: {
    home1H: number;
    away1H: number;
    homeFinal: number;
    awayFinal: number;
  };
  // Derived
  priceHome: number;
  priceAway: number;
  k: bigint;
}

export function parseCommitment(commitmentHex: string): ParsedPoolState {
  const bytes = hexToBytes(commitmentHex);

  const state         = bytes[0];
  const reserveHome   = readLE(bytes, 1, 8);
  const reserveAway   = readLE(bytes, 9, 8);
  const halftimeBlock = Number(readLE(bytes, 17, 4));
  const endBlock      = Number(readLE(bytes, 21, 4));
  const sportType     = bytes[25];
  const matchId       = bytesToHex(bytes.slice(26, 34));

  const scores = {
    home1H:    bytes[34],
    away1H:    bytes[35],
    homeFinal: bytes[36],
    awayFinal: bytes[37],
  };

  const total = reserveHome + reserveAway;
  const priceHome = total > 0n ? Number(reserveAway) / Number(total) : 0.5;
  const priceAway = total > 0n ? Number(reserveHome) / Number(total) : 0.5;

  return {
    state,
    reserveHome,
    reserveAway,
    halftimeBlock,
    endBlock,
    sportType,
    matchId,
    scores,
    priceHome,
    priceAway,
    k: reserveHome * reserveAway,
  };
}

export function encodeCommitment(parsed: ParsedPoolState): string {
  const buf = new Uint8Array(38);
  buf[0] = parsed.state;
  buf.set(writeLE(parsed.reserveHome, 8), 1);
  buf.set(writeLE(parsed.reserveAway, 8), 9);
  buf.set(writeLE(BigInt(parsed.halftimeBlock), 4), 17);
  buf.set(writeLE(BigInt(parsed.endBlock), 4), 21);
  buf[25] = parsed.sportType;
  buf.set(hexToBytes(parsed.matchId), 26);
  buf[34] = parsed.scores.home1H;
  buf[35] = parsed.scores.away1H;
  buf[36] = parsed.scores.homeFinal;
  buf[37] = parsed.scores.awayFinal;
  return bytesToHex(buf);
}

// ─── CPMM calculations (mirrors src/amm.ts, no cashscript dep) ───────────────

export function calcTokensOut(
  bchIn: bigint,
  reserveToken: bigint, // sats on the side being bought
  reserveOther: bigint, // sats on the other side
): bigint {
  const effectiveIn = (bchIn * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
  const satsBought  = (reserveToken * effectiveIn) / (reserveOther + effectiveIn);
  return satsBought / PRICE_PER_UNIT;
}

export function calcBchOut(
  tokensIn: bigint,
  reserveToken: bigint, // sats on the token being sold
  reserveOther: bigint,
): bigint {
  const satsIn       = tokensIn * PRICE_PER_UNIT;
  const effectiveSats = (satsIn * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
  return (reserveOther * effectiveSats) / (reserveToken + effectiveSats);
}

export function calcPriceImpact(
  amount: bigint,
  reserveToken: bigint,
  reserveOther: bigint,
  isBuy: boolean,
): number {
  const total = reserveToken + reserveOther;
  const priceBefore = total > 0n ? Number(reserveOther) / Number(total) : 0.5;

  let newToken: bigint;
  let newOther: bigint;

  if (isBuy) {
    const effectiveIn = (amount * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
    const satsBought  = (reserveToken * effectiveIn) / (reserveOther + effectiveIn);
    newToken = reserveToken - satsBought;
    newOther = reserveOther + amount;
  } else {
    const satsIn        = amount * PRICE_PER_UNIT;
    const effectiveSats = (satsIn * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
    const satsOut       = (reserveOther * effectiveSats) / (reserveToken + effectiveSats);
    newToken = reserveToken + satsIn;
    newOther = reserveOther - satsOut;
  }

  const newTotal = newToken + newOther;
  const priceAfter = newTotal > 0n ? Number(newOther) / Number(newTotal) : 0.5;

  return priceBefore > 0 ? Math.abs(priceAfter - priceBefore) / priceBefore : 0;
}

// ─── Transaction building ─────────────────────────────────────────────────────

/**
 * Raw UTXO from Electrum (as returned by useElectrum().getUtxos)
 */
export interface ElectrumUTXO {
  txid: string;
  vout: number;
  satoshis: bigint;
  height: number;
  token?: {
    category: string;
    amount: bigint;
    nft?: { capability: string; commitment: string };
  };
}

/**
 * Parameters needed to build a buyTokens transaction.
 * Returns the hex tx to pass to wallet.signTransaction().
 */
export interface BuyTxParams {
  poolUtxo: ElectrumUTXO;        // pool's state NFT UTXO
  userUtxos: ElectrumUTXO[];     // user's BCH UTXOs (we pick the best one)
  userAddress: string;
  poolAddress: string;
  buyHome: boolean;
  bchAmount: bigint;             // sats to spend (excluding dust/fees)
  minTokensOut: bigint;
  homeTokenCategory: string;     // 32-byte hex
  awayTokenCategory: string;
  poolState: ParsedPoolState;
}

export interface SellTxParams {
  poolUtxo: ElectrumUTXO;
  userTokenUtxo: ElectrumUTXO;  // UTXO holding the tokens to sell
  userBchUtxo: ElectrumUTXO;    // UTXO for paying tx fee
  userAddress: string;
  poolAddress: string;
  sellHome: boolean;
  tokenAmount: bigint;
  minBchOut: bigint;
  homeTokenCategory: string;
  awayTokenCategory: string;
  poolState: ParsedPoolState;
}

/**
 * Build unsigned buy transaction (P2SH + P2PKH inputs).
 *
 * Layout:
 *   Input 0: pool UTXO  (contract)
 *   Input 1: user BCH   (P2PKH — signed by wallet)
 *   Output 0: updated pool (same locking bytecode, updated commitment, bchIn added)
 *   Output 1: token output to user address
 *   Output 2: BCH change to user (if any)
 */
export function buildBuyTxData(params: BuyTxParams): {
  inputs: Array<{ txid: string; vout: number; satoshis: bigint; tokenData?: object }>;
  outputs: Array<{ address?: string; lockingBytecode?: string; satoshis: bigint; tokenData?: object }>;
  newCommitmentHex: string;
  tokensOut: bigint;
} {
  const { poolUtxo, poolState, buyHome, bchAmount, minTokensOut,
          homeTokenCategory, awayTokenCategory, userAddress, poolAddress } = params;

  const reserveToken = buyHome ? poolState.reserveHome : poolState.reserveAway;
  const reserveOther = buyHome ? poolState.reserveAway : poolState.reserveHome;

  const effectiveIn = (bchAmount * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
  const satsBought  = (reserveToken * effectiveIn) / (reserveOther + effectiveIn);
  const tokensOut   = satsBought / PRICE_PER_UNIT;

  if (tokensOut < minTokensOut) {
    throw new Error(`Slippage exceeded: expected ${minTokensOut} tokens but would get ${tokensOut}`);
  }

  // New reserves
  const newReserveToken = reserveToken - satsBought;
  const newReserveOther = reserveOther + bchAmount;

  const newState: ParsedPoolState = {
    ...poolState,
    reserveHome: buyHome ? newReserveToken : newReserveOther,
    reserveAway: buyHome ? newReserveOther : newReserveToken,
    priceHome: 0, // recalculated below
    priceAway: 0,
    k: newReserveToken * newReserveOther,
  };
  const newTotal = newState.reserveHome + newState.reserveAway;
  newState.priceHome = newTotal > 0n ? Number(newState.reserveAway) / Number(newTotal) : 0.5;
  newState.priceAway = newTotal > 0n ? Number(newState.reserveHome) / Number(newTotal) : 0.5;

  const newCommitmentHex = encodeCommitment(newState);

  // Pick best user UTXO
  const needed = bchAmount + TX_FEE + DUST;
  const userUtxo = params.userUtxos
    .filter(u => !u.token && u.satoshis >= needed)
    .sort((a, b) => (a.satoshis < b.satoshis ? -1 : 1))[0];

  if (!userUtxo) {
    throw new Error(`Insufficient BCH: need at least ${needed} sats`);
  }

  const change = userUtxo.satoshis - bchAmount - TX_FEE;
  const tokenCategory = buyHome ? homeTokenCategory : awayTokenCategory;

  const inputs = [
    { txid: poolUtxo.txid, vout: poolUtxo.vout, satoshis: poolUtxo.satoshis,
      tokenData: poolUtxo.token },
    { txid: userUtxo.txid, vout: userUtxo.vout, satoshis: userUtxo.satoshis },
  ];

  const outputs: Array<{ address?: string; satoshis: bigint; tokenData?: object }> = [
    {
      address: poolAddress,
      satoshis: poolUtxo.satoshis + bchAmount - TX_FEE,
      tokenData: {
        category: poolUtxo.token!.category,
        amount: 0n,
        nft: { capability: poolUtxo.token!.nft!.capability, commitment: newCommitmentHex },
      },
    },
    {
      address: userAddress,
      satoshis: DUST,
      tokenData: { category: tokenCategory, amount: tokensOut },
    },
  ];

  if (change > DUST) {
    outputs.push({ address: userAddress, satoshis: change });
  }

  return { inputs, outputs, newCommitmentHex, tokensOut };
}

/**
 * Build unsigned sell transaction.
 *
 * Layout:
 *   Input 0: pool UTXO  (contract)
 *   Input 1: user token UTXO (P2PKH — signed by wallet)
 *   Input 2: user BCH for fee (P2PKH)
 *   Output 0: updated pool
 *   Output 1: BCH payout to user
 *   Output 2: BCH change to user (if any)
 */
export function buildSellTxData(params: SellTxParams): {
  inputs: Array<{ txid: string; vout: number; satoshis: bigint; tokenData?: object }>;
  outputs: Array<{ address?: string; satoshis: bigint; tokenData?: object }>;
  newCommitmentHex: string;
  bchOut: bigint;
} {
  const { poolUtxo, poolState, sellHome, tokenAmount, minBchOut,
          homeTokenCategory, awayTokenCategory, userAddress, poolAddress,
          userTokenUtxo, userBchUtxo } = params;

  const reserveToken = sellHome ? poolState.reserveHome : poolState.reserveAway;
  const reserveOther = sellHome ? poolState.reserveAway : poolState.reserveHome;

  const satsIn        = tokenAmount * PRICE_PER_UNIT;
  const effectiveSats = (satsIn * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
  const satsOut       = (reserveOther * effectiveSats) / (reserveToken + effectiveSats);

  if (satsOut < minBchOut) {
    throw new Error(`Slippage exceeded: expected ${minBchOut} sats but would get ${satsOut}`);
  }

  const newReserveToken = reserveToken + satsIn;
  const newReserveOther = reserveOther - satsOut;

  const newState: ParsedPoolState = {
    ...poolState,
    reserveHome: sellHome ? newReserveToken : newReserveOther,
    reserveAway: sellHome ? newReserveOther : newReserveToken,
    priceHome: 0,
    priceAway: 0,
    k: newReserveToken * newReserveOther,
  };
  const newTotal = newState.reserveHome + newState.reserveAway;
  newState.priceHome = newTotal > 0n ? Number(newState.reserveAway) / Number(newTotal) : 0.5;
  newState.priceAway = newTotal > 0n ? Number(newState.reserveHome) / Number(newTotal) : 0.5;

  const newCommitmentHex = encodeCommitment(newState);

  const expectedCategory = sellHome ? homeTokenCategory : awayTokenCategory;
  if (userTokenUtxo.token?.category !== expectedCategory) {
    throw new Error('Token category mismatch');
  }

  const feeChange = userBchUtxo.satoshis - TX_FEE;

  const inputs = [
    { txid: poolUtxo.txid,      vout: poolUtxo.vout,      satoshis: poolUtxo.satoshis,      tokenData: poolUtxo.token },
    { txid: userTokenUtxo.txid, vout: userTokenUtxo.vout, satoshis: userTokenUtxo.satoshis,  tokenData: userTokenUtxo.token },
    { txid: userBchUtxo.txid,   vout: userBchUtxo.vout,   satoshis: userBchUtxo.satoshis },
  ];

  const newPoolSats = poolUtxo.satoshis - satsOut - TX_FEE;
  const outputs: Array<{ address?: string; satoshis: bigint; tokenData?: object }> = [
    {
      address: poolAddress,
      satoshis: newPoolSats > DUST ? newPoolSats : DUST,
      tokenData: {
        category: poolUtxo.token!.category,
        amount: 0n,
        nft: { capability: poolUtxo.token!.nft!.capability, commitment: newCommitmentHex },
      },
    },
    { address: userAddress, satoshis: satsOut },
  ];

  if (feeChange > DUST) {
    outputs.push({ address: userAddress, satoshis: feeChange });
  }

  return { inputs, outputs, newCommitmentHex, bchOut: satsOut };
}
