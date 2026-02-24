import { useState } from 'react';
import { ArrowDownUp, Info, TrendingUp, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@/hooks/useWallet';

interface TradingPanelProps {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  homePrice: number;
  awayPrice: number;
  reserveHome: bigint;
  reserveAway: bigint;
}

type Side = 'home' | 'away';
type Action = 'buy' | 'sell';

export function TradingPanel({
  matchId,
  homeTeam,
  awayTeam,
  homePrice,
  awayPrice,
  reserveHome,
  reserveAway,
}: TradingPanelProps) {
  const { isConnected, connect, balance } = useWallet();
  const [side, setSide] = useState<Side>('home');
  const [action, setAction] = useState<Action>('buy');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentPrice = side === 'home' ? homePrice : awayPrice;
  const odds = 1 / currentPrice;

  // Calculate estimated tokens
  const bchAmount = parseFloat(amount) || 0;
  const estimatedTokens = bchAmount > 0 ? bchAmount / currentPrice : 0;

  // Calculate price impact (simplified)
  const priceImpact = bchAmount > 0 ? Math.min(bchAmount * 0.01, 0.1) : 0;

  // Potential profit if win
  const potentialProfit = estimatedTokens * (1 - currentPrice);

  const handleSubmit = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: Implement actual trading logic
      console.log('Trading:', { matchId, side, action, amount });
      await new Promise(resolve => setTimeout(resolve, 2000));
      setAmount('');
    } catch (error) {
      console.error('Trade failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const setPercentage = (percent: number) => {
    const maxBch = Number(balance) / 100_000_000;
    setAmount((maxBch * percent).toFixed(4));
  };

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Header Tabs */}
      <div className="flex border-b border-slate-800">
        <button
          onClick={() => setAction('buy')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            action === 'buy'
              ? 'text-win-400 border-b-2 border-win-400 bg-win-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setAction('sell')}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            action === 'sell'
              ? 'text-lose-400 border-b-2 border-lose-400 bg-lose-500/10'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Sell
        </button>
      </div>

      <div className="p-5">
        {/* Side Selection */}
        <div className="mb-5">
          <label className="block text-sm text-slate-400 mb-2">Outcome</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSide('home')}
              className={`py-3 px-4 rounded-xl border-2 transition-all ${
                side === 'home'
                  ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="text-sm opacity-70 mb-0.5">{homeTeam}</div>
              <div className="text-lg font-bold">{odds.toFixed(2)}x</div>
            </button>
            <button
              onClick={() => setSide('away')}
              className={`py-3 px-4 rounded-xl border-2 transition-all ${
                side === 'away'
                  ? 'border-accent-500 bg-accent-500/10 text-accent-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="text-sm opacity-70 mb-0.5">{awayTeam}</div>
              <div className="text-lg font-bold">{(1 / awayPrice).toFixed(2)}x</div>
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm text-slate-400">Amount</label>
            {isConnected && (
              <span className="text-xs text-slate-500">
                Balance: {(Number(balance) / 100_000_000).toFixed(4)} BCH
              </span>
            )}
          </div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="input pr-16 text-lg"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 font-medium">
              BCH
            </span>
          </div>

          {/* Quick amounts */}
          {isConnected && (
            <div className="flex gap-2 mt-2">
              {[0.1, 0.25, 0.5, 1].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setPercentage(pct)}
                  className="flex-1 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  {pct * 100}%
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Trade Details */}
        <AnimatePresence>
          {bchAmount > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-5 space-y-3 text-sm"
            >
              <div className="flex items-center justify-between py-2 border-b border-slate-800/50">
                <span className="text-slate-400">Est. Tokens</span>
                <span className="text-slate-200 font-medium">
                  {estimatedTokens.toFixed(2)} {side === 'home' ? 'HOME' : 'AWAY'}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-800/50">
                <span className="text-slate-400">Price</span>
                <span className="text-slate-200">
                  {(currentPrice * 100).toFixed(1)}% ({odds.toFixed(2)}x)
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-800/50">
                <div className="flex items-center gap-1 text-slate-400">
                  <span>Price Impact</span>
                  <Info className="w-3.5 h-3.5" />
                </div>
                <span className={priceImpact > 0.05 ? 'text-amber-400' : 'text-slate-200'}>
                  {(priceImpact * 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-400">Potential Profit</span>
                <span className="text-win-400 font-medium">
                  +{potentialProfit.toFixed(4)} BCH
                </span>
              </div>

              {priceImpact > 0.05 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    High price impact. Consider reducing your trade size.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || (!isConnected && false) || (isConnected && bchAmount <= 0)}
          className={`w-full py-4 rounded-xl font-medium text-lg transition-all ${
            action === 'buy'
              ? 'btn-success'
              : 'btn-danger'
          }`}
        >
          {isSubmitting ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </div>
          ) : !isConnected ? (
            'Connect Wallet'
          ) : bchAmount <= 0 ? (
            'Enter Amount'
          ) : (
            `${action === 'buy' ? 'Buy' : 'Sell'} ${side === 'home' ? homeTeam : awayTeam}`
          )}
        </button>

        {/* Info */}
        <p className="text-xs text-slate-500 text-center mt-4">
          Trade executes instantly via AMM. 0.3% fee applies.
        </p>
      </div>
    </div>
  );
}
