import { useState, useCallback } from 'react';
import {
  X,
  Wallet,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { generateLocalPrivKey, validateAndDeriveAddress } from '../hooks/useWallet';
import { useWallet } from '../hooks/useWallet';

type Tab = 'choose' | 'generate' | 'import' | 'walletconnect';

interface Props {
  onClose: () => void;
}

export function WalletSetupModal({ onClose }: Props) {
  const { connect, connectLocal } = useWallet();
  const [tab, setTab] = useState<Tab>('choose');

  // --- Generate tab state ---
  const [generatedKey, setGeneratedKey] = useState('');
  const [generatedAddress, setGeneratedAddress] = useState('');
  const [keyRevealed, setKeyRevealed] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  // --- Import tab state ---
  const [importKey, setImportKey] = useState('');
  const [importError, setImportError] = useState('');
  const [importAddress, setImportAddress] = useState('');

  // --- WalletConnect tab ---
  const [wcConnecting, setWcConnecting] = useState(false);
  const [wcError, setWcError] = useState('');

  const handleGenerate = useCallback(() => {
    const key = generateLocalPrivKey();
    const addr = validateAndDeriveAddress(key) ?? '';
    setGeneratedKey(key);
    setGeneratedAddress(addr);
    setKeyRevealed(false);
    setKeyCopied(false);
    setAddrCopied(false);
    setSavedConfirmed(false);
    setTab('generate');
  }, []);

  const copyKey = async () => {
    await navigator.clipboard.writeText(generatedKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const copyAddr = async () => {
    await navigator.clipboard.writeText(generatedAddress);
    setAddrCopied(true);
    setTimeout(() => setAddrCopied(false), 2000);
  };

  const handleUseGeneratedWallet = () => {
    connectLocal(generatedKey);
    onClose();
  };

  const handleImportChange = (val: string) => {
    setImportKey(val.trim());
    setImportError('');
    const addr = validateAndDeriveAddress(val.trim());
    setImportAddress(addr ?? '');
    if (val.trim() && !addr) {
      setImportError('Invalid private key — must be 64 hex characters.');
    }
  };

  const handleImport = () => {
    if (!importAddress) return;
    connectLocal(importKey);
    onClose();
  };

  const handleWalletConnect = async () => {
    setWcConnecting(true);
    setWcError('');
    try {
      await connect();
      onClose();
    } catch (err) {
      setWcError(String(err));
    } finally {
      setWcConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg glass rounded-2xl shadow-2xl border border-slate-700/60 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Connect Wallet</h2>
              <p className="text-xs text-slate-500">Choose how to access SportsBet.cash</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* ── Choose tab ── */}
          {tab === 'choose' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-400 mb-4">
                No wallet? Generate one instantly in your browser — no app needed.
              </p>

              {/* Generate option */}
              <button
                onClick={handleGenerate}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-primary-500/30 bg-primary-500/5 hover:bg-primary-500/10 hover:border-primary-500/60 transition-all group text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-primary-500/15 flex items-center justify-center flex-shrink-0 group-hover:bg-primary-500/25 transition-colors">
                  <Key className="w-6 h-6 text-primary-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-100">Generate New Wallet</div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    Create a fresh private key in your browser — instant &amp; free
                  </div>
                </div>
                <span className="text-xs bg-win-500/15 text-win-400 border border-win-500/20 px-2 py-1 rounded-full flex-shrink-0">
                  Recommended
                </span>
              </button>

              {/* Import option */}
              <button
                onClick={() => setTab('import')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-700/50 hover:border-slate-600 bg-slate-900/30 hover:bg-slate-800/30 transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center flex-shrink-0 group-hover:bg-slate-700/60 transition-colors">
                  <Key className="w-6 h-6 text-slate-400" />
                </div>
                <div>
                  <div className="font-semibold text-slate-100">Import Private Key</div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    Already have a 64-character hex private key? Paste it here
                  </div>
                </div>
              </button>

              {/* WalletConnect option */}
              <button
                onClick={() => setTab('walletconnect')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-700/50 hover:border-accent-500/30 bg-slate-900/30 hover:bg-accent-500/5 transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-800/60 flex items-center justify-center flex-shrink-0 group-hover:bg-accent-500/15 transition-colors">
                  <Smartphone className="w-6 h-6 text-accent-400" />
                </div>
                <div>
                  <div className="font-semibold text-slate-100">WalletConnect</div>
                  <div className="text-sm text-slate-400 mt-0.5">
                    Scan QR code with an Electron Cash or compatible BCH wallet
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* ── Generate tab ── */}
          {tab === 'generate' && generatedKey && (
            <div className="space-y-4">
              {/* Warning banner */}
              <div className="flex gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-300">
                  <strong>Save your private key</strong> — it cannot be recovered if lost. Anyone with this key controls your funds.
                </p>
              </div>

              {/* Private key */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                  Private Key (hex)
                </label>
                <div className="relative">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 pr-20 font-mono text-xs text-slate-300 break-all leading-relaxed">
                    {keyRevealed
                      ? generatedKey
                      : '●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●'}
                  </div>
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button
                      onClick={() => setKeyRevealed(r => !r)}
                      className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                      title={keyRevealed ? 'Hide' : 'Reveal'}
                    >
                      {keyRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={copyKey}
                      className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Copy key"
                    >
                      {keyCopied ? <Check className="w-4 h-4 text-win-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                  Your Address
                </label>
                <div className="relative">
                  <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 pr-10 font-mono text-xs text-slate-300 break-all">
                    {generatedAddress}
                  </div>
                  <button
                    onClick={copyAddr}
                    className="absolute right-2 top-2 p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    {addrCopied ? <Check className="w-4 h-4 text-win-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Regenerate */}
              <button
                onClick={handleGenerate}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Generate a different key
              </button>

              {/* Confirm saved */}
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-700/50 cursor-pointer hover:bg-slate-800/30 transition-colors">
                <input
                  type="checkbox"
                  checked={savedConfirmed}
                  onChange={e => setSavedConfirmed(e.target.checked)}
                  className="w-4 h-4 accent-primary-500 rounded"
                />
                <span className="text-sm text-slate-300">
                  I have saved my private key in a secure place
                </span>
              </label>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => setTab('choose')}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm"
                >
                  Back
                </button>
                <button
                  onClick={handleUseGeneratedWallet}
                  disabled={!savedConfirmed}
                  className="flex-1 btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Use This Wallet
                </button>
              </div>
            </div>
          )}

          {/* ── Import tab ── */}
          {tab === 'import' && (
            <div className="space-y-4">
              <div className="flex gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-300">
                  Only import keys on trusted devices. Your key is stored in browser localStorage.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                  Private Key (64 hex characters)
                </label>
                <textarea
                  value={importKey}
                  onChange={e => handleImportChange(e.target.value)}
                  placeholder="Paste your 64-character hex private key here…"
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500/50"
                />
                {importError && (
                  <p className="text-xs text-lose-400 mt-1">{importError}</p>
                )}
              </div>

              {importAddress && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                    Derived Address
                  </label>
                  <div className="bg-slate-900 border border-win-500/30 rounded-xl p-3 font-mono text-xs text-win-400 break-all">
                    {importAddress}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setTab('choose')}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importAddress}
                  className="flex-1 btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Import Wallet
                </button>
              </div>
            </div>
          )}

          {/* ── WalletConnect tab ── */}
          {tab === 'walletconnect' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">
                Connect using a WalletConnect-compatible BCH wallet (e.g., Electron Cash with WalletConnect plugin).
              </p>
              {wcError && (
                <div className="p-3 rounded-xl bg-lose-500/10 border border-lose-500/20 text-sm text-lose-400">
                  {wcError}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setTab('choose')}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm"
                >
                  Back
                </button>
                <button
                  onClick={handleWalletConnect}
                  disabled={wcConnecting}
                  className="flex-1 btn-primary disabled:opacity-75"
                >
                  {wcConnecting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Smartphone className="w-4 h-4" />
                      Open QR Modal
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
