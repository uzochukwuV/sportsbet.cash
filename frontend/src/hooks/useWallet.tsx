import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import SignClient from '@walletconnect/sign-client';
import { WalletConnectModal } from '@walletconnect/modal';
import { useElectrum } from './useElectrum';
import {
  generatePrivateKey,
  instantiateSecp256k1,
  privateKeyToP2pkhCashAddress,
  cashAddressToLockingBytecode,
  hexToBin,
  binToHex,
  decodeTransaction,
  encodeTransaction,
  generateSigningSerializationBCH,
  type Secp256k1,
} from '@bitauth/libauth';

// ---------------------------------------------------------------------------
// WalletConnect configuration
// ---------------------------------------------------------------------------
const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';
const IS_CHIPNET = import.meta.env.VITE_NETWORK !== 'mainnet';
const BCH_NAMESPACE = 'bch';
const BCH_CHAIN = IS_CHIPNET ? 'bch:bchtest' : 'bch:bitcoincash';
const ADDRESS_PREFIX = IS_CHIPNET ? 'bchtest' : 'bitcoincash';

const LOCAL_WALLET_KEY = 'sportsbet_local_wallet';

// ---------------------------------------------------------------------------
// Lazy secp256k1 singleton (avoids top-level await issues in browser bundles)
// ---------------------------------------------------------------------------
let _secp256k1: Secp256k1 | null = null;
async function getSecp256k1(): Promise<Secp256k1> {
  if (_secp256k1) return _secp256k1;
  _secp256k1 = await instantiateSecp256k1();
  return _secp256k1;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceOutput {
  lockingBytecode: Uint8Array;
  valueSatoshis: bigint;
  token?: {
    amount: bigint;
    category: Uint8Array;
    nft?: { capability: string; commitment: Uint8Array };
  };
}

export type WalletMode = 'walletconnect' | 'local' | null;

interface WalletContextType {
  address: string | null;
  balance: bigint;
  isConnected: boolean;
  isConnecting: boolean;
  isInitialized: boolean;
  walletMode: WalletMode;
  localPrivKeyHex: string | null;
  connect: () => Promise<void>;
  connectLocal: (privKeyHex: string) => void;
  disconnect: () => Promise<void>;
  signTransaction: (txHex: string, sourceOutputs: SourceOutput[]) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | null>(null);

// ---------------------------------------------------------------------------
// Local wallet helpers
// ---------------------------------------------------------------------------

/** Generate a fresh random private key (hex string) */
export function generateLocalPrivKey(): string {
  // generatePrivateKey does not need secp256k1 WASM — just random bytes + range check
  const privKey = generatePrivateKey(() => crypto.getRandomValues(new Uint8Array(32)));
  if (typeof privKey === 'string') throw new Error('Key generation failed: ' + privKey);
  return binToHex(privKey);
}

/**
 * Derive a P2PKH cash address from a hex private key.
 * Uses the compiler template path (no raw WASM needed at derive time).
 */
function privKeyToAddress(privKeyHex: string): string {
  const privKeyBytes = hexToBin(privKeyHex);
  const result = privateKeyToP2pkhCashAddress({ privateKey: privKeyBytes, prefix: ADDRESS_PREFIX });
  if (typeof result === 'string') throw new Error('Address derivation failed: ' + result);
  return result.address;
}

/**
 * Sign all P2PKH inputs of a raw unsigned transaction using BIP143/BCH sighash.
 * Uses instantiateSecp256k1() lazily so WASM is only loaded when actually signing.
 */
async function signWithLocalKey(
  privKeyHex: string,
  txHex: string,
  sourceOutputs: SourceOutput[],
): Promise<string> {
  const secp = await getSecp256k1();

  const privKeyBytes = hexToBin(privKeyHex);
  const pubKey = secp.derivePublicKeyCompressed(privKeyBytes);
  if (typeof pubKey === 'string') throw new Error('Invalid private key: ' + pubKey);

  const txBin = hexToBin(txHex);
  const tx = decodeTransaction(txBin);
  if (typeof tx === 'string') throw new Error('Failed to decode transaction: ' + tx);

  const SIGHASH_ALL_FORKID = 0x41;

  for (let i = 0; i < tx.inputs.length; i++) {
    const src = sourceOutputs[i];
    if (!src) continue;

    // Build the BIP143 signing serialization using libauth's helper.
    // CompilationContextBCH = { inputIndex, sourceOutputs: Output[], transaction }
    const sourceOutputsAll = sourceOutputs.map(o => ({
      lockingBytecode: o.lockingBytecode,
      valueSatoshis: o.valueSatoshis,
      ...(o.token ? {
        token: {
          amount: o.token.amount,
          category: o.token.category,
          ...(o.token.nft ? { nft: { capability: o.token.nft.capability, commitment: o.token.nft.commitment } } : {}),
        },
      } : {}),
    }));

    const signingContext = {
      inputIndex: i,
      sourceOutputs: sourceOutputsAll,
      transaction: {
        version: tx.version,
        inputs: tx.inputs,
        outputs: tx.outputs,
        locktime: tx.locktime,
      },
    };

    const serialization = generateSigningSerializationBCH(signingContext, {
      coveredBytecode: src.lockingBytecode,
      signingSerializationType: new Uint8Array([SIGHASH_ALL_FORKID]),
    });

    // Double-SHA256 sighash
    const sighash = await dsha256(await dsha256(serialization));

    const sigDer = secp.signMessageHashDER(privKeyBytes, sighash);
    if (typeof sigDer === 'string') throw new Error('Signing failed: ' + sigDer);

    // Append sighash type byte
    const sig = new Uint8Array(sigDer.length + 1);
    sig.set(sigDer);
    sig[sigDer.length] = SIGHASH_ALL_FORKID;

    // Build P2PKH unlocking script: <pushdata sig> <pushdata pubkey>
    tx.inputs[i].unlockingBytecode = concatBytes(
      new Uint8Array([sig.length]),    // OP_PUSHDATA (< 76 bytes, direct push)
      sig,
      new Uint8Array([pubKey.length]), // OP_PUSHDATA
      pubKey,
    );
  }

  return binToHex(encodeTransaction(tx));
}

// ---------------------------------------------------------------------------
// Crypto utilities
// ---------------------------------------------------------------------------

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function dsha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const h1 = await crypto.subtle.digest('SHA-256', buf);
  const h2 = await crypto.subtle.digest('SHA-256', h1);
  return new Uint8Array(h2);
}

// ---------------------------------------------------------------------------
// Singleton WalletConnect clients
// ---------------------------------------------------------------------------

let wcClient: SignClient | null = null;
let wcModal: WalletConnectModal | null = null;
let wcInitPromise: Promise<void> | null = null;

async function initWalletConnect(): Promise<void> {
  if (wcClient && wcModal) return;
  if (wcInitPromise) return wcInitPromise;
  wcInitPromise = (async () => {
    wcClient = await SignClient.init({
      projectId: WC_PROJECT_ID,
      metadata: {
        name: 'SportsBet.cash',
        description: 'On-chain sports prediction markets on Bitcoin Cash',
        url: window.location.origin,
        icons: [`${window.location.origin}/favicon.ico`],
      },
    });
    wcModal = new WalletConnectModal({
      projectId: WC_PROJECT_ID,
      chains: [BCH_CHAIN],
      themeMode: 'dark',
    });
  })();
  return wcInitPromise;
}

function getAddressFromSession(client: SignClient): { topic: string; address: string } | null {
  const sessions = client.session.getAll();
  if (!sessions.length) return null;
  const session = [...sessions].reverse().find(s => s.namespaces[BCH_NAMESPACE]);
  if (!session) return null;
  const accounts = session.namespaces[BCH_NAMESPACE]?.accounts ?? [];
  const account = accounts.find(a => a.startsWith(`${BCH_CHAIN}:`));
  if (!account) return null;
  return { topic: session.topic, address: account.replace(`${BCH_CHAIN}:`, '') };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WalletProvider({ children }: { children: ReactNode }) {
  const electrum = useElectrum();

  const [address, setAddress]               = useState<string | null>(null);
  const [balance, setBalance]               = useState<bigint>(0n);
  const [isConnecting, setIsConnecting]     = useState(false);
  const [isInitialized, setIsInitialized]   = useState(false);
  const [walletMode, setWalletMode]         = useState<WalletMode>(null);
  const [localPrivKeyHex, setLocalPrivKeyHex] = useState<string | null>(null);
  const sessionTopicRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Restore local wallet from localStorage first
    const saved = localStorage.getItem(LOCAL_WALLET_KEY);
    if (saved) {
      try {
        const { privKeyHex } = JSON.parse(saved) as { privKeyHex: string };
        const addr = privKeyToAddress(privKeyHex);
        if (!cancelled) {
          setLocalPrivKeyHex(privKeyHex);
          setAddress(addr);
          setWalletMode('local');
          setIsInitialized(true);
        }
        return () => { cancelled = true; };
      } catch {
        localStorage.removeItem(LOCAL_WALLET_KEY);
      }
    }

    // Fall back to WalletConnect session restoration
    initWalletConnect()
      .then(() => {
        if (cancelled || !wcClient) return;
        const existing = getAddressFromSession(wcClient);
        if (existing) {
          sessionTopicRef.current = existing.topic;
          setAddress(existing.address);
          setWalletMode('walletconnect');
        }
        wcClient.on('session_delete', () => {
          sessionTopicRef.current = null;
          setAddress(null);
          setBalance(0n);
          setWalletMode(null);
        });
        wcClient.on('session_expire', () => {
          sessionTopicRef.current = null;
          setAddress(null);
          setBalance(0n);
          setWalletMode(null);
        });
      })
      .catch(err => console.error('WalletConnect init error:', err))
      .finally(() => { if (!cancelled) setIsInitialized(true); });

    return () => { cancelled = true; };
  }, []);

  // Balance polling
  useEffect(() => {
    if (!address || !electrum.isConnected) return;
    const refresh = async () => {
      try {
        const { confirmed, unconfirmed } = await electrum.getBalance(address);
        setBalance(confirmed + unconfirmed);
      } catch { /* best-effort */ }
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [address, electrum.isConnected]);

  const connect = useCallback(async () => {
    await initWalletConnect();
    if (!wcClient || !wcModal) throw new Error('WalletConnect not initialized');
    setIsConnecting(true);
    try {
      const { uri, approval } = await wcClient.connect({
        requiredNamespaces: {
          [BCH_NAMESPACE]: {
            methods: ['bch_getAddresses', 'bch_signTransaction', 'bch_signMessage'],
            chains: [BCH_CHAIN],
            events: ['accountsChanged', 'chainChanged'],
          },
        },
      });
      if (uri) wcModal.openModal({ uri });
      const session = await approval();
      wcModal.closeModal();
      const accounts = session.namespaces[BCH_NAMESPACE]?.accounts ?? [];
      const account = accounts.find(a => a.startsWith(`${BCH_CHAIN}:`));
      if (!account) throw new Error('No BCH account in session');
      const addr = account.replace(`${BCH_CHAIN}:`, '');
      sessionTopicRef.current = session.topic;
      setAddress(addr);
      setWalletMode('walletconnect');
    } catch (err) {
      wcModal?.closeModal();
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const connectLocal = useCallback((privKeyHex: string) => {
    const addr = privKeyToAddress(privKeyHex);
    localStorage.setItem(LOCAL_WALLET_KEY, JSON.stringify({ privKeyHex }));
    setLocalPrivKeyHex(privKeyHex);
    setAddress(addr);
    setWalletMode('local');
  }, []);

  const disconnect = useCallback(async () => {
    if (walletMode === 'walletconnect' && wcClient && sessionTopicRef.current) {
      try {
        await wcClient.disconnect({
          topic: sessionTopicRef.current,
          reason: { code: 6000, message: 'User disconnected' },
        });
      } catch { /* already expired */ }
    }
    if (walletMode === 'local') {
      localStorage.removeItem(LOCAL_WALLET_KEY);
    }
    sessionTopicRef.current = null;
    setAddress(null);
    setBalance(0n);
    setWalletMode(null);
    setLocalPrivKeyHex(null);
  }, [walletMode]);

  const signTransaction = useCallback(async (
    txHex: string,
    sourceOutputs: SourceOutput[],
  ): Promise<string> => {
    if (walletMode === 'local' && localPrivKeyHex) {
      return signWithLocalKey(localPrivKeyHex, txHex, sourceOutputs);
    }
    if (walletMode === 'walletconnect' && wcClient && sessionTopicRef.current) {
      const result = await wcClient.request<{ signedTransaction: string }>({
        topic: sessionTopicRef.current,
        chainId: BCH_CHAIN,
        request: {
          method: 'bch_signTransaction',
          params: {
            transaction: txHex,
            sourceOutputs: sourceOutputs.map(o => ({
              lockingBytecode: Array.from(o.lockingBytecode),
              valueSatoshis: o.valueSatoshis.toString(),
              ...(o.token && {
                token: {
                  amount: o.token.amount.toString(),
                  category: Array.from(o.token.category),
                  ...(o.token.nft && {
                    nft: {
                      capability: o.token.nft.capability,
                      commitment: Array.from(o.token.nft.commitment),
                    },
                  }),
                },
              }),
            })),
          },
        },
      });
      return result.signedTransaction;
    }
    throw new Error('Wallet not connected');
  }, [walletMode, localPrivKeyHex]);

  return (
    <WalletContext.Provider value={{
      address,
      balance,
      isConnected: address !== null,
      isConnecting,
      isInitialized,
      walletMode,
      localPrivKeyHex,
      connect,
      connectLocal,
      disconnect,
      signTransaction,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within a WalletProvider');
  return context;
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { cashAddressToLockingBytecode };
export type { SourceOutput };

// Used by WalletSetupModal to validate an imported private key
export function validateAndDeriveAddress(privKeyHex: string): string | null {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(privKeyHex)) return null;
    return privKeyToAddress(privKeyHex);
  } catch {
    return null;
  }
}

