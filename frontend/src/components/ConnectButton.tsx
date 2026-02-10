import { useState } from 'react';
import { Wallet, LogOut, Copy, Check, ExternalLink } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';

export function ConnectButton() {
  const { address, isConnected, isConnecting, connect, disconnect, balance } = useWallet();
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const copyAddress = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatAddress = (addr: string) => {
    // Remove prefix and shorten
    const clean = addr.replace('bitcoincash:', '').replace('bchtest:', '');
    return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
  };

  const formatBalance = (sats: bigint) => {
    const bch = Number(sats) / 100_000_000;
    return bch.toFixed(4);
  };

  if (isConnecting) {
    return (
      <button disabled className="btn-primary opacity-75">
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        <span>Connecting...</span>
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700 hover:border-primary-500/50 transition-all"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <div className="text-left hidden sm:block">
            <div className="text-sm font-medium text-slate-100">
              {formatBalance(balance)} BCH
            </div>
            <div className="text-xs text-slate-500">
              {formatAddress(address)}
            </div>
          </div>
        </button>

        {/* Dropdown */}
        {dropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setDropdownOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-64 rounded-xl glass border border-slate-700 shadow-xl z-50 animate-fade-in">
              <div className="p-4 border-b border-slate-800">
                <div className="text-sm text-slate-400 mb-1">Connected Wallet</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs text-slate-300 bg-slate-800 px-2 py-1 rounded flex-1 truncate">
                    {address.replace('bitcoincash:', '').replace('bchtest:', '')}
                  </code>
                  <button
                    onClick={copyAddress}
                    className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-win-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="p-4 border-b border-slate-800">
                <div className="text-sm text-slate-400 mb-1">Balance</div>
                <div className="text-2xl font-bold text-slate-100">
                  {formatBalance(balance)} <span className="text-lg text-slate-500">BCH</span>
                </div>
              </div>

              <div className="p-2">
                <a
                  href={`https://chipnet.chaingraph.cash/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on Explorer
                </a>
                <button
                  onClick={() => {
                    disconnect();
                    setDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-lose-400 hover:text-lose-300 hover:bg-lose-500/10 rounded-lg transition-colors w-full"
                >
                  <LogOut className="w-4 h-4" />
                  Disconnect
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button onClick={connect} className="btn-primary">
      <Wallet className="w-4 h-4" />
      <span className="hidden sm:inline">Connect Wallet</span>
      <span className="sm:hidden">Connect</span>
    </button>
  );
}
