import { Layout } from './components/Layout';
import { MatchCard, Match } from './components/MatchCard';
import { TrendingUp, Zap, Shield, Clock } from 'lucide-react';
import { WalletProvider } from './hooks/useWallet';

// Demo matches data
const demoMatches: Match[] = [
  {
    id: '1',
    homeTeam: 'Lakers',
    awayTeam: 'Warriors',
    homeOdds: 0.55,
    awayOdds: 0.45,
    volume: '12.5',
    traders: 47,
    status: 'trading',
    timeRemaining: '45m',
    sport: 'basketball',
  },
  {
    id: '2',
    homeTeam: 'Chiefs',
    awayTeam: 'Eagles',
    homeOdds: 0.48,
    awayOdds: 0.52,
    volume: '8.2',
    traders: 31,
    status: 'trading',
    timeRemaining: '1h 20m',
    sport: 'american-football',
  },
  {
    id: '3',
    homeTeam: 'Barcelona',
    awayTeam: 'Real Madrid',
    homeOdds: 0.42,
    awayOdds: 0.58,
    volume: '5.8',
    traders: 23,
    status: 'halftime',
    homeScore: 1,
    awayScore: 2,
    sport: 'football',
  },
  {
    id: '4',
    homeTeam: 'Celtics',
    awayTeam: 'Heat',
    homeOdds: 0.62,
    awayOdds: 0.38,
    volume: '15.3',
    traders: 58,
    status: 'final',
    homeScore: 108,
    awayScore: 95,
    sport: 'basketball',
  },
];

const stats = [
  { label: 'Total Volume', value: '156.8 BCH', icon: TrendingUp },
  { label: 'Active Markets', value: '12', icon: Zap },
  { label: 'Unique Traders', value: '234', icon: Shield },
  { label: 'Avg Settlement', value: '< 1 block', icon: Clock },
];

function HomePage() {
  return (
    <div className="space-y-8">
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
            {demoMatches.filter(m => m.status === 'trading').length} active
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          {demoMatches.filter(m => m.status === 'trading' || m.status === 'halftime').map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </div>

      {/* Recent Settlements */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 mb-4">Recent Settlements</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {demoMatches.filter(m => m.status === 'final').map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
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
    <WalletProvider>
      <Layout>
        <HomePage />
      </Layout>
    </WalletProvider>
  );
}

export default App;
