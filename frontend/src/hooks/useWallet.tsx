import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

// Wallet Context Types
interface WalletContextType {
  address: string | null;
  balance: bigint;
  isConnected: boolean;
  isConnecting: boolean;
  isInitialized: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (txHex: string, sourceOutputs: any[]) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | null>(null);

// Demo wallet for development (simulates WalletConnect)
class DemoWallet {
  private connected = false;
  private address: string | null = null;

  async connect(): Promise<string> {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Generate a demo address
    this.address = 'bchtest:qz2g7h3t5c6u8e9f4r2t3y4u5i6o7p8a9s0d1f2g3h4';
    this.connected = true;

    return this.address;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.address = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getAddress(): string | null {
    return this.address;
  }

  async signTransaction(txHex: string, _sourceOutputs: any[]): Promise<string> {
    // In real implementation, this would call WalletConnect
    console.log('Signing transaction:', txHex.slice(0, 20) + '...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    return txHex; // Return as-is for demo
  }

  async getBalance(): Promise<bigint> {
    // Simulated balance
    return BigInt(123456789); // ~1.23 BCH
  }
}

const wallet = new DemoWallet();

// Provider Component
export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      // Check for existing session
      if (wallet.isConnected()) {
        setAddress(wallet.getAddress());
        const bal = await wallet.getBalance();
        setBalance(bal);
      }
      setIsInitialized(true);
    };
    init();
  }, []);

  // Update balance periodically when connected
  useEffect(() => {
    if (!address) return;

    const updateBalance = async () => {
      const bal = await wallet.getBalance();
      setBalance(bal);
    };

    updateBalance();
    const interval = setInterval(updateBalance, 30000); // Every 30s

    return () => clearInterval(interval);
  }, [address]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const addr = await wallet.connect();
      setAddress(addr);
      const bal = await wallet.getBalance();
      setBalance(bal);
    } catch (error) {
      console.error('Failed to connect:', error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await wallet.disconnect();
    setAddress(null);
    setBalance(0n);
  }, []);

  const signTransaction = useCallback(async (txHex: string, sourceOutputs: any[]) => {
    if (!wallet.isConnected()) {
      throw new Error('Wallet not connected');
    }
    return wallet.signTransaction(txHex, sourceOutputs);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        balance,
        isConnected: address !== null,
        isConnecting,
        isInitialized,
        connect,
        disconnect,
        signTransaction,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// Hook
export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
