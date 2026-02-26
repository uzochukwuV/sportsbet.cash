import { useState, useCallback } from 'react';
import { useWallet } from './useWallet';
import { useElectrum } from './useElectrum';
import { useMatches } from './useMatches';
import {
  calcTokensOut,
  calcBchOut,
  calcPriceImpact,
  buildBuyTxData,
  buildSellTxData,
  FEE_DENOMINATOR,
  FEE_NUMERATOR,
  PRICE_PER_UNIT,
  type ElectrumUTXO,
} from '../lib/contractService';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TradeResult {
  success: boolean;
  txid?: string;
  tokensReceived?: bigint;  // for buy
  bchReceived?: bigint;     // for sell
  error?: string;
}

export interface TradeQuote {
  tokensOut?: bigint;
  bchOut?: bigint;
  priceImpact: number;
  effectivePrice: number;  // sats per token
  fee: bigint;             // sats
}

interface UseTradeReturn {
  isSubmitting: boolean;
  lastTrade: TradeResult | null;
  buyTokens: (
    matchId: string,
    buyHome: boolean,
    bchAmount: bigint,
    slippage?: number,
  ) => Promise<TradeResult>;
  sellTokens: (
    matchId: string,
    sellHome: boolean,
    tokenAmount: bigint,
    slippage?: number,
  ) => Promise<TradeResult>;
  quoteBuy: (
    matchId: string,
    buyHome: boolean,
    bchAmount: bigint,
  ) => TradeQuote | null;
  quoteSell: (
    matchId: string,
    sellHome: boolean,
    tokenAmount: bigint,
  ) => TradeQuote | null;
}

const DEFAULT_SLIPPAGE = 0.01; // 1%

// ─── useTrade ─────────────────────────────────────────────────────────────────

export function useTrade(): UseTradeReturn {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastTrade, setLastTrade]       = useState<TradeResult | null>(null);

  const { isConnected, connect, address, signTransaction } = useWallet();
  const electrum = useElectrum();
  const { getMatch, refreshMatches } = useMatches();

  // ── Quote helpers (synchronous, using cached match state) ──────────────────

  const quoteBuy = useCallback(
    (matchId: string, buyHome: boolean, bchAmount: bigint): TradeQuote | null => {
      const match = getMatch(matchId);
      if (!match || bchAmount <= 0n) return null;

      const rt = buyHome ? match.reserveHome : match.reserveAway;
      const ro = buyHome ? match.reserveAway : match.reserveHome;

      const tokensOut     = calcTokensOut(bchAmount, rt, ro);
      const priceImpact   = calcPriceImpact(bchAmount, rt, ro, true);
      const effectivePrice = tokensOut > 0n ? Number(bchAmount) / Number(tokensOut) : 0;
      const fee           = (bchAmount * FEE_NUMERATOR) / FEE_DENOMINATOR;

      return { tokensOut, priceImpact, effectivePrice, fee };
    },
    [getMatch],
  );

  const quoteSell = useCallback(
    (matchId: string, sellHome: boolean, tokenAmount: bigint): TradeQuote | null => {
      const match = getMatch(matchId);
      if (!match || tokenAmount <= 0n) return null;

      const rt = sellHome ? match.reserveHome : match.reserveAway;
      const ro = sellHome ? match.reserveAway : match.reserveHome;

      const bchOut        = calcBchOut(tokenAmount, rt, ro);
      const priceImpact   = calcPriceImpact(tokenAmount, rt, ro, false);
      const effectivePrice = tokenAmount > 0n ? Number(bchOut) / Number(tokenAmount) : 0;
      const fee           = (tokenAmount * PRICE_PER_UNIT * FEE_NUMERATOR) / FEE_DENOMINATOR;

      return { bchOut, priceImpact, effectivePrice, fee };
    },
    [getMatch],
  );

  // ── Buy tokens ─────────────────────────────────────────────────────────────

  const buyTokens = useCallback(async (
    matchId: string,
    buyHome: boolean,
    bchAmount: bigint,
    slippage = DEFAULT_SLIPPAGE,
  ): Promise<TradeResult> => {
    if (!isConnected) {
      await connect();
      return { success: false, error: 'Connect your wallet first' };
    }
    if (!address) return { success: false, error: 'No wallet address' };

    const match = getMatch(matchId);
    if (!match) return { success: false, error: 'Match not found' };

    if (match.status === 'settled') {
      return { success: false, error: 'Market is settled — trading closed' };
    }
    if (match.poolState.state !== 0 && match.poolState.state !== 2) {
      return { success: false, error: 'Trading is currently paused for this match' };
    }

    setIsSubmitting(true);
    setLastTrade(null);

    try {
      // Fetch user's spendable BCH UTXOs
      const userUtxos: ElectrumUTXO[] = await electrum.getUtxos(address);
      const bchUtxos = userUtxos.filter(u => !u.token);

      const totalBch = bchUtxos.reduce((s, u) => s + u.satoshis, 0n);
      if (totalBch < bchAmount) {
        return { success: false, error: `Insufficient balance: have ${totalBch} sats, need ${bchAmount}` };
      }

      // Calculate min tokens with slippage
      const quote = quoteBuy(matchId, buyHome, bchAmount);
      if (!quote?.tokensOut || quote.tokensOut === 0n) {
        return { success: false, error: 'Amount too small — would receive 0 tokens' };
      }
      const minTokensOut = BigInt(Math.floor(Number(quote.tokensOut) * (1 - slippage)));

      // Build the transaction data
      const txData = buildBuyTxData({
        poolUtxo:          match.poolUtxo,
        userUtxos:         bchUtxos,
        userAddress:       address,
        poolAddress:       match.poolAddress,
        buyHome,
        bchAmount,
        minTokensOut,
        homeTokenCategory: match.homeTokenCategory,
        awayTokenCategory: match.awayTokenCategory,
        poolState:         match.poolState,
      });

      // Sign via WalletConnect and broadcast
      const signedTx = await signTransaction(
        JSON.stringify(txData.inputs.map(inp => ({ ...inp, satoshis: inp.satoshis.toString() }))),
        txData.inputs.map(inp => ({
          lockingBytecode: new Uint8Array(),  // wallet fills this from txid+vout
          valueSatoshis: inp.satoshis,
          token: inp.tokenData ? {
            amount: BigInt((inp.tokenData as { amount?: bigint }).amount ?? 0n),
            category: hexToBytes((inp.tokenData as { category?: string }).category ?? ''),
            nft: (inp.tokenData as { nft?: { capability: string; commitment: string } }).nft
              ? {
                  capability: (inp.tokenData as { nft?: { capability: string; commitment: string } }).nft!.capability,
                  commitment: hexToBytes((inp.tokenData as { nft?: { capability: string; commitment: string } }).nft!.commitment),
                }
              : undefined,
          } : undefined,
        })),
      );

      const txid = await electrum.broadcastTransaction(signedTx);

      const result: TradeResult = {
        success: true,
        txid,
        tokensReceived: txData.tokensOut,
      };
      setLastTrade(result);

      // Refresh pool state after a short delay (allow indexer to catch up)
      setTimeout(() => refreshMatches(), 3000);

      return result;
    } catch (e) {
      const result: TradeResult = { success: false, error: `Trade failed: ${e}` };
      setLastTrade(result);
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, connect, address, electrum, getMatch, quoteBuy, signTransaction, refreshMatches]);

  // ── Sell tokens ─────────────────────────────────────────────────────────────

  const sellTokens = useCallback(async (
    matchId: string,
    sellHome: boolean,
    tokenAmount: bigint,
    slippage = DEFAULT_SLIPPAGE,
  ): Promise<TradeResult> => {
    if (!isConnected) {
      await connect();
      return { success: false, error: 'Connect your wallet first' };
    }
    if (!address) return { success: false, error: 'No wallet address' };

    const match = getMatch(matchId);
    if (!match) return { success: false, error: 'Match not found' };

    if (match.poolState.state !== 0 && match.poolState.state !== 2) {
      return { success: false, error: 'Trading is currently paused for this match' };
    }

    setIsSubmitting(true);
    setLastTrade(null);

    try {
      const userUtxos: ElectrumUTXO[] = await electrum.getUtxos(address);

      const expectedCategory = sellHome ? match.homeTokenCategory : match.awayTokenCategory;
      const tokenUtxos = userUtxos.filter(u => u.token?.category === expectedCategory);

      const totalTokens = tokenUtxos.reduce((s, u) => s + (u.token?.amount ?? 0n), 0n);
      if (totalTokens < tokenAmount) {
        return { success: false, error: `Insufficient tokens: have ${totalTokens}, need ${tokenAmount}` };
      }

      // Pick the token UTXO with the most tokens
      const userTokenUtxo = tokenUtxos.sort((a, b) =>
        (a.token!.amount < b.token!.amount ? 1 : -1)
      )[0];

      // Need a separate BCH UTXO for tx fee
      const bchUtxos = userUtxos.filter(u => !u.token && u.satoshis >= 2000n);
      if (bchUtxos.length === 0) {
        return { success: false, error: 'Need a small BCH UTXO to pay tx fee (~0.00001 BCH)' };
      }
      const userBchUtxo = bchUtxos[0];

      const quote = quoteSell(matchId, sellHome, tokenAmount);
      if (!quote?.bchOut || quote.bchOut === 0n) {
        return { success: false, error: 'Amount too small — would receive 0 BCH' };
      }
      const minBchOut = BigInt(Math.floor(Number(quote.bchOut) * (1 - slippage)));

      const txData = buildSellTxData({
        poolUtxo:          match.poolUtxo,
        userTokenUtxo,
        userBchUtxo,
        userAddress:       address,
        poolAddress:       match.poolAddress,
        sellHome,
        tokenAmount,
        minBchOut,
        homeTokenCategory: match.homeTokenCategory,
        awayTokenCategory: match.awayTokenCategory,
        poolState:         match.poolState,
      });

      const signedTx = await signTransaction(
        JSON.stringify(txData.inputs.map(inp => ({ ...inp, satoshis: inp.satoshis.toString() }))),
        txData.inputs.map(inp => ({
          lockingBytecode: new Uint8Array(),
          valueSatoshis: inp.satoshis,
          token: inp.tokenData ? {
            amount: BigInt((inp.tokenData as { amount?: bigint }).amount ?? 0n),
            category: hexToBytes((inp.tokenData as { category?: string }).category ?? ''),
            nft: (inp.tokenData as { nft?: { capability: string; commitment: string } }).nft
              ? {
                  capability: (inp.tokenData as { nft?: { capability: string; commitment: string } }).nft!.capability,
                  commitment: hexToBytes((inp.tokenData as { nft?: { capability: string; commitment: string } }).nft!.commitment),
                }
              : undefined,
          } : undefined,
        })),
      );

      const txid = await electrum.broadcastTransaction(signedTx);

      const result: TradeResult = {
        success: true,
        txid,
        bchReceived: txData.bchOut,
      };
      setLastTrade(result);
      setTimeout(() => refreshMatches(), 3000);
      return result;

    } catch (e) {
      const result: TradeResult = { success: false, error: `Trade failed: ${e}` };
      setLastTrade(result);
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, connect, address, electrum, getMatch, quoteSell, signTransaction, refreshMatches]);

  return { isSubmitting, lastTrade, buyTokens, sellTokens, quoteBuy, quoteSell };
}

// ─── useTokenBalance ──────────────────────────────────────────────────────────

export function useTokenBalance(address: string, tokenCategory: string) {
  const [balance, setBalance]   = useState<bigint>(0n);
  const [isLoading, setLoading] = useState(false);
  const electrum = useElectrum();

  const fetchBalance = useCallback(async () => {
    if (!address || !tokenCategory) { setBalance(0n); return; }
    setLoading(true);
    try {
      const utxos = await electrum.getUtxos(address);
      const total = utxos
        .filter(u => u.token?.category === tokenCategory)
        .reduce((s, u) => s + (u.token?.amount ?? 0n), 0n);
      setBalance(total);
    } catch (e) {
      console.error('Failed to fetch token balance:', e);
    } finally {
      setLoading(false);
    }
  }, [address, tokenCategory, electrum]);

  return { balance, isLoading, refresh: fetchBalance };
}

// ─── usePositions ─────────────────────────────────────────────────────────────
// Scans user UTXOs and cross-references with known pool token categories.

export function usePositions(address: string) {
  const [positions, setPositions] = useState<Array<{
    matchId: string;
    side: 'HOME' | 'AWAY';
    tokens: bigint;
    tokenCategory: string;
    poolAddress: string;
  }>>([]);
  const [isLoading, setLoading] = useState(false);

  const electrum = useElectrum();
  const { matches } = useMatches();

  const fetchPositions = useCallback(async () => {
    if (!address) { setPositions([]); return; }
    setLoading(true);
    try {
      const utxos = await electrum.getUtxos(address);
      const tokenUtxos = utxos.filter(u => u.token && !u.token.nft);

      const found: typeof positions = [];

      for (const utxo of tokenUtxos) {
        const cat = utxo.token!.category;
        for (const match of matches) {
          if (match.homeTokenCategory === cat) {
            found.push({ matchId: match.id, side: 'HOME', tokens: utxo.token!.amount, tokenCategory: cat, poolAddress: match.poolAddress });
          } else if (match.awayTokenCategory === cat) {
            found.push({ matchId: match.id, side: 'AWAY', tokens: utxo.token!.amount, tokenCategory: cat, poolAddress: match.poolAddress });
          }
        }
      }

      setPositions(found);
    } catch (e) {
      console.error('Failed to fetch positions:', e);
    } finally {
      setLoading(false);
    }
  }, [address, electrum, matches]);

  return { positions, isLoading, refresh: fetchPositions };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
