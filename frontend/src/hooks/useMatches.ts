import { useState, useEffect, useCallback, useRef } from 'react';
import { useElectrum } from './useElectrum';
import { useBlockchain } from './useBlockchain';
import {
  parseCommitment,
  calcTokensOut,
  calcBchOut,
  calcPriceImpact,
  POOL_STATE,
  type ParsedPoolState,
  type ElectrumUTXO,
} from '../lib/contractService';

// ─── Public types ─────────────────────────────────────────────────────────────

export type MatchStatus = 'upcoming' | 'live' | 'halftime' | 'settled';
export type SportType   = 'basketball' | 'football' | 'american_football';

const SPORT_TYPE_MAP: Record<number, SportType> = {
  0: 'basketball',
  1: 'football',
  2: 'american_football',
};

export interface Match {
  id: string;               // matchId hex from commitment
  homeTeam: string;         // derived from matchId (first 4 hex chars) or registry
  awayTeam: string;
  sport: SportType;
  status: MatchStatus;
  homePrice: number;        // 0-1 implied probability
  awayPrice: number;
  homeOdds: number;         // decimal odds
  awayOdds: number;
  reserveHome: bigint;      // sats
  reserveAway: bigint;
  poolAddress: string;
  totalVolume: bigint;      // pool BCH balance in sats
  halftimeBlock: number;
  finalBlock: number;
  homeScore1H?: number;
  awayScore1H?: number;
  homeScoreFinal?: number;
  awayScoreFinal?: number;
  homeTokenCategory: string; // 32-byte hex (from the pool's NFT category)
  awayTokenCategory: string;
  // raw for trading
  poolUtxo: ElectrumUTXO;
  poolState: ParsedPoolState;
}

interface UseMatchesReturn {
  matches: Match[];
  isLoading: boolean;
  error: string | null;
  refreshMatches: () => Promise<void>;
  getMatch: (id: string) => Match | undefined;
}

// ─── Pool registry ────────────────────────────────────────────────────────────
// Pool addresses are written here after deployment (scripts/deploy.ts prints them).
// Alternatively, a registry contract address can be queried for all active pools.

const POOL_REGISTRY: Array<{
  poolAddress: string;
  homeTokenCategory: string;
  awayTokenCategory: string;
}> = (import.meta.env.VITE_POOL_REGISTRY
  ? JSON.parse(import.meta.env.VITE_POOL_REGISTRY)
  : []);

// ─── State → status mapping ───────────────────────────────────────────────────

function contractStateToStatus(state: number): MatchStatus {
  switch (state) {
    case POOL_STATE.TRADING:          return 'live';
    case POOL_STATE.HALFTIME_PENDING: return 'live';
    case POOL_STATE.HALFTIME_TRADING: return 'halftime';
    case POOL_STATE.FINAL_PENDING:    return 'halftime';
    case POOL_STATE.SETTLED:          return 'settled';
    default:                          return 'upcoming';
  }
}

// ─── Parse a single pool UTXO into a Match ───────────────────────────────────

function poolUtxoToMatch(
  utxo: ElectrumUTXO,
  poolAddress: string,
  homeTokenCategory: string,
  awayTokenCategory: string,
  poolSatoshis: bigint,
): Match | null {
  if (!utxo.token?.nft?.commitment) return null;

  let parsed: ParsedPoolState;
  try {
    parsed = parseCommitment(utxo.token.nft.commitment);
  } catch {
    return null;
  }

  const status = contractStateToStatus(parsed.state);
  const sport  = SPORT_TYPE_MAP[parsed.sportType] ?? 'basketball';

  const hasHalftimeScores = parsed.scores.home1H > 0 || parsed.scores.away1H > 0;
  const hasFinalScores    = parsed.scores.homeFinal > 0 || parsed.scores.awayFinal > 0;

  // Team labels: use first/last 4 chars of matchId as placeholder (no team data in commitment)
  const homeTeam = parsed.matchId.slice(0, 4).toUpperCase();
  const awayTeam = parsed.matchId.slice(4, 8).toUpperCase();

  return {
    id:               parsed.matchId,
    homeTeam,
    awayTeam,
    sport,
    status,
    homePrice:        parsed.priceHome,
    awayPrice:        parsed.priceAway,
    homeOdds:         parsed.priceHome > 0 ? 1 / parsed.priceHome : 0,
    awayOdds:         parsed.priceAway > 0 ? 1 / parsed.priceAway : 0,
    reserveHome:      parsed.reserveHome,
    reserveAway:      parsed.reserveAway,
    poolAddress,
    totalVolume:      poolSatoshis,
    halftimeBlock:    parsed.halftimeBlock,
    finalBlock:       parsed.endBlock,
    homeScore1H:      hasHalftimeScores ? parsed.scores.home1H : undefined,
    awayScore1H:      hasHalftimeScores ? parsed.scores.away1H : undefined,
    homeScoreFinal:   hasFinalScores    ? parsed.scores.homeFinal : undefined,
    awayScoreFinal:   hasFinalScores    ? parsed.scores.awayFinal : undefined,
    homeTokenCategory,
    awayTokenCategory,
    poolUtxo:         utxo,
    poolState:        parsed,
  };
}

// ─── useMatches hook ──────────────────────────────────────────────────────────

export function useMatches(): UseMatchesReturn {
  const [matches, setMatches]   = useState<Match[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const electrum = useElectrum();
  const { blockHeight } = useBlockchain();
  const lastBlockRef = useRef<number>(0);

  const fetchMatches = useCallback(async () => {
    if (POOL_REGISTRY.length === 0) {
      // No pools registered yet — show empty state, not an error
      setMatches([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results: Match[] = [];

      await Promise.all(
        POOL_REGISTRY.map(async ({ poolAddress, homeTokenCategory, awayTokenCategory }) => {
          try {
            const utxos = await electrum.getUtxos(poolAddress);

            // The pool's state is in the UTXO that holds the minting-capability NFT
            const poolUtxo = utxos.find(u => u.token?.nft?.capability === 'minting');
            if (!poolUtxo) return;

            const poolSatoshis = utxos.reduce((sum, u) => sum + u.satoshis, 0n);

            const match = poolUtxoToMatch(
              poolUtxo,
              poolAddress,
              homeTokenCategory,
              awayTokenCategory,
              poolSatoshis,
            );
            if (match) results.push(match);
          } catch (e) {
            console.warn(`Failed to fetch pool ${poolAddress}:`, e);
          }
        })
      );

      // Sort: live first, then halftime, upcoming, settled
      const ORDER: Record<MatchStatus, number> = { live: 0, halftime: 1, upcoming: 2, settled: 3 };
      results.sort((a, b) => ORDER[a.status] - ORDER[b.status]);

      setMatches(results);
    } catch (e) {
      setError(`Failed to fetch matches: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [electrum]);

  // Fetch on mount
  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  // Refresh whenever a new block arrives (re-check pool states)
  useEffect(() => {
    if (blockHeight > 0 && blockHeight !== lastBlockRef.current) {
      lastBlockRef.current = blockHeight;
      fetchMatches();
    }
  }, [blockHeight, fetchMatches]);

  const getMatch = useCallback(
    (id: string) => matches.find(m => m.id === id),
    [matches],
  );

  return { matches, isLoading, error, refreshMatches: fetchMatches, getMatch };
}

// ─── useMatch (single match with live subscription) ───────────────────────────

export function useMatch(matchId: string) {
  const { matches, isLoading, error, refreshMatches } = useMatches();
  const match = matches.find(m => m.id === matchId);
  const electrum = useElectrum();

  // Subscribe to pool address for real-time updates
  useEffect(() => {
    if (!match?.poolAddress) return;
    electrum.subscribeToAddress(match.poolAddress, refreshMatches).catch(() => {});
  }, [match?.poolAddress, electrum, refreshMatches]);

  return { match, isLoading, error, refresh: refreshMatches };
}

// ─── usePoolState (live reserves + quote helpers for a single pool) ───────────

export function usePoolState(poolAddress: string) {
  const { matches } = useMatches();
  const match = matches.find(m => m.poolAddress === poolAddress);

  const reserveHome = match?.reserveHome ?? 0n;
  const reserveAway = match?.reserveAway ?? 0n;
  const priceHome   = match?.homePrice ?? 0.5;
  const priceAway   = match?.awayPrice ?? 0.5;

  const calculateTokensOut = useCallback(
    (bchAmount: bigint, buyHome: boolean): bigint => {
      const rt = buyHome ? reserveHome : reserveAway;
      const ro = buyHome ? reserveAway : reserveHome;
      return calcTokensOut(bchAmount, rt, ro);
    },
    [reserveHome, reserveAway],
  );

  const calculateBchOut = useCallback(
    (tokenAmount: bigint, sellHome: boolean): bigint => {
      const rt = sellHome ? reserveHome : reserveAway;
      const ro = sellHome ? reserveAway : reserveHome;
      return calcBchOut(tokenAmount, rt, ro);
    },
    [reserveHome, reserveAway],
  );

  const calculatePriceImpact = useCallback(
    (amount: bigint, isBuy: boolean, forHome: boolean): number => {
      const rt = forHome ? reserveHome : reserveAway;
      const ro = forHome ? reserveAway : reserveHome;
      return calcPriceImpact(amount, rt, ro, isBuy);
    },
    [reserveHome, reserveAway],
  );

  return {
    reserveHome,
    reserveAway,
    priceHome,
    priceAway,
    oddsHome: priceHome > 0 ? 1 / priceHome : 0,
    oddsAway: priceAway > 0 ? 1 / priceAway : 0,
    isLoading: !match,
    calculateTokensOut,
    calculateBchOut,
    calculatePriceImpact,
  };
}
