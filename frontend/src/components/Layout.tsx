import { ReactNode } from 'react';
import { Navbar } from './Navbar';

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
            <p className="text-sm text-slate-500">
              SportsBet.cash - On-Chain Sports Betting AMM
            </p>
            <div className="flex items-center gap-6">
              <a href="https://github.com/uuzor/sportsbet.cash" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-primary-400 transition-colors">
                GitHub
              </a>
              <a href="#" className="text-sm text-slate-500 hover:text-primary-400 transition-colors">
                Docs
              </a>
              <span className="text-xs text-slate-600">
                Powered by Bitcoin Cash
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
