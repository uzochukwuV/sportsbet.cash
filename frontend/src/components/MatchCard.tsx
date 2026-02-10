import { Clock, Users, TrendingUp, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeOdds: number;
  awayOdds: number;
  volume: string;
  traders: number;
  status: 'trading' | 'halftime' | 'final' | 'upcoming';
  timeRemaining?: string;
  homeScore?: number;
  awayScore?: number;
  sport: 'basketball' | 'football' | 'american-football';
}

const sportIcons: Record<string, string> = {
  basketball: '🏀',
  football: '⚽',
  'american-football': '🏈',
};

const statusColors = {
  trading: 'bg-win-500',
  halftime: 'bg-amber-500',
  final: 'bg-slate-500',
  upcoming: 'bg-primary-500',
};

const statusLabels = {
  trading: 'Live Trading',
  halftime: 'Halftime',
  final: 'Settled',
  upcoming: 'Upcoming',
};

interface MatchCardProps {
  match: Match;
  onClick?: () => void;
}

export function MatchCard({ match, onClick }: MatchCardProps) {
  const homePercent = (match.homeOdds / (match.homeOdds + match.awayOdds)) * 100;
  const awayPercent = 100 - homePercent;

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      className="glass rounded-2xl p-5 card-hover cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{sportIcons[match.sport]}</span>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[match.status]} bg-opacity-20`}>
            <div className={`w-1.5 h-1.5 rounded-full ${statusColors[match.status]} ${match.status === 'trading' ? 'animate-pulse' : ''}`} />
            <span className={statusColors[match.status].replace('bg-', 'text-')}>
              {statusLabels[match.status]}
            </span>
          </div>
        </div>
        {match.timeRemaining && (
          <div className="flex items-center gap-1.5 text-sm text-slate-400">
            <Clock className="w-4 h-4" />
            {match.timeRemaining}
          </div>
        )}
      </div>

      {/* Teams & Scores */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex-1 text-center">
          <div className="text-lg font-bold text-slate-100 mb-1">{match.homeTeam}</div>
          {match.homeScore !== undefined && (
            <div className="text-3xl font-bold text-primary-400">{match.homeScore}</div>
          )}
        </div>

        <div className="px-4">
          <div className="text-slate-600 font-medium">VS</div>
        </div>

        <div className="flex-1 text-center">
          <div className="text-lg font-bold text-slate-100 mb-1">{match.awayTeam}</div>
          {match.awayScore !== undefined && (
            <div className="text-3xl font-bold text-accent-400">{match.awayScore}</div>
          )}
        </div>
      </div>

      {/* Odds Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-primary-400 font-medium">{homePercent.toFixed(1)}%</span>
          <span className="text-slate-500">Implied Probability</span>
          <span className="text-accent-400 font-medium">{awayPercent.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${homePercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-primary-500 to-primary-400"
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${awayPercent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-accent-400 to-accent-500"
          />
        </div>
      </div>

      {/* Odds Display */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button className="py-3 px-4 rounded-xl bg-primary-500/10 border border-primary-500/30 hover:border-primary-500/60 hover:bg-primary-500/20 transition-all group">
          <div className="text-xs text-slate-400 mb-0.5">Home Win</div>
          <div className="text-lg font-bold text-primary-400 group-hover:text-primary-300">
            {(1 / match.homeOdds).toFixed(2)}x
          </div>
        </button>
        <button className="py-3 px-4 rounded-xl bg-accent-500/10 border border-accent-500/30 hover:border-accent-500/60 hover:bg-accent-500/20 transition-all group">
          <div className="text-xs text-slate-400 mb-0.5">Away Win</div>
          <div className="text-lg font-bold text-accent-400 group-hover:text-accent-300">
            {(1 / match.awayOdds).toFixed(2)}x
          </div>
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm text-slate-500 pt-3 border-t border-slate-800/50">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4" />
          <span>{match.volume} BCH</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          <span>{match.traders} traders</span>
        </div>
      </div>
    </motion.div>
  );
}
