import { useState, useMemo } from 'react';
import { Search, TrendingUp, Wifi, WifiOff, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { useMatches } from '../hooks/useMatches';
import { useBlockchain } from '../hooks/useBlockchain';
import { useRouter } from '../router';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type SportFilter = 'all' | 'basketball' | 'football' | 'american-football';
type SortKey = 'volume' | 'probability' | 'status';

const SPORT_LABELS: Record<SportFilter, string> = {
  all: 'All Sports',
  basketball: '🏀 Basketball',
  football: '⚽ Football',
  'american-football': '🏈 American Football',
};

const STATUS_COLORS: Record<string, string> = {
  live: 'bg-win-500/15 text-win-400 border-win-500/30',
  trading: 'bg-win-500/15 text-win-400 border-win-500/30',
  halftime: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  final: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  upcoming: 'bg-primary-500/15 text-primary-400 border-primary-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  live: '● Live',
  trading: '● Trading',
  halftime: '⏸ Halftime',
  final: '✓ Settled',
  upcoming: '◷ Upcoming',
};

function formatVolume(bch: number) {
  if (bch >= 1000) return `${(bch / 1000).toFixed(1)}k`;
  return bch.toFixed(1);
}

// ---------------------------------------------------------------------------
// Market Row — Polymarket-style horizontal card
// ---------------------------------------------------------------------------
function MarketRow({ match, onClick }: {
  match: ReturnType<typeof useMatches>['matches'][0];
  onClick: () => void;
}) {
  const statusKey = match.status === 'live' ? 'live' : match.status;
  const statusColor = STATUS_COLORS[statusKey] ?? STATUS_COLORS['upcoming'];
  const statusLabel = STATUS_LABELS[statusKey] ?? statusKey;
  const volume = Number(match.totalVolume) / 100_000_000;

  const homeProb = match.homePrice;
  const awayProb = match.awayPrice;

  const sportIcon =
    match.sport === 'basketball' ? '🏀' :
    match.sport === 'football' ? '⚽' : '🏈';

  return (
    <button
      onClick={onClick}
      className="w-full glass rounded-2xl p-5 text-left hover:border-primary-500/40 hover:bg-slate-800/30 transition-all group"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Sport icon + teams */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="text-3xl">{sportIcon}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`badge border text-[10px] px-2 py-0.5 ${statusColor}`}>{statusLabel}</span>
            </div>
            <div className="font-semibold text-slate-100 text-base truncate">
              {match.homeTeam} <span className="text-slate-500 mx-1">vs</span> {match.awayTeam}
            </div>
            {(match.homeScore1H !== undefined || match.homeScoreFinal !== undefined) && (
              <div className="text-xs text-slate-500 mt-0.5">
                Score: {match.homeScoreFinal ?? match.homeScore1H} – {match.awayScoreFinal ?? match.awayScore1H}
                {match.homeScoreFinal === undefined && ' (HT)'}
              </div>
            )}
          </div>
        </div>

        {/* Probability bar */}
        <div className="flex-1 min-w-[180px] max-w-xs">
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>{match.homeTeam.split(' ').pop()}</span>
            <span>{match.awayTeam.split(' ').pop()}</span>
          </div>
          <div className="relative h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-win-500 to-win-400 transition-all duration-500"
              style={{ width: `${homeProb * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-semibold mt-1.5">
            <span className="text-win-400">{(homeProb * 100).toFixed(0)}%</span>
            <span className="text-lose-400">{(awayProb * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Bet buttons */}
        <div className="flex gap-2 flex-shrink-0">
          <div className="px-4 py-2 bg-win-500/10 hover:bg-win-500/20 border border-win-500/30 rounded-xl text-sm font-semibold text-win-400 transition-colors min-w-[72px] text-center">
            {(homeProb * 100).toFixed(0)}¢
          </div>
          <div className="px-4 py-2 bg-lose-500/10 hover:bg-lose-500/20 border border-lose-500/30 rounded-xl text-sm font-semibold text-lose-400 transition-colors min-w-[72px] text-center">
            {(awayProb * 100).toFixed(0)}¢
          </div>
        </div>

        {/* Volume */}
        <div className="flex-shrink-0 text-right hidden lg:block min-w-[80px]">
          <div className="text-sm font-semibold text-slate-200">{formatVolume(volume)} BCH</div>
          <div className="text-xs text-slate-500">Volume</div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Markets Page
// ---------------------------------------------------------------------------
export function MarketsPage() {
  const { matches, isLoading } = useMatches();
  const { blockHeight, isConnected: chainConnected, network } = useBlockchain();
  const { navigate } = useRouter();

  const [sportFilter, setSportFilter] = useState<SportFilter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [showSettled, setShowSettled] = useState(true);

  const filtered = useMemo(() => {
    let list = matches;

    // Sport filter
    if (sportFilter !== 'all') {
      list = list.filter(m => m.sport === sportFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(m =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q)
      );
    }

    // Hide settled unless toggled
    if (!showSettled) {
      list = list.filter(m => m.status !== 'settled');
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sortKey === 'volume') {
        return Number(b.totalVolume) - Number(a.totalVolume);
      }
      if (sortKey === 'probability') {
        return Math.abs(b.homePrice - 0.5) - Math.abs(a.homePrice - 0.5);
      }
      // status: live first, then halftime, then upcoming, then settled
      const order: Record<string, number> = { live: 0, halftime: 1, upcoming: 2, settled: 3 };
      return (order[a.status] ?? 99) - (order[b.status] ?? 99);
    });

    return list;
  }, [matches, sportFilter, search, sortKey, showSettled]);

  const activeCount = matches.filter(m => m.status === 'live' || m.status === 'halftime').length;
  const totalVolumeBch = matches.reduce((s, m) => s + Number(m.totalVolume), 0) / 100_000_000;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* ---------------------------------------------------------------- */}
      {/* Header row                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 mb-1">Markets</h1>
          <p className="text-slate-400">
            <span className="text-win-400 font-semibold">{activeCount} live</span>
            {' · '}
            <span className="text-slate-300 font-semibold">{totalVolumeBch.toFixed(1)} BCH</span>
            {' total volume · '}
            <span className={chainConnected ? 'text-win-400' : 'text-slate-500'}>
              {chainConnected ? (
                <><Wifi className="inline w-3.5 h-3.5 mr-1" />{network} · #{blockHeight.toLocaleString()}</>
              ) : (
                <><WifiOff className="inline w-3.5 h-3.5 mr-1" />Connecting…</>
              )}
            </span>
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search teams…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm"
          />
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Filter / Sort bar                                                  */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        {/* Sport tabs */}
        <div className="flex rounded-xl overflow-hidden border border-slate-700/50 bg-slate-900/40">
          {(Object.keys(SPORT_LABELS) as SportFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setSportFilter(s)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                sportFilter === s
                  ? 'bg-primary-500/20 text-primary-300 border-x border-primary-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-slate-500" />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="bg-slate-900/40 border border-slate-700/50 text-slate-300 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="status">Sort: Status</option>
            <option value="volume">Sort: Volume</option>
            <option value="probability">Sort: Closest odds</option>
          </select>
        </div>

        {/* Show settled toggle */}
        <button
          onClick={() => setShowSettled(!showSettled)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition-colors ${
            showSettled
              ? 'bg-slate-700/50 border-slate-600 text-slate-200'
              : 'border-slate-700/50 text-slate-500 hover:text-slate-300'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Show Settled
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Market list                                                        */}
      {/* ---------------------------------------------------------------- */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass rounded-2xl h-24 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl py-20 text-center text-slate-500">
          <TrendingUp className="w-10 h-10 mx-auto mb-4 opacity-30" />
          <p className="text-lg">No markets found</p>
          <p className="text-sm mt-1">Try changing your filters</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column headers */}
          <div className="hidden lg:flex px-5 text-xs text-slate-600 font-medium uppercase tracking-wider gap-4">
            <div className="flex-1">Market</div>
            <div className="flex-1 min-w-[180px] max-w-xs pl-2">Probability</div>
            <div className="w-[160px]">Outcome prices</div>
            <div className="w-[80px] text-right">Volume</div>
          </div>

          {filtered.map(match => (
            <MarketRow
              key={match.id}
              match={match}
              onClick={() => navigate({ page: 'market', id: match.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
