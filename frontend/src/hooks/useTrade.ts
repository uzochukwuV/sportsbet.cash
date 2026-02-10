import { useState, useCallback } from 'react';
import { useWallet } from './useWallet';
import { useElectrum } from './useElectrum';
import { usePoolState } from './useMatches';

interface TradeResult {
  success: boolean;
  txid?: string;
  tokensReceived?: bigint;
  error?: string;
}

interface UseTradeReturn {
  // State
  isSubmitting: boolean;
  lastTrade: TradeResult | null;
  // Actions
  buyTokens: (matchId: string, buyHome: boolean, bchAmount: bigint, minTokensOut?: bigint) => Promise<TradeResult>;
  sellTokens: (matchId: string, sellHome: boolean, tokenAmount: bigint, minBchOut?: bigint) => Promise<TradeResult>;
  // Calculations
  estimateBuy: (poolAddress: string, buyHome: boolean, bchAmount: bigint) => Promise<{
    tokensOut: bigint;
    priceImpact: number;
    effectivePrice: number;
  }>;
  estimateSell: (poolAddress: string, sellHome: boolean, tokenAmount: bigint) => Promise<{
    bchOut: bigint;
    priceImpact: number;
    effectivePrice: number;
  }>;
}

// Fee configuration (matches contract)
const FEE_NUMERATOR = 30n; // 0.3%
const FEE_DENOMINATOR = 10000n;

export function useTrade(): UseTradeReturn {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastTrade, setLastTrade] = useState<TradeResult | null>(null);

  const { isConnected, connect, balance, address } = useWallet();
  const electrum = useElectrum();

  // Buy outcome tokens with BCH
  const buyTokens = useCallback(async (
    matchId: string,
    buyHome: boolean,
    bchAmount: bigint,
    minTokensOut?: bigint
  ): Promise<TradeResult> => {
    if (!isConnected) {
      await connect();
      return { success: false, error: 'Wallet not connected' };
    }

    if (balance < bchAmount) {
      return { success: false, error: 'Insufficient balance' };
    }

    setIsSubmitting(true);
    setLastTrade(null);

    try {
      // In production, this would:
      // 1. Load the pool contract
      // 2. Get pool UTXO
      // 3. Get user UTXO for payment
      // 4. Build the buyTokens transaction
      // 5. Sign with wallet (via WalletConnect)
      // 6. Broadcast

      // For demo, simulate the transaction
      console.log('Buying tokens:', {
        matchId,
        buyHome,
        bchAmount: bchAmount.toString(),
        minTokensOut: minTokensOut?.toString(),
      });

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Mock successful trade
      const mockTxid = 'demo_' + Math.random().toString(36).substring(7);
      const mockTokensReceived = bchAmount * 95n / 100n; // ~95% of input

      const result: TradeResult = {
        success: true,
        txid: mockTxid,
        tokensReceived: mockTokensReceived,
      };

      setLastTrade(result);
      return result;

    } catch (e) {
      const result: TradeResult = {
        success: false,
        error: `Trade failed: ${e}`,
      };
      setLastTrade(result);
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, connect, balance]);

  // Sell outcome tokens for BCH
  const sellTokens = useCallback(async (
    matchId: string,
    sellHome: boolean,
    tokenAmount: bigint,
    minBchOut?: bigint
  ): Promise<TradeResult> => {
    if (!isConnected) {
      await connect();
      return { success: false, error: 'Wallet not connected' };
    }

    setIsSubmitting(true);
    setLastTrade(null);

    try {
      // In production, this would:
      // 1. Load the pool contract
      // 2. Get pool UTXO
      // 3. Get user token UTXO
      // 4. Build the sellTokens transaction
      // 5. Sign with wallet
      // 6. Broadcast

      console.log('Selling tokens:', {
        matchId,
        sellHome,
        tokenAmount: tokenAmount.toString(),
        minBchOut: minBchOut?.toString(),
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      const mockTxid = 'demo_' + Math.random().toString(36).substring(7);
      const mockBchReceived = tokenAmount * 95n / 100n;

      const result: TradeResult = {
        success: true,
        txid: mockTxid,
        tokensReceived: mockBchReceived,
      };

      setLastTrade(result);
      return result;

    } catch (e) {
      const result: TradeResult = {
        success: false,
        error: `Trade failed: ${e}`,
      };
      setLastTrade(result);
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, connect]);

  // Estimate buy output
  const estimateBuy = useCallback(async (
    poolAddress: string,
    buyHome: boolean,
    bchAmount: bigint
  ) => {
    // In production, fetch current pool state
    // For demo, use mock values
    const reserveHome = 65000n;
    const reserveAway = 35000n;

    const inputReserve = buyHome ? reserveAway : reserveHome;
    const outputReserve = buyHome ? reserveHome : reserveAway;

    // Apply fee
    const effectiveIn = (bchAmount * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;

    // CPMM formula
    const tokensOut = (outputReserve * effectiveIn) / (inputReserve + effectiveIn);

    // Calculate price impact
    const newInputReserve = inputReserve + bchAmount;
    const newOutputReserve = outputReserve - tokensOut;
    const oldPrice = Number(outputReserve) / Number(inputReserve + outputReserve);
    const newPrice = Number(newOutputReserve) / Number(newInputReserve + newOutputReserve);
    const priceImpact = Math.abs(newPrice - oldPrice) / oldPrice;

    // Effective price per token
    const effectivePrice = Number(bchAmount) / Number(tokensOut);

    return {
      tokensOut,
      priceImpact,
      effectivePrice,
    };
  }, []);

  // Estimate sell output
  const estimateSell = useCallback(async (
    poolAddress: string,
    sellHome: boolean,
    tokenAmount: bigint
  ) => {
    const reserveHome = 65000n;
    const reserveAway = 35000n;

    const inputReserve = sellHome ? reserveHome : reserveAway;
    const outputReserve = sellHome ? reserveAway : reserveHome;

    // CPMM formula (reversed)
    const effectiveIn = (tokenAmount * (FEE_DENOMINATOR - FEE_NUMERATOR)) / FEE_DENOMINATOR;
    const bchOut = (outputReserve * effectiveIn) / (inputReserve + effectiveIn);

    // Price impact
    const newInputReserve = inputReserve + tokenAmount;
    const newOutputReserve = outputReserve - bchOut;
    const oldPrice = Number(inputReserve) / Number(inputReserve + outputReserve);
    const newPrice = Number(newInputReserve) / Number(newInputReserve + newOutputReserve);
    const priceImpact = Math.abs(newPrice - oldPrice) / oldPrice;

    const effectivePrice = Number(bchOut) / Number(tokenAmount);

    return {
      bchOut,
      priceImpact,
      effectivePrice,
    };
  }, []);

  return {
    isSubmitting,
    lastTrade,
    buyTokens,
    sellTokens,
    estimateBuy,
    estimateSell,
  };
}

// Hook for user's token holdings
export function useTokenBalance(address: string, tokenCategory: string) {
  const [balance, setBalance] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);

  const electrum = useElectrum();

  const fetchBalance = useCallback(async () => {
    if (!address || !tokenCategory) {
      setBalance(0n);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const utxos = await electrum.getUtxos(address);

      // Sum up tokens matching the category
      let total = 0n;
      for (const utxo of utxos) {
        if (utxo.token?.category === tokenCategory) {
          total += utxo.token.amount;
        }
      }

      setBalance(total);
    } catch (e) {
      console.error('Failed to fetch token balance:', e);
    } finally {
      setIsLoading(false);
    }
  }, [address, tokenCategory, electrum]);

  return {
    balance,
    isLoading,
    refresh: fetchBalance,
  };
}

// Hook for user's positions across all matches
export function usePositions(address: string) {
  const [positions, setPositions] = useState<Array<{
    matchId: string;
    homeTokens: bigint;
    awayTokens: bigint;
    totalValue: bigint;
    unrealizedPnL: bigint;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  const electrum = useElectrum();

  const fetchPositions = useCallback(async () => {
    if (!address) {
      setPositions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const utxos = await electrum.getUtxos(address);

      // Group tokens by match
      // In production, this would cross-reference with match registry

      // For demo, return mock positions
      setPositions([
        {
          matchId: 'match-001',
          homeTokens: 5000n,
          awayTokens: 0n,
          totalValue: 7500_000n, // in satoshis
          unrealizedPnL: 250_000n,
        },
      ]);

    } catch (e) {
      console.error('Failed to fetch positions:', e);
    } finally {
      setIsLoading(false);
    }
  }, [address, electrum]);

  return {
    positions,
    isLoading,
    refresh: fetchPositions,
  };
}
