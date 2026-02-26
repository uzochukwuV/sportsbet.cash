import { useState } from 'react';
import { TrendingUp, TrendingDown, Wallet, BarChart2 } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useMatches } from '../hooks/useMatches';
import { useRouter } from '../router';

// ---------------------------------------------------------------------------
// Demo positions (replace with real on-chain query in production)
// ---------------------------------------------------------------------------
const DEMO_POSITIONS = [
  { matchId: 'match-001', side: 'HOME' as const, tokens: 4_500n, avgCost: 11_000n, status: 'live' as const },
  { matchId: 'match-003', side: 'HOME' as const, tokens: 8_200n, avgCost: 10_800n, status: 'halftime' as const },
];

// ---------------------------------------------------------------------------
// P&L card
// ---------------------------------------------------------------------------
function PositionCard({
  homeTeam, awayTeam, side, tokens, avgCost, currentPrice, status, onTrade,
}: {
  homeTeam: string; awayTeam: string;
  side: 'HOME' | 'AWAY';
  tokens: bigint; avgCost: bigint;
  currentPrice: number; status: string;
  onTrade: () => void;
}) {
  const PRICE_PER_UNIT = 10_000n;
  const currentPriceSats = BigInt(Math.round(currentPrice * Number(PRICE_PER_UNIT)));
  const currentValue = tokens * currentPriceSats;
  const totalCost = tokens * avgCost;
  const pnl = currentValue - totalCost;
  const pnlPct = Number(totalCost) > 0 ? Number(pnl) / Number(totalCost) * 100 : 0;
  const isPositive = pnl >= 0n;

  const team = side === 'HOME' ? homeTeam : awayTeam;
  const bchValue = Number(currentValue) / 100_000_000;

  return (
    <div className="glass rounded-2xl p-5 card-hover">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{homeTeam} vs {awayTeam}</div>
          <div className="text-base font-semibold text-slate-100">{team} Win</div>
          <span className={`badge border text-[10px] mt-1 ${
            status === 'live' ? 'badge-success border-win-500/30' :
            status === 'halftime' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' :
            'bg-slate-500/20 text-slate-400 border-slate-500/30'
          }`}>
            {status === 'live' ? '● Live' : status === 'halftime' ? '⏸ Halftime' : '✓ Settled'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-slate-100">{bchValue.toFixed(4)} BCH</div>
          <div className={`text-sm font-medium flex items-center justify-end gap-1 mt-0.5 ${isPositive ? 'text-win-400' : 'text-lose-400'}`}>
            {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isPositive ? '+' : ''}{pnlPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm mb-4">
        <div className="bg-slate-800/40 rounded-xl p-3 text-center">
          <div className="text-slate-400 text-xs mb-1">Tokens</div>
          <div className="font-semibold text-slate-200">{Number(tokens).toLocaleString()}</div>
        </div>
        <div className="bg-slate-800/40 rounded-xl p-3 text-center">
          <div className="text-slate-400 text-xs mb-1">Avg Cost</div>
          <div className="font-semibold text-slate-200">{(Number(avgCost) / 100_000_000).toFixed(4)}</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${isPositive ? 'bg-win-500/10' : 'bg-lose-500/10'}`}>
          <div className="text-slate-400 text-xs mb-1">P&amp;L</div>
          <div className={`font-semibold ${isPositive ? 'text-win-400' : 'text-lose-400'}`}>
            {isPositive ? '+' : ''}{(Number(pnl) / 100_000_000).toFixed(4)}
          </div>
        </div>
      </div>

      <button onClick={onTrade} className="btn-secondary w-full text-sm py-2">
        Trade
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Page
// ---------------------------------------------------------------------------
export function PortfolioPage() {
  const { isConnected, address, balance, connect, isConnecting } = useWallet();
  const { matches } = useMatches();
  const { navigate } = useRouter();
  const [tab, setTab] = useState<'open' | 'history'>('open');

  const bchBalance = Number(balance) / 100_000_000;

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-24 text-center">
        <Wallet className="w-16 h-16 mx-auto text-slate-600 mb-6" />
        <h2 className="text-2xl font-bold text-slate-100 mb-3">Connect your wallet</h2>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          Connect your Bitcoin Cash wallet to view your positions, P&L, and trade history.
        </p>
        <button onClick={connect} disabled={isConnecting} className="btn-primary px-8 py-3">
          {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
      </div>
    );
  }

  // Map demo positions to match data
  const openPositions = DEMO_POSITIONS.map(pos => {
    const match = matches.find(m => m.id === pos.matchId);
    if (!match) return null;
    const currentPrice = pos.side === 'HOME' ? match.homePrice : match.awayPrice;
    return { ...pos, match, currentPrice };
  }).filter(Boolean) as NonNullable<(typeof DEMO_POSITIONS[0] & { match: typeof matches[0]; currentPrice: number })[]>;

  const totalValueSats = openPositions.reduce((sum, p) => {
    const currentPriceSats = BigInt(Math.round(p.currentPrice * 10_000));
    return sum + p.tokens * currentPriceSats;
  }, 0n);
  const totalCostSats = openPositions.reduce((sum, p) => sum + p.tokens * p.avgCost, 0n);
  const totalPnl = totalValueSats - totalCostSats;
  const totalPnlPct = Number(totalCostSats) > 0 ? Number(totalPnl) / Number(totalCostSats) * 100 : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 mb-1">Portfolio</h1>
          <p className="text-slate-500 text-sm font-mono truncate max-w-xs">{address?.slice(0, 28)}…</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'BCH Balance', value: `${bchBalance.toFixed(4)} BCH`, color: 'text-slate-100' },
          { label: 'Portfolio Value', value: `${(Number(totalValueSats) / 100_000_000).toFixed(4)} BCH`, color: 'text-primary-400' },
          { label: 'Open Positions', value: openPositions.length.toString(), color: 'text-slate-100' },
          {
            label: 'Total P&L',
            value: `${totalPnl >= 0n ? '+' : ''}${(Number(totalPnl) / 100_000_000).toFixed(4)} BCH`,
            color: totalPnl >= 0n ? 'text-win-400' : 'text-lose-400',
          },
        ].map(({ label, value, color }) => (
          <div key={label} className="glass rounded-2xl p-5 text-center">
            <div className={`text-xl font-bold ${color} mb-1`}>{value}</div>
            <div className="text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-800">
        {(['open', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'text-primary-400 border-primary-500'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            {t === 'open' ? `Open Positions (${openPositions.length})` : 'History'}
          </button>
        ))}
      </div>

      {tab === 'open' ? (
        openPositions.length === 0 ? (
          <div className="glass rounded-2xl py-20 text-center text-slate-500">
            <BarChart2 className="w-10 h-10 mx-auto mb-4 opacity-30" />
            <p className="text-lg">No open positions</p>
            <button
              onClick={() => navigate({ page: 'markets' })}
              className="btn-primary mt-6 px-6"
            >
              Browse Markets
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {openPositions.map((pos) => (
              <PositionCard
                key={`${pos.matchId}-${pos.side}`}
                homeTeam={pos.match.homeTeam}
                awayTeam={pos.match.awayTeam}
                side={pos.side}
                tokens={pos.tokens}
                avgCost={pos.avgCost}
                currentPrice={pos.currentPrice}
                status={pos.match.status}
                onTrade={() => navigate({ page: 'market', id: pos.matchId })}
              />
            ))}
          </div>
        )
      ) : (
        <div className="glass rounded-2xl py-20 text-center text-slate-500">
          <p>Trade history coming soon.</p>
        </div>
      )}
    </div>
  );
}
