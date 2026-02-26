import { Trophy, TrendingUp, Medal } from 'lucide-react';

// ---------------------------------------------------------------------------
// Demo leaderboard data
// ---------------------------------------------------------------------------
const LEADERBOARD = [
  { rank: 1, address: 'bitcoincash:qz2g7h…3h4j', trades: 47, winRate: 0.74, pnl: 8.43 },
  { rank: 2, address: 'bitcoincash:qq9f2k…7p2q', trades: 31, winRate: 0.68, pnl: 5.21 },
  { rank: 3, address: 'bitcoincash:qr5m1n…4k8l', trades: 63, winRate: 0.62, pnl: 4.87 },
  { rank: 4, address: 'bitcoincash:qs8p3q…1d5e', trades: 22, winRate: 0.72, pnl: 3.14 },
  { rank: 5, address: 'bitcoincash:qt1r4s…9b2c', trades: 18, winRate: 0.61, pnl: 2.90 },
  { rank: 6, address: 'bitcoincash:qu4t5u…6a7b', trades: 55, winRate: 0.56, pnl: 1.88 },
  { rank: 7, address: 'bitcoincash:qv7u6v…3c4d', trades: 12, winRate: 0.83, pnl: 1.42 },
  { rank: 8, address: 'bitcoincash:qw0v7w…0e1f', trades: 39, winRate: 0.51, pnl: 0.97 },
  { rank: 9, address: 'bitcoincash:qx3w8x…7g8h', trades: 8,  winRate: 0.75, pnl: 0.61 },
  { rank: 10, address: 'bitcoincash:qy6x9y…4i5j', trades: 27, winRate: 0.48, pnl: 0.34 },
];

const RANK_COLORS = ['text-amber-400', 'text-slate-300', 'text-amber-600'];
const RANK_ICONS = [
  <Trophy className="w-4 h-4 text-amber-400" />,
  <Medal className="w-4 h-4 text-slate-300" />,
  <Medal className="w-4 h-4 text-amber-600" />,
];

export function LeaderboardPage() {
  const top3 = LEADERBOARD.slice(0, 3);
  const rest = LEADERBOARD.slice(3);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-100 mb-1">Leaderboard</h1>
        <p className="text-slate-400">Top traders by P&L on SportsBet.cash chipnet.</p>
      </div>

      {/* Top 3 podium */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[top3[1], top3[0], top3[2]].map((entry, i) => {
          // Display order: 2nd, 1st, 3rd
          const displayRank = [2, 1, 3][i];
          const isFirst = displayRank === 1;
          return (
            <div
              key={entry.rank}
              className={`glass rounded-2xl p-5 text-center flex flex-col items-center ${isFirst ? 'ring-1 ring-amber-400/30 scale-105' : ''}`}
            >
              <div className="text-3xl mb-2">{isFirst ? '🥇' : displayRank === 2 ? '🥈' : '🥉'}</div>
              <div className="font-mono text-xs text-slate-400 truncate w-full text-center mb-2">
                {entry.address.slice(12, 22)}…
              </div>
              <div className={`text-xl font-bold ${RANK_COLORS[displayRank - 1]}`}>
                +{entry.pnl.toFixed(2)} BCH
              </div>
              <div className="text-xs text-slate-500 mt-1">{(entry.winRate * 100).toFixed(0)}% win rate</div>
            </div>
          );
        })}
      </div>

      {/* Full table */}
      <div className="glass rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-12 gap-2 px-5 py-3 text-xs font-medium uppercase tracking-wider text-slate-500 border-b border-slate-800">
          <div className="col-span-1">#</div>
          <div className="col-span-5">Trader</div>
          <div className="col-span-2 text-right">Trades</div>
          <div className="col-span-2 text-right">Win Rate</div>
          <div className="col-span-2 text-right">P&L (BCH)</div>
        </div>

        {LEADERBOARD.map((entry) => (
          <div
            key={entry.rank}
            className="grid grid-cols-12 gap-2 px-5 py-4 items-center border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20 transition-colors"
          >
            <div className={`col-span-1 font-bold ${entry.rank <= 3 ? RANK_COLORS[entry.rank - 1] : 'text-slate-500'}`}>
              {entry.rank <= 3
                ? RANK_ICONS[entry.rank - 1]
                : <span className="text-sm">{entry.rank}</span>}
            </div>
            <div className="col-span-5 font-mono text-sm text-slate-300 truncate">
              {entry.address}
            </div>
            <div className="col-span-2 text-right text-sm text-slate-400">{entry.trades}</div>
            <div className="col-span-2 text-right text-sm">
              <span className={entry.winRate >= 0.6 ? 'text-win-400' : 'text-slate-400'}>
                {(entry.winRate * 100).toFixed(0)}%
              </span>
            </div>
            <div className="col-span-2 text-right text-sm font-semibold">
              <div className="flex items-center justify-end gap-1 text-win-400">
                <TrendingUp className="w-3 h-3" />
                +{entry.pnl.toFixed(2)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-slate-600 mt-6">
        Leaderboard resets each season · Chipnet testnet data only
      </p>
    </div>
  );
}
