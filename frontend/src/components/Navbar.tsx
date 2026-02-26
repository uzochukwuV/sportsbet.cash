import { useState } from 'react';
import { Menu, X, Zap, TrendingUp, Wallet, Trophy } from 'lucide-react';
import { ConnectButton } from './ConnectButton';
import { Link, useRouter } from '../router';

const navLinks = [
  { to: { page: 'markets' } as const, label: 'Markets', icon: TrendingUp },
  { to: { page: 'portfolio' } as const, label: 'Portfolio', icon: Wallet },
  { to: { page: 'leaderboard' } as const, label: 'Leaderboard', icon: Trophy },
];

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { route } = useRouter();

  const isActive = (page: string) => route.page === page;

  return (
    <nav className="sticky top-0 z-50 glass border-b border-slate-800/50">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to={{ page: 'markets' }} className="flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/25 group-hover:shadow-primary-500/40 transition-shadow">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <span className="text-xl font-bold gradient-text">SportsBet</span>
              <span className="text-xl font-bold text-slate-300">.cash</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive(link.to.page)
                    ? 'text-primary-400 bg-primary-500/10'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                }`}
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/50">
              <div className="w-2 h-2 rounded-full bg-win-500 animate-pulse" />
              <span className="text-sm text-slate-400">Chipnet</span>
            </div>

            <ConnectButton />

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-slate-400 hover:text-slate-100"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-slate-800/50 animate-fade-in">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive(link.to.page)
                    ? 'text-primary-400 bg-primary-500/10'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                }`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <link.icon className="w-5 h-5" />
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
