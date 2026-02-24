import { useState, useEffect, useCallback } from 'react';
import { useElectrum } from './useElectrum';
import { useBlockchain } from './useBlockchain';

export type MatchStatus = 'live' | 'halftime' | 'upcoming' | 'settled';
export type SportType = 'basketball' | 'football' | 'american_football';

export interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  sport: SportType;
  status: MatchStatus;
  // Pricing
  homePrice: number;
  awayPrice: number;
  homeOdds: number;
  awayOdds: number;
  // Reserves (in token units)
  reserveHome: bigint;
  reserveAway: bigint;
  // Pool info
  poolAddress: string;
  totalVolume: bigint;
  // Block timing
  creationBlock: number;
  halftimeBlock: number;
  finalBlock: number;
  // Scores (if revealed)
  homeScore1H?: number;
  awayScore1H?: number;
  homeScoreFinal?: number;
  awayScoreFinal?: number;
  // Token categories
  homeTokenCategory: string;
  awayTokenCategory: string;
}

interface UseMatchesReturn {
  matches: Match[];
  isLoading: boolean;
  error: string | null;
  refreshMatches: () => Promise<void>;
  getMatch: (id: string) => Match | undefined;
}

// Demo matches for development (replace with blockchain queries in production)
const DEMO_MATCHES: Match[] = [
  {
    id: 'match-001',
    homeTeam: 'Lakers',
    awayTeam: 'Warriors',
    sport: 'basketball',
    status: 'live',
    homePrice: 0.65,
    awayPrice: 0.35,
    homeOdds: 1.54,
    awayOdds: 2.86,
    reserveHome: 65000n,
    reserveAway: 35000n,
    poolAddress: 'bitcoincash:pz...',
    totalVolume: 125_000_000n,
    creationBlock: 850000,
    halftimeBlock: 850006,
    finalBlock: 850012,
    homeTokenCategory: 'a'.repeat(64),
    awayTokenCategory: 'b'.repeat(64),
  },
  {
    id: 'match-002',
    homeTeam: 'Real Madrid',
    awayTeam: 'Barcelona',
    sport: 'football',
    status: 'upcoming',
    homePrice: 0.45,
    awayPrice: 0.55,
    homeOdds: 2.22,
    awayOdds: 1.82,
    reserveHome: 45000n,
    reserveAway: 55000n,
    poolAddress: 'bitcoincash:pz...',
    totalVolume: 89_000_000n,
    creationBlock: 850020,
    halftimeBlock: 850026,
    finalBlock: 850032,
    homeTokenCategory: 'c'.repeat(64),
    awayTokenCategory: 'd'.repeat(64),
  },
  {
    id: 'match-003',
    homeTeam: 'Chiefs',
    awayTeam: 'Eagles',
    sport: 'american_football',
    status: 'halftime',
    homePrice: 0.58,
    awayPrice: 0.42,
    homeOdds: 1.72,
    awayOdds: 2.38,
    reserveHome: 58000n,
    reserveAway: 42000n,
    poolAddress: 'bitcoincash:pz...',
    totalVolume: 234_000_000n,
    creationBlock: 849990,
    halftimeBlock: 849996,
    finalBlock: 850002,
    homeScore1H: 14,
    awayScore1H: 10,
    homeTokenCategory: 'e'.repeat(64),
    awayTokenCategory: 'f'.repeat(64),
  },
];

export function useMatches(): UseMatchesReturn {
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const electrum = useElectrum();
  const { blockHeight } = useBlockchain();

  // Fetch matches from blockchain
  const fetchMatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // In production, this would:
      // 1. Query a registry contract for active pool addresses
      // 2. Fetch UTXO data for each pool
      // 3. Parse NFT commitment data to get match details
      // 4. Calculate prices from reserves

      // For development, use demo data with dynamic status based on block height
      const updatedMatches = DEMO_MATCHES.map(match => {
        let status: MatchStatus = match.status;

        if (blockHeight > 0) {
          if (blockHeight < match.halftimeBlock) {
            status = 'upcoming';
          } else if (blockHeight < match.halftimeBlock + 3) {
            status = 'live';
          } else if (blockHeight < match.finalBlock) {
            status = 'halftime';
          } else {
            status = 'settled';
          }
        }

        return { ...match, status };
      });

      setMatches(updatedMatches);
    } catch (e) {
      setError(`Failed to fetch matches: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [blockHeight]);

  // Fetch on mount and when block changes
  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  const getMatch = useCallback((id: string) => {
    return matches.find(m => m.id === id);
  }, [matches]);

  return {
    matches,
    isLoading,
    error,
    refreshMatches: fetchMatches,
    getMatch,
  };
}

// Hook for a single match with live updates
export function useMatch(matchId: string) {
  const { matches, isLoading, error, refreshMatches } = useMatches();
  const match = matches.find(m => m.id === matchId);

  return {
    match,
    isLoading,
    error,
    refresh: refreshMatches,
  };
}

// Hook for pool state (reserves, prices)
export function usePoolState(poolAddress: string) {
  const [reserveHome, setReserveHome] = useState<bigint>(0n);
  const [reserveAway, setReserveAway] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(true);

  const electrum = useElectrum();

  // Calculate prices from reserves (CPMM)
  const totalReserve = reserveHome + reserveAway;
  const priceHome = totalReserve > 0n ? Number(reserveAway) / Number(totalReserve) : 0.5;
  const priceAway = totalReserve > 0n ? Number(reserveHome) / Number(totalReserve) : 0.5;

  // Calculate expected tokens out for a given BCH input
  const calculateTokensOut = useCallback((
    bchAmount: bigint,
    buyHome: boolean,
    feeNumerator: bigint = 30n,
    feeDenominator: bigint = 10000n
  ): bigint => {
    const inputReserve = buyHome ? reserveAway : reserveHome;
    const outputReserve = buyHome ? reserveHome : reserveAway;

    if (outputReserve === 0n) return 0n;

    const effectiveIn = (bchAmount * (feeDenominator - feeNumerator)) / feeDenominator;
    const tokensOut = (outputReserve * effectiveIn) / (inputReserve + effectiveIn);

    return tokensOut;
  }, [reserveHome, reserveAway]);

  // Calculate price impact
  const calculatePriceImpact = useCallback((
    bchAmount: bigint,
    buyHome: boolean
  ): number => {
    const tokensOut = calculateTokensOut(bchAmount, buyHome);
    if (tokensOut === 0n) return 0;

    // New reserves after trade
    const newReserveHome = buyHome
      ? reserveHome - tokensOut
      : reserveHome + bchAmount;
    const newReserveAway = buyHome
      ? reserveAway + bchAmount
      : reserveAway - tokensOut;

    const newTotal = newReserveHome + newReserveAway;
    const newPrice = buyHome
      ? Number(newReserveAway) / Number(newTotal)
      : Number(newReserveHome) / Number(newTotal);

    const oldPrice = buyHome ? priceHome : priceAway;
    return Math.abs(newPrice - oldPrice) / oldPrice;
  }, [reserveHome, reserveAway, priceHome, priceAway, calculateTokensOut]);

  // Fetch pool UTXO and parse reserves
  const fetchPoolState = useCallback(async () => {
    setIsLoading(true);

    try {
      // In production, fetch the pool UTXO and parse the NFT commitment
      // The commitment contains the match state including reserves

      const utxos = await electrum.getUtxos(poolAddress);

      // Find the pool UTXO (has NFT with minting capability)
      const poolUtxo = utxos.find(u =>
        u.token?.nft?.capability === 'minting'
      );

      if (poolUtxo && poolUtxo.token) {
        // Parse commitment to extract reserves
        // Commitment format: matchId(16) + state(1) + reserveHome(8) + reserveAway(8) + scores(8)
        const commitment = poolUtxo.token.nft?.commitment || '';

        if (commitment.length >= 50) {
          // Extract reserves from commitment (bytes 17-32)
          const reserveHomeHex = commitment.slice(34, 50);
          const reserveAwayHex = commitment.slice(50, 66);

          setReserveHome(BigInt('0x' + reverseHex(reserveHomeHex)));
          setReserveAway(BigInt('0x' + reverseHex(reserveAwayHex)));
        }
      }
    } catch (e) {
      console.error('Failed to fetch pool state:', e);
    } finally {
      setIsLoading(false);
    }
  }, [poolAddress, electrum]);

  useEffect(() => {
    if (poolAddress) {
      fetchPoolState();
    }
  }, [poolAddress, fetchPoolState]);

  return {
    reserveHome,
    reserveAway,
    priceHome,
    priceAway,
    oddsHome: priceHome > 0 ? 1 / priceHome : 0,
    oddsAway: priceAway > 0 ? 1 / priceAway : 0,
    isLoading,
    calculateTokensOut,
    calculatePriceImpact,
    refresh: fetchPoolState,
  };
}

// Helper to reverse hex bytes
function reverseHex(hex: string): string {
  const bytes = hex.match(/.{2}/g);
  if (!bytes) return hex;
  return bytes.reverse().join('');
}
