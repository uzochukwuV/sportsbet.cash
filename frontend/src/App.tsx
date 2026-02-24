import { Layout } from './components/Layout';
import { MatchCard, Match } from './components/MatchCard';
import { TrendingUp, Zap, Shield, Clock, Wifi, WifiOff } from 'lucide-react';
import { useMatches } from './hooks/useMatches';
import { useBlockchain } from './hooks/useBlockchain';

// Map match data from hook to MatchCard format
function mapMatchToCard(match: ReturnType<typeof useMatches>['matches'][0]): Match {
  return {
    id: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeOdds: match.homePrice,
    awayOdds: match.awayPrice,
    volume: (Number(match.totalVolume) / 100_000_000).toFixed(1),
    traders: Math.floor(Math.random() * 50) + 10, // Mock for now
    status: match.status === 'live' ? 'trading' :
            match.status === 'halftime' ? 'halftime' :
            match.status === 'settled' ? 'final' : 'trading',
    timeRemaining: match.status === 'upcoming' ? '1h' : undefined,
    homeScore: match.homeScoreFinal ?? match.homeScore1H,
    awayScore: match.awayScoreFinal ?? match.awayScore1H,
    sport: match.sport === 'basketball' ? 'basketball' :
           match.sport === 'football' ? 'football' : 'american-football',
  };
}

function HomePage() {
  const { matches, isLoading } = useMatches();
  const { blockHeight, isConnected: isChainConnected, network } = useBlockchain();

  const matchCards = matches.map(mapMatchToCard);
  const activeMatches = matchCards.filter(m => m.status === 'trading' || m.status === 'halftime');
  const settledMatches = matchCards.filter(m => m.status === 'final');

  // Calculate total volume
  const totalVolume = matches.reduce((sum, m) => sum + Number(m.totalVolume), 0) / 100_000_000;

  const stats = [
    { label: 'Total Volume', value: `${totalVolume.toFixed(1)} BCH`, icon: TrendingUp },
    { label: 'Active Markets', value: activeMatches.length.toString(), icon: Zap },
    { label: 'Block Height', value: blockHeight > 0 ? blockHeight.toLocaleString() : '...', icon: Shield },
    { label: 'Network', value: network, icon: Clock },
  ];

  return (
    <div className="space-y-8">
      {/* Network Status */}
      <div className={`flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm ${
        isChainConnected ? 'bg-win-500/10 text-win-400' : 'bg-lose-500/10 text-lose-400'
      }`}>
        {isChainConnected ? (
          <>
            <Wifi className="w-4 h-4" />
            Connected to {network} · Block {blockHeight.toLocaleString()}
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            Connecting to Electrum...
          </>
        )}
      </div>

      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          <span className="gradient-text">Predict. Trade. Win.</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto">
          On-chain sports prediction markets powered by Bitcoin Cash.
          Trustless, verifiable, and instant settlement via AMM.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="glass rounded-xl p-4 text-center">
            <stat.icon className="w-6 h-6 text-primary-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-slate-100">{stat.value}</div>
            <div className="text-sm text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Live Markets */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-100">Live Markets</h2>
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="w-2 h-2 rounded-full bg-win-500 animate-pulse" />
            {activeMatches.length} active
          </div>
        </div>
        {isLoading ? (
          <div className="glass rounded-xl p-8 text-center text-slate-400">
            Loading matches...
          </div>
        ) : activeMatches.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-4">
            {activeMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          <div className="glass rounded-xl p-8 text-center text-slate-400">
            No active markets. Check back soon!
          </div>
        )}
      </div>

      {/* Recent Settlements */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 mb-4">Recent Settlements</h2>
        {settledMatches.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-4">
            {settledMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          <div className="glass rounded-xl p-8 text-center text-slate-400">
            No settled matches yet.
          </div>
        )}
      </div>

      {/* How it Works */}
      <div className="glass rounded-2xl p-8">
        <h2 className="text-2xl font-bold text-slate-100 mb-6 text-center">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-primary-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">1</span>
            </div>
            <h3 className="font-semibold text-slate-100 mb-2">Buy Outcome Tokens</h3>
            <p className="text-sm text-slate-400">
              Purchase HOME_WIN or AWAY_WIN tokens. Prices reflect market probability.
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-accent-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">2</span>
            </div>
            <h3 className="font-semibold text-slate-100 mb-2">Watch & Trade</h3>
            <p className="text-sm text-slate-400">
              Halftime scores revealed via VRF. Trade based on new information.
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-win-500/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">3</span>
            </div>
            <h3 className="font-semibold text-slate-100 mb-2">Redeem Winnings</h3>
            <p className="text-sm text-slate-400">
              Winning tokens redeem for 1 BCH each. Instant, trustless settlement.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <Layout>
      <HomePage />
    </Layout>
  );
}

export default App;
