import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import SignClient from '@walletconnect/sign-client';
import { WalletConnectModal } from '@walletconnect/modal';
import { useElectrum } from './useElectrum';

// ---------------------------------------------------------------------------
// WalletConnect configuration
// Get a free project ID at https://cloud.walletconnect.com
// Set VITE_WALLETCONNECT_PROJECT_ID in frontend/.env
// ---------------------------------------------------------------------------
const WC_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

const IS_CHIPNET = import.meta.env.VITE_NETWORK !== 'mainnet';
const BCH_NAMESPACE = 'bch';
// WalletConnect BCH chain IDs
const BCH_CHAIN = IS_CHIPNET ? 'bch:bchtest' : 'bch:bitcoincash';

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

interface WalletContextType {
  address: string | null;
  balance: bigint;
  isConnected: boolean;
  isConnecting: boolean;
  isInitialized: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (txHex: string, sourceOutputs: SourceOutput[]) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | null>(null);

// ---------------------------------------------------------------------------
// Singleton WalletConnect clients (one instance per page load)
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

// Extract address from an active WalletConnect session
function getAddressFromSession(client: SignClient): { topic: string; address: string } | null {
  const sessions = client.session.getAll();
  if (!sessions.length) return null;

  // Most recent session first
  const session = [...sessions].reverse().find(s => s.namespaces[BCH_NAMESPACE]);
  if (!session) return null;

  const accounts = session.namespaces[BCH_NAMESPACE]?.accounts ?? [];
  // Account format: "bch:bchtest:bitcoincash:q..." or "bch:bitcoincash:bitcoincash:q..."
  const account = accounts.find(a => a.startsWith(`${BCH_CHAIN}:`));
  if (!account) return null;

  // Strip chain prefix to get the bare cash address
  const address = account.replace(`${BCH_CHAIN}:`, '');
  return { topic: session.topic, address };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WalletProvider({ children }: { children: ReactNode }) {
  const electrum = useElectrum();

  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const sessionTopicRef = useRef<string | null>(null);

  // Initialize WalletConnect and restore any existing session
  useEffect(() => {
    let cancelled = false;

    initWalletConnect()
      .then(() => {
        if (cancelled || !wcClient) return;

        // Restore session from storage
        const existing = getAddressFromSession(wcClient);
        if (existing) {
          sessionTopicRef.current = existing.topic;
          setAddress(existing.address);
        }

        // Session lifecycle events
        wcClient.on('session_delete', () => {
          sessionTopicRef.current = null;
          setAddress(null);
          setBalance(0n);
        });
        wcClient.on('session_expire', () => {
          sessionTopicRef.current = null;
          setAddress(null);
          setBalance(0n);
        });
      })
      .catch(err => console.error('WalletConnect init error:', err))
      .finally(() => { if (!cancelled) setIsInitialized(true); });

    return () => { cancelled = true; };
  }, []);

  // Refresh balance via Electrum whenever address changes
  useEffect(() => {
    if (!address || !electrum.isConnected) return;

    const refresh = async () => {
      try {
        const { confirmed, unconfirmed } = await electrum.getBalance(address);
        setBalance(confirmed + unconfirmed);
      } catch {
        // Best-effort; ignore errors
      }
    };

    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [address, electrum.isConnected]);

  // Connect via WalletConnect modal
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

      // Show QR modal to user
      if (uri) wcModal.openModal({ uri });

      const session = await approval();
      wcModal.closeModal();

      const accounts = session.namespaces[BCH_NAMESPACE]?.accounts ?? [];
      const account = accounts.find(a => a.startsWith(`${BCH_CHAIN}:`));
      if (!account) throw new Error('No BCH account in session');

      const addr = account.replace(`${BCH_CHAIN}:`, '');
      sessionTopicRef.current = session.topic;
      setAddress(addr);
    } catch (err) {
      wcModal?.closeModal();
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (wcClient && sessionTopicRef.current) {
      try {
        await wcClient.disconnect({
          topic: sessionTopicRef.current,
          reason: { code: 6000, message: 'User disconnected' },
        });
      } catch {
        // Session may already be expired on the wallet side
      }
    }
    sessionTopicRef.current = null;
    setAddress(null);
    setBalance(0n);
  }, []);

  const signTransaction = useCallback(async (
    txHex: string,
    sourceOutputs: SourceOutput[],
  ): Promise<string> => {
    if (!wcClient || !sessionTopicRef.current) {
      throw new Error('Wallet not connected');
    }

    const result = await wcClient.request<{ signedTransaction: string }>({
      topic: sessionTopicRef.current,
      chainId: BCH_CHAIN,
      request: {
        method: 'bch_signTransaction',
        params: {
          transaction: txHex,
          // Serialize BigInts to strings for JSON transport
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
  }, []);

  return (
    <WalletContext.Provider value={{
      address,
      balance,
      isConnected: address !== null,
      isConnecting,
      isInitialized,
      connect,
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
