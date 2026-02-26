import { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import { Navbar } from './Navbar';
import { Link } from '../router';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
        {children}
      </main>
      <footer className="border-t border-slate-800/50 py-6 mt-auto">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <p className="text-sm text-slate-500">SportsBet.cash — On-Chain Sports Betting AMM</p>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="https://github.com/uuzor/sportsbet.cash"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-slate-500 hover:text-primary-400 transition-colors"
              >
                GitHub
              </a>
              <Link to={{ page: 'landing' }} className="text-sm text-slate-500 hover:text-primary-400 transition-colors">
                About
              </Link>
              <span className="text-xs text-slate-600">Powered by Bitcoin Cash</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
