import { ArrowLeft, Clock, Activity, Users, BarChart3, ExternalLink, RefreshCw } from 'lucide-react';
import { useMatch } from '../hooks/useMatches';
import { TradingPanel } from '../components/TradingPanel';
import { useRouter } from '../router';

// ---------------------------------------------------------------------------
// Mini probability history chart (sparkline)
// ---------------------------------------------------------------------------
function ProbSparkline({ prob, color }: { prob: number; color: string }) {
  // Simulated history: random walk anchored to current prob
  const points = Array.from({ length: 20 }, (_, i) => {
    const noise = (Math.sin(i * 2.3) + Math.cos(i * 1.7)) * 0.05;
    return Math.max(0.05, Math.min(0.95, prob + noise * (1 - i / 20)));
  }).reverse();
  points[points.length - 1] = prob;

  const w = 200;
  const h = 40;
  const pts = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - p * h}`).join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full h-10">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const STATUS = {
  live:     { label: '● Live Trading',  cls: 'bg-win-500/15 text-win-400 border-win-500/30' },
  halftime: { label: '⏸ Halftime',      cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  upcoming: { label: '◷ Upcoming',      cls: 'bg-primary-500/15 text-primary-400 border-primary-500/30' },
  settled:  { label: '✓ Settled',       cls: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

const SPORT_ICON: Record<string, string> = {
  basketball: '🏀', football: '⚽', american_football: '🏈',
};

// ---------------------------------------------------------------------------
// MarketDetailPage
// ---------------------------------------------------------------------------
export function MarketDetailPage({ matchId }: { matchId: string }) {
  const { navigate } = useRouter();
  const { match, isLoading } = useMatch(matchId);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="glass rounded-2xl h-96 animate-pulse" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-16 text-center">
        <p className="text-slate-400 text-lg mb-4">Market not found.</p>
        <button onClick={() => navigate({ page: 'markets' })} className="btn-primary">
          Back to Markets
        </button>
      </div>
    );
  }

  const st = STATUS[match.status] ?? STATUS['upcoming'];
  const sportIcon = SPORT_ICON[match.sport] ?? '🏆';
  const volumeBch = (Number(match.totalVolume) / 100_000_000).toFixed(2);
  const hasScore = match.homeScore1H !== undefined || match.homeScoreFinal !== undefined;
  const scoreLabel = match.homeScoreFinal !== undefined
    ? `${match.homeScoreFinal} – ${match.awayScoreFinal} (FT)`
    : match.homeScore1H !== undefined
    ? `${match.homeScore1H} – ${match.awayScore1H} (HT)`
    : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* ---------------------------------------------------------------- */}
      {/* Back + crumb                                                       */}
      {/* ---------------------------------------------------------------- */}
      <button
        onClick={() => navigate({ page: 'markets' })}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 transition-colors mb-6 group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        Back to Markets
      </button>

      {/* ---------------------------------------------------------------- */}
      {/* Match header                                                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="glass rounded-2xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Left: teams */}
          <div className="flex items-center gap-5">
            <div className="text-5xl">{sportIcon}</div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className={`badge border text-xs px-2.5 py-1 ${st.cls}`}>{st.label}</span>
                {hasScore && scoreLabel && (
                  <span className="text-sm font-bold text-slate-200 bg-slate-800 px-3 py-0.5 rounded-full">
                    {scoreLabel}
                  </span>
                )}
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-slate-100">
                {match.homeTeam} <span className="text-slate-500 mx-2">vs</span> {match.awayTeam}
              </h1>
              <p className="text-slate-500 text-sm mt-1 capitalize">
                {match.sport.replace('_', ' ')} · Pool: {match.poolAddress.slice(0, 20)}…
              </p>
            </div>
          </div>

          {/* Right: quick stats */}
          <div className="flex gap-6 flex-shrink-0">
            <div className="text-center">
              <div className="text-xl font-bold text-slate-100">{volumeBch} BCH</div>
              <div className="text-xs text-slate-500 mt-0.5">Volume</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-slate-100">{match.halftimeBlock}</div>
              <div className="text-xs text-slate-500 mt-0.5">HT Block</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-primary-400">0.3%</div>
              <div className="text-xs text-slate-500 mt-0.5">Fee</div>
            </div>
          </div>
        </div>

        {/* Probability bar */}
        <div className="mt-6">
          <div className="flex justify-between text-sm mb-2">
            <div>
              <span className="font-semibold text-win-400">{(match.homePrice * 100).toFixed(1)}%</span>
              <span className="text-slate-500 ml-1.5">{match.homeTeam}</span>
            </div>
            <div className="text-slate-500 text-xs self-center">implied probability</div>
            <div>
              <span className="text-slate-500 mr-1.5">{match.awayTeam}</span>
              <span className="font-semibold text-lose-400">{(match.awayPrice * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div className="relative h-3 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-win-600 to-win-400 transition-all duration-700"
              style={{ width: `${match.homePrice * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Two-column layout: charts + trading panel                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left 2/3: market info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Outcome cards */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Home outcome */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Home Win</div>
                  <div className="text-lg font-bold text-slate-100">{match.homeTeam}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-win-400">{(match.homePrice * 100).toFixed(0)}¢</div>
                  <div className="text-xs text-slate-500">{match.homeOdds.toFixed(2)}x odds</div>
                </div>
              </div>
              <ProbSparkline prob={match.homePrice} color="#22c55e" />
              <div className="mt-3 text-xs text-slate-500">
                Reserve: {(Number(match.reserveHome) / 1_000_000).toFixed(1)}M sats
              </div>
            </div>

            {/* Away outcome */}
            <div className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Away Win</div>
                  <div className="text-lg font-bold text-slate-100">{match.awayTeam}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-lose-400">{(match.awayPrice * 100).toFixed(0)}¢</div>
                  <div className="text-xs text-slate-500">{match.awayOdds.toFixed(2)}x odds</div>
                </div>
              </div>
              <ProbSparkline prob={match.awayPrice} color="#ef4444" />
              <div className="mt-3 text-xs text-slate-500">
                Reserve: {(Number(match.reserveAway) / 1_000_000).toFixed(1)}M sats
              </div>
            </div>
          </div>

          {/* Market stats */}
          <div className="glass rounded-2xl p-6">
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary-400" />
              Market Details
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Volume', value: `${volumeBch} BCH`, icon: Activity },
                { label: 'Halftime Block', value: match.halftimeBlock.toLocaleString(), icon: Clock },
                { label: 'Halftime Block', value: match.halftimeBlock.toLocaleString(), icon: Clock },
                { label: 'Final Block', value: match.finalBlock.toLocaleString(), icon: Clock },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="text-center p-3 bg-slate-800/30 rounded-xl">
                  <Icon className="w-4 h-4 text-slate-500 mx-auto mb-1.5" />
                  <div className="text-sm font-semibold text-slate-200">{value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* VRF explanation */}
          <div className="glass rounded-2xl p-6 border-l-2 border-primary-500/50">
            <h3 className="font-semibold text-slate-200 mb-2 flex items-center gap-2">
              🔐 Trustless VRF Settlement
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Scores are derived from block hashes at blocks {match.halftimeBlock}–{match.halftimeBlock + 2} (halftime)
              and {match.finalBlock}–{match.finalBlock + 2} (final). The oracle committed to the randomness before
              trading opened — no manipulation possible. Anyone can verify the outcome on-chain.
            </p>
            <a
              href={`https://chipnet.chaingraph.cash/address/${match.poolAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-3 text-xs text-primary-400 hover:text-primary-300 transition-colors"
            >
              View pool on explorer <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Right 1/3: trading panel */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            <TradingPanel
              matchId={match.id}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              homePrice={match.homePrice}
              awayPrice={match.awayPrice}
              reserveHome={match.reserveHome}
              reserveAway={match.reserveAway}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
