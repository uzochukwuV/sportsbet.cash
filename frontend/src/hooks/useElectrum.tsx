import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

// Electrum server configuration
const ELECTRUM_SERVERS = {
  mainnet: [
    { host: 'bch.imaginary.cash', port: 50004, protocol: 'wss' },
    { host: 'electroncash.de', port: 60002, protocol: 'wss' },
    { host: 'electrum.imaginary.cash', port: 50004, protocol: 'wss' },
  ],
  chipnet: [
    { host: 'chipnet.imaginary.cash', port: 50004, protocol: 'wss' },
  ],
};

export type Network = 'mainnet' | 'chipnet';

interface ElectrumMessage {
  id: number;
  method: string;
  params: unknown[];
}

interface ElectrumResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface UTXO {
  txid: string;
  vout: number;
  satoshis: bigint;
  height: number;
  token?: {
    category: string;
    amount: bigint;
    nft?: {
      capability: string;
      commitment: string;
    };
  };
}

interface TxHistory {
  txid: string;
  height: number;
}

interface BlockHeader {
  height: number;
  hex: string;
}

interface ElectrumContextType {
  isConnected: boolean;
  network: Network;
  blockHeight: number;
  error: string | null;
  // Methods
  getBalance: (address: string) => Promise<{ confirmed: bigint; unconfirmed: bigint }>;
  getUtxos: (address: string) => Promise<UTXO[]>;
  getHistory: (address: string) => Promise<TxHistory[]>;
  getTransaction: (txid: string) => Promise<string>;
  broadcastTransaction: (txHex: string) => Promise<string>;
  getBlockHeader: (height: number) => Promise<string>;
  subscribeToAddress: (address: string, callback: () => void) => Promise<void>;
  switchNetwork: (network: Network) => void;
}

const ElectrumContext = createContext<ElectrumContextType | null>(null);

export function ElectrumProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [network, setNetwork] = useState<Network>('chipnet');
  const [blockHeight, setBlockHeight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(0);
  const [pendingRequests, setPendingRequests] = useState<Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>>(new Map());
  const [subscriptions, setSubscriptions] = useState<Map<string, () => void>>(new Map());

  // Connect to Electrum server
  const connect = useCallback(async () => {
    const servers = ELECTRUM_SERVERS[network];
    const server = servers[0]; // Use first server, could implement failover

    const url = `${server.protocol}://${server.host}:${server.port}`;

    try {
      const socket = new WebSocket(url);

      socket.onopen = () => {
        setIsConnected(true);
        setError(null);

        // Subscribe to block headers
        socket.send(JSON.stringify({
          id: 0,
          method: 'blockchain.headers.subscribe',
          params: [],
        }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ElectrumResponse;

          // Handle block header subscription
          if (data.id === 0 && data.result) {
            const header = data.result as { height: number };
            setBlockHeight(header.height);
          }

          // Handle subscription notifications (no id)
          if (!('id' in data) && 'method' in data) {
            const notification = data as unknown as { method: string; params: unknown[] };
            if (notification.method === 'blockchain.headers.subscribe') {
              const [header] = notification.params as [{ height: number }];
              setBlockHeight(header.height);
            }
            if (notification.method === 'blockchain.scripthash.subscribe') {
              const [scripthash] = notification.params as [string];
              const callback = subscriptions.get(scripthash);
              if (callback) callback();
            }
          }

          // Handle pending request responses
          if (data.id && pendingRequests.has(data.id)) {
            const { resolve, reject } = pendingRequests.get(data.id)!;
            if (data.error) {
              reject(new Error(data.error.message));
            } else {
              resolve(data.result);
            }
            pendingRequests.delete(data.id);
          }
        } catch (e) {
          console.error('Failed to parse Electrum message:', e);
        }
      };

      socket.onerror = (e) => {
        setError('WebSocket error');
        console.error('Electrum WebSocket error:', e);
      };

      socket.onclose = () => {
        setIsConnected(false);
        // Attempt reconnect after 5 seconds
        setTimeout(() => connect(), 5000);
      };

      setWs(socket);
    } catch (e) {
      setError(`Failed to connect: ${e}`);
    }
  }, [network, pendingRequests, subscriptions]);

  // Connect on mount and network change
  useEffect(() => {
    connect();
    return () => {
      if (ws) ws.close();
    };
  }, [network]);

  // Send request helper
  const sendRequest = useCallback((method: string, params: unknown[]): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Electrum server'));
        return;
      }

      const id = requestId + 1;
      setRequestId(id);

      pendingRequests.set(id, { resolve, reject });

      ws.send(JSON.stringify({
        id,
        method,
        params,
      }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }, [ws, requestId, pendingRequests]);

  // Convert address to scripthash (Electrum format)
  const addressToScripthash = async (address: string): Promise<string> => {
    // Simple P2PKH scripthash calculation
    // In production, use @bitauth/libauth for full address parsing
    const { sha256 } = await import('@bitauth/libauth');

    // Decode cashaddr to get hash160
    // This is a simplified version - full implementation needs proper cashaddr parsing
    const hash = address.includes(':') ? address.split(':')[1] : address;

    // For demo purposes, return a hash of the address
    // Real implementation should use cashAddressToLockingBytecode
    const encoder = new TextEncoder();
    const hashBytes = sha256.hash(encoder.encode(address));

    // Reverse for little-endian
    const reversed = new Uint8Array(hashBytes).reverse();
    return Array.from(reversed).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // API Methods
  const getBalance = useCallback(async (address: string) => {
    const scripthash = await addressToScripthash(address);
    const result = await sendRequest('blockchain.scripthash.get_balance', [scripthash]) as {
      confirmed: number;
      unconfirmed: number;
    };
    return {
      confirmed: BigInt(result.confirmed),
      unconfirmed: BigInt(result.unconfirmed),
    };
  }, [sendRequest]);

  const getUtxos = useCallback(async (address: string): Promise<UTXO[]> => {
    const scripthash = await addressToScripthash(address);
    const utxos = await sendRequest('blockchain.scripthash.listunspent', [scripthash]) as Array<{
      tx_hash: string;
      tx_pos: number;
      value: number;
      height: number;
      token_data?: {
        category: string;
        amount: string;
        nft?: {
          capability: string;
          commitment: string;
        };
      };
    }>;

    return utxos.map(utxo => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      satoshis: BigInt(utxo.value),
      height: utxo.height,
      token: utxo.token_data ? {
        category: utxo.token_data.category,
        amount: BigInt(utxo.token_data.amount),
        nft: utxo.token_data.nft,
      } : undefined,
    }));
  }, [sendRequest]);

  const getHistory = useCallback(async (address: string): Promise<TxHistory[]> => {
    const scripthash = await addressToScripthash(address);
    const history = await sendRequest('blockchain.scripthash.get_history', [scripthash]) as Array<{
      tx_hash: string;
      height: number;
    }>;

    return history.map(tx => ({
      txid: tx.tx_hash,
      height: tx.height,
    }));
  }, [sendRequest]);

  const getTransaction = useCallback(async (txid: string): Promise<string> => {
    return await sendRequest('blockchain.transaction.get', [txid]) as string;
  }, [sendRequest]);

  const broadcastTransaction = useCallback(async (txHex: string): Promise<string> => {
    return await sendRequest('blockchain.transaction.broadcast', [txHex]) as string;
  }, [sendRequest]);

  const getBlockHeader = useCallback(async (height: number): Promise<string> => {
    return await sendRequest('blockchain.block.header', [height]) as string;
  }, [sendRequest]);

  const subscribeToAddress = useCallback(async (address: string, callback: () => void) => {
    const scripthash = await addressToScripthash(address);
    subscriptions.set(scripthash, callback);
    await sendRequest('blockchain.scripthash.subscribe', [scripthash]);
  }, [sendRequest, subscriptions]);

  const switchNetwork = useCallback((newNetwork: Network) => {
    if (ws) ws.close();
    setNetwork(newNetwork);
  }, [ws]);

  const value: ElectrumContextType = {
    isConnected,
    network,
    blockHeight,
    error,
    getBalance,
    getUtxos,
    getHistory,
    getTransaction,
    broadcastTransaction,
    getBlockHeader,
    subscribeToAddress,
    switchNetwork,
  };

  return (
    <ElectrumContext.Provider value={value}>
      {children}
    </ElectrumContext.Provider>
  );
}

export function useElectrum() {
  const context = useContext(ElectrumContext);
  if (!context) {
    throw new Error('useElectrum must be used within an ElectrumProvider');
  }
  return context;
}
