import { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';

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
  // Use refs for mutable values that don't need to trigger re-renders.
  // This eliminates stale-closure bugs where sendRequest captures an old ws/requestId.
  const wsRef            = useRef<WebSocket | null>(null);
  const requestIdRef     = useRef(0);
  const pendingRequests  = useRef<Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>>(new Map());
  const subscriptions    = useRef<Map<string, () => void>>(new Map());

  const [isConnected, setIsConnected] = useState(false);
  const [network, setNetwork]         = useState<Network>('chipnet');
  const [blockHeight, setBlockHeight] = useState(0);
  const [error, setError]             = useState<string | null>(null);

  // sendRequest is stable — it reads wsRef.current at call time, no stale closures.
  const sendRequest = useCallback((method: string, params: unknown[]): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Electrum server'));
        return;
      }

      const id = ++requestIdRef.current;
      pendingRequests.current.set(id, { resolve, reject });

      socket.send(JSON.stringify({ id, method, params }));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequests.current.has(id)) {
          pendingRequests.current.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }, []); // no dependencies — reads refs at call time

  // Connect to Electrum server
  const connect = useCallback(() => {
    const servers = ELECTRUM_SERVERS[network];
    const server  = servers[0];
    const url     = `${server.protocol}://${server.host}:${server.port}`;

    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      setError(null);
      socket.send(JSON.stringify({ id: 0, method: 'blockchain.headers.subscribe', params: [] }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ElectrumResponse;

        // Block header subscription initial response
        if (data.id === 0 && data.result) {
          const header = data.result as { height: number };
          setBlockHeight(header.height);
        }

        // Subscription notifications (no id field)
        if (!('id' in data) && 'method' in data) {
          const notif = data as unknown as { method: string; params: unknown[] };
          if (notif.method === 'blockchain.headers.subscribe') {
            const [header] = notif.params as [{ height: number }];
            setBlockHeight(header.height);
          }
          if (notif.method === 'blockchain.scripthash.subscribe') {
            const [scripthash] = notif.params as [string];
            const cb = subscriptions.current.get(scripthash);
            if (cb) cb();
          }
        }

        // Resolve/reject pending requests
        if (data.id && pendingRequests.current.has(data.id)) {
          const { resolve, reject } = pendingRequests.current.get(data.id)!;
          pendingRequests.current.delete(data.id);
          if (data.error) {
            reject(new Error(data.error.message));
          } else {
            resolve(data.result);
          }
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
  }, [network]); // only re-create when network changes

  // Connect on mount and when network changes
  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [network]); // intentionally omit connect to avoid infinite loop; connect is stable per network

  // Convert a CashAddress to an Electrum scripthash.
  // Electrum scripthash = SHA256(scriptPubKey), reversed (little-endian).
  //
  // scriptPubKey:
  //   P2PKH:  OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
  //           = 76 a9 14 <hash20> 88 ac
  //   P2SH:   OP_HASH160 <20-byte-hash> OP_EQUAL
  //           = a9 14 <hash20> 87
  //   P2PKH with tokens: same script as P2PKH (same locking bytecode)
  //   P2SH  with tokens: same script as P2SH
  const addressToScripthash = async (address: string): Promise<string> => {
    const { decodeCashAddress, sha256 } = await import('@bitauth/libauth');

    const addr = address.includes(':') ? address : `bitcoincash:${address}`;
    const decoded = decodeCashAddress(addr);
    if (typeof decoded === 'string') {
      throw new Error(`Invalid address "${address}": ${decoded}`);
    }

    const payload = decoded.payload as Uint8Array; // 20-byte hash

    let scriptPubKey: Uint8Array;
    const type = decoded.type as string;
    if (type === 'p2pkh' || type === 'p2pkhWithTokens') {
      // OP_DUP OP_HASH160 <push 20> <hash20> OP_EQUALVERIFY OP_CHECKSIG
      scriptPubKey = new Uint8Array([0x76, 0xa9, 0x14, ...payload, 0x88, 0xac]);
    } else if (type === 'p2sh' || type === 'p2shWithTokens') {
      if (payload.length === 20) {
        // P2SH20: OP_HASH160 <push 20> <hash20> OP_EQUAL
        scriptPubKey = new Uint8Array([0xa9, 0x14, ...payload, 0x87]);
      } else {
        // P2SH32: OP_HASH256 <push 32> <hash32> OP_EQUAL (CashScript default)
        scriptPubKey = new Uint8Array([0xaa, 0x20, ...payload, 0x87]);
      }
    } else {
      throw new Error(`Unsupported address type: ${type}`);
    }

    const hashBytes = sha256.hash(scriptPubKey);
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
    const utxos = await sendRequest('blockchain.scripthash.listunspent', [scripthash, 'include_tokens']) as Array<{
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
    subscriptions.current.set(scripthash, callback);
    await sendRequest('blockchain.scripthash.subscribe', [scripthash]);
  }, [sendRequest]);

  const switchNetwork = useCallback((newNetwork: Network) => {
    wsRef.current?.close();
    setNetwork(newNetwork);
  }, []);

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
