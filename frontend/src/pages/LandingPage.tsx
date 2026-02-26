import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Zap, Shield, TrendingUp, Globe, ChevronDown, ExternalLink } from 'lucide-react';
import { Link, useRouter } from '../router';

// ---------------------------------------------------------------------------
// Animated counter
// ---------------------------------------------------------------------------
function Counter({ target, suffix = '', prefix = '' }: { target: number; suffix?: string; prefix?: string }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const duration = 1600;
        const start = Date.now();
        const tick = () => {
          const progress = Math.min((Date.now() - start) / duration, 1);
          const ease = 1 - Math.pow(1 - progress, 3);
          setValue(Math.floor(ease * target));
          if (progress < 1) requestAnimationFrame(tick);
          else setValue(target);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.2 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref}>
      {prefix}{value.toLocaleString()}{suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sport icon (emoji fallback)
// ---------------------------------------------------------------------------
const SPORT_ICONS: Record<string, string> = {
  basketball: '🏀',
  football: '⚽',
  'american-football': '🏈',
  tennis: '🎾',
};

// ---------------------------------------------------------------------------
// Demo matches for the hero preview
// ---------------------------------------------------------------------------
const DEMO_MARKETS = [
  { id: '1', home: 'Lakers', away: 'Warriors', sport: 'basketball', homeOdds: 0.58, awayOdds: 0.42, volume: '4.2', status: 'live' },
  { id: '2', home: 'Real Madrid', away: 'Barcelona', sport: 'football', homeOdds: 0.45, awayOdds: 0.55, volume: '8.7', status: 'live' },
  { id: '3', home: 'Chiefs', away: 'Eagles', sport: 'american-football', homeOdds: 0.62, awayOdds: 0.38, volume: '3.1', status: 'halftime' },
];

// ---------------------------------------------------------------------------
// Landing Page
// ---------------------------------------------------------------------------
export function LandingPage() {
  const { navigate } = useRouter();

  return (
    <div className="min-h-screen bg-slate-950 overflow-x-hidden">
      {/* ------------------------------------------------------------------ */}
      {/* HERO                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-24 pb-16">
        {/* Background glow orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary-500/10 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full bg-accent-500/10 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary-500/5 blur-3xl" />
        </div>

        {/* Badge */}
        <div className="relative mb-8 flex items-center gap-2 px-4 py-2 rounded-full border border-primary-500/30 bg-primary-500/5 text-primary-300 text-sm font-medium">
          <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
          Live on Bitcoin Cash Chipnet
          <ExternalLink className="w-3.5 h-3.5 opacity-60" />
        </div>

        {/* Headline */}
        <h1 className="relative text-center font-bold tracking-tight leading-tight">
          <span className="block text-5xl md:text-7xl lg:text-8xl text-slate-100 mb-2">Predict Sports.</span>
          <span className="block text-5xl md:text-7xl lg:text-8xl gradient-text mb-2">Win BCH.</span>
          <span className="block text-5xl md:text-7xl lg:text-8xl text-slate-100">On-Chain.</span>
        </h1>

        {/* Sub-headline */}
        <p className="relative mt-8 max-w-2xl text-center text-lg md:text-xl text-slate-400 leading-relaxed">
          The first trustless sports prediction market on Bitcoin Cash.
          Trade outcome tokens, earn from halftime price swings, and settle instantly — no oracle manipulation possible.
        </p>

        {/* CTAs */}
        <div className="relative mt-10 flex flex-col sm:flex-row gap-4 items-center">
          <button
            onClick={() => navigate({ page: 'markets' })}
            className="btn-primary text-base px-8 py-3 rounded-2xl group"
          >
            Explore Markets
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
          <a
            href="https://github.com/uuzor/sportsbet.cash"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-base px-8 py-3 rounded-2xl"
          >
            View on GitHub
          </a>
        </div>

        {/* Hero market preview cards */}
        <div className="relative mt-16 w-full max-w-3xl grid grid-cols-1 sm:grid-cols-3 gap-3">
          {DEMO_MARKETS.map((m) => (
            <button
              key={m.id}
              onClick={() => navigate({ page: 'markets' })}
              className="glass rounded-2xl p-4 text-left hover:border-primary-500/40 transition-all group"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xl">{SPORT_ICONS[m.sport]}</span>
                <span className={`badge ${m.status === 'live' ? 'badge-success' : 'badge-warning'} text-[10px]`}>
                  {m.status === 'live' ? '● LIVE' : '⏸ HALFTIME'}
                </span>
              </div>
              <div className="text-sm font-semibold text-slate-200 mb-1">{m.home} vs {m.away}</div>
              <div className="flex gap-2 mt-3">
                <div className="flex-1 bg-win-500/10 border border-win-500/20 rounded-lg px-2 py-1.5 text-center">
                  <div className="text-xs text-slate-400">Home</div>
                  <div className="text-sm font-bold text-win-400">{(m.homeOdds * 100).toFixed(0)}%</div>
                </div>
                <div className="flex-1 bg-lose-500/10 border border-lose-500/20 rounded-lg px-2 py-1.5 text-center">
                  <div className="text-xs text-slate-400">Away</div>
                  <div className="text-sm font-bold text-lose-400">{(m.awayOdds * 100).toFixed(0)}%</div>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500">{m.volume} BCH volume</div>
            </button>
          ))}
        </div>

        {/* Scroll cue */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-slate-600 animate-bounce">
          <span className="text-xs">Scroll</span>
          <ChevronDown className="w-4 h-4" />
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* STATS BAND                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-y border-slate-800/50 bg-slate-900/30 py-12 px-4">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { label: 'Total Volume', value: 142, suffix: ' BCH' },
            { label: 'Active Markets', value: 18, suffix: '' },
            { label: 'Settled Markets', value: 94, suffix: '' },
            { label: 'Avg Settlement', value: 3, suffix: ' sec' },
          ].map(({ label, value, suffix }) => (
            <div key={label}>
              <div className="text-3xl md:text-4xl font-bold gradient-text">
                <Counter target={value} suffix={suffix} />
              </div>
              <div className="text-sm text-slate-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* HOW IT WORKS                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-24 px-4 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">How it works</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Three steps from wallet to winnings. Everything happens on-chain — no sign-up, no KYC, no custody.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 relative">
          {/* Connector line (desktop only) */}
          <div className="hidden md:block absolute top-10 left-[calc(16.66%)] right-[calc(16.66%)] h-px bg-gradient-to-r from-primary-500/50 via-accent-500/50 to-win-500/50" />

          {[
            {
              step: '01',
              icon: Globe,
              color: 'primary',
              title: 'Connect & Browse',
              desc: 'Connect your BCH wallet (Cashonize, Paytaca, Zapit). Browse live matches across basketball, football, and more.',
            },
            {
              step: '02',
              icon: TrendingUp,
              color: 'accent',
              title: 'Buy Outcome Tokens',
              desc: 'Buy HOME_WIN or AWAY_WIN tokens through the AMM. Prices update in real-time as more traders enter the market.',
            },
            {
              step: '03',
              icon: Zap,
              color: 'win',
              title: 'Instant Settlement',
              desc: 'Final scores are revealed via VRF commit-reveal. Winning tokens redeem for full BCH value automatically.',
            },
          ].map(({ step, icon: Icon, color, title, desc }) => (
            <div key={step} className="relative glass rounded-2xl p-8 text-center">
              <div className={`w-16 h-16 rounded-2xl bg-${color}-500/10 border border-${color}-500/20 flex items-center justify-center mx-auto mb-6`}>
                <Icon className={`w-7 h-7 text-${color}-400`} />
              </div>
              <div className={`text-xs font-bold tracking-widest text-${color}-400 mb-2`}>STEP {step}</div>
              <h3 className="text-lg font-bold text-slate-100 mb-3">{title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* WHY SPORTSBET.CASH                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-24 px-4 bg-slate-900/20 border-y border-slate-800/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">Why SportsBet.cash?</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Built differently from every other sports betting platform.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                icon: Shield,
                title: 'Trustless VRF Scores',
                desc: 'Oracle commits to randomness before betting starts. Anyone can verify the result matches the commitment — manipulation is cryptographically impossible.',
                tag: 'Security',
              },
              {
                icon: TrendingUp,
                title: 'AMM Price Discovery',
                desc: 'No order book. No market makers. A Constant Product Market Maker sets prices based purely on supply and demand — like Uniswap, for sports.',
                tag: 'DeFi',
              },
              {
                icon: Zap,
                title: 'Halftime Trading',
                desc: 'Scores are revealed at halftime. Trade on new information mid-match. Prices update instantly. This is sports trading, not just betting.',
                tag: 'Unique',
              },
              {
                icon: Globe,
                title: 'Bitcoin Cash — Fast & Cheap',
                desc: '2.5s confirmation times. Sub-cent fees. BCH handles micro-transactions that Ethereum simply can\'t. CashTokens make it all possible.',
                tag: 'Infrastructure',
              },
            ].map(({ icon: Icon, title, desc, tag }) => (
              <div key={title} className="glass rounded-2xl p-6 flex gap-5 card-hover">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-slate-100">{title}</h3>
                    <span className="badge badge-primary text-[10px]">{tag}</span>
                  </div>
                  <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CTA BANNER                                                           */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="glass rounded-3xl p-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-accent-500/5" />
            <div className="relative">
              <div className="text-5xl mb-6">⚡</div>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4">
                Ready to trade?
              </h2>
              <p className="text-slate-400 mb-8 text-lg">
                Connect your wallet and start predicting in under 60 seconds. Live on chipnet — try it now for free.
              </p>
              <button
                onClick={() => navigate({ page: 'markets' })}
                className="btn-primary text-base px-10 py-3 rounded-2xl group"
              >
                Open Markets
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-10 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-200">SportsBet<span className="text-slate-400">.cash</span></span>
          </div>
          <div className="flex items-center gap-8 text-sm text-slate-500">
            <button onClick={() => navigate({ page: 'markets' })} className="hover:text-primary-400 transition-colors">Markets</button>
            <button onClick={() => navigate({ page: 'portfolio' })} className="hover:text-primary-400 transition-colors">Portfolio</button>
            <a href="https://github.com/uuzor/sportsbet.cash" target="_blank" rel="noopener noreferrer" className="hover:text-primary-400 transition-colors">GitHub</a>
            <span>Powered by Bitcoin Cash</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
