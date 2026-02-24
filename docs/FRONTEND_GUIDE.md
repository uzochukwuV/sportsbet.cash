# Frontend Development Guide for SportsBet.cash

## Overview

This guide covers how to build a web frontend for BCH dApps with:
- Wallet connection (WalletConnect V2)
- Blockchain queries (Electrum)
- CashScript contract integration

---

## 1. Tech Stack Recommendation

Based on production BCH dApps like [Cash Ninjas](https://github.com/cashninjas/ninjas.cash), [TapSwap](https://tapswap.cash), and [Moria](https://next.cashscript.org/docs/showcase):

```
Frontend:      React/Vue + Vite
Wallet:        WalletConnect V2 (@walletconnect/sign-client)
Blockchain:    electrum-cash (WebSocket)
Contracts:     CashScript SDK
Crypto:        @bitauth/libauth
Bundler:       Vite (with top-level-await support)
```

### Package Installation

```bash
# Core dependencies
yarn add @walletconnect/sign-client @walletconnect/modal
yarn add electrum-cash cashscript @bitauth/libauth

# React specific
yarn add react react-dom
yarn add -D vite @vitejs/plugin-react
```

---

## 2. Wallet Connection (WalletConnect V2)

### Supported Wallets
- [Cashonize](https://cashonize.com/) - Web, Desktop, Mobile
- [Paytaca](https://www.paytaca.com/) - Mobile + Browser Extension
- [Zapit](https://zapit.io/) - Mobile

### Setup WalletConnect

First, get a Project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com).

```typescript
// src/wallet/walletconnect.ts
import Client from "@walletconnect/sign-client";
import { Web3Modal } from "@walletconnect/modal";

const PROJECT_ID = "your-project-id-here";

// BCH namespace configuration
const requiredNamespaces = {
  bch: {
    chains: ["bch:bitcoincash"],
    methods: ["bch_getAddresses", "bch_signTransaction", "bch_signMessage"],
    events: ["addressesChanged"]
  }
};

export class BCHWalletConnect {
  private client: Client | null = null;
  private session: any = null;
  private modal: Web3Modal;

  constructor() {
    this.modal = new Web3Modal({
      projectId: PROJECT_ID,
      chains: ["bch:bitcoincash"]
    });
  }

  async init() {
    this.client = await Client.init({
      logger: "info",
      relayUrl: "wss://relay.walletconnect.com",
      projectId: PROJECT_ID,
      metadata: {
        name: "SportsBet.cash",
        description: "On-Chain Sports Betting AMM",
        url: "https://sportsbet.cash",
        icons: ["https://sportsbet.cash/logo.png"]
      }
    });

    // Restore existing session
    if (this.client.session.length > 0) {
      this.session = this.client.session.getAll()[0];
    }

    // Listen for events
    this.client.on("session_delete", () => {
      this.session = null;
    });
  }

  async connect(): Promise<string> {
    if (!this.client) throw new Error("Client not initialized");

    const { uri, approval } = await this.client.connect({
      requiredNamespaces
    });

    if (uri) {
      await this.modal.openModal({ uri });
    }

    this.session = await approval();
    this.modal.closeModal();

    return this.getAddress();
  }

  async disconnect() {
    if (this.session && this.client) {
      await this.client.disconnect({
        topic: this.session.topic,
        reason: { code: 6000, message: "User disconnected" }
      });
      this.session = null;
    }
  }

  getAddress(): string {
    if (!this.session) throw new Error("Not connected");
    const accounts = this.session.namespaces.bch.accounts;
    // Format: "bch:bitcoincash:qz..."
    return accounts[0].split(":")[2];
  }

  async signTransaction(txHex: string, sourceOutputs: any[]): Promise<string> {
    if (!this.client || !this.session) throw new Error("Not connected");

    const result = await this.client.request({
      topic: this.session.topic,
      chainId: "bch:bitcoincash",
      request: {
        method: "bch_signTransaction",
        params: {
          transaction: txHex,
          sourceOutputs,
          broadcast: true
        }
      }
    });

    return result.signedTransaction;
  }

  isConnected(): boolean {
    return this.session !== null;
  }
}
```

### React Hook

```typescript
// src/hooks/useWallet.ts
import { useState, useEffect, useCallback } from 'react';
import { BCHWalletConnect } from '../wallet/walletconnect';

const walletClient = new BCHWalletConnect();

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    walletClient.init().then(() => {
      setIsInitialized(true);
      if (walletClient.isConnected()) {
        setAddress(walletClient.getAddress());
      }
    });
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const addr = await walletClient.connect();
      setAddress(addr);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await walletClient.disconnect();
    setAddress(null);
  }, []);

  const signTransaction = useCallback(async (txHex: string, sourceOutputs: any[]) => {
    return walletClient.signTransaction(txHex, sourceOutputs);
  }, []);

  return {
    address,
    isConnected: address !== null,
    isConnecting,
    isInitialized,
    connect,
    disconnect,
    signTransaction
  };
}
```

---

## 3. Blockchain Queries (Electrum)

### Public Electrum Servers (BCH)

| Server | Port (WSS) |
|--------|------------|
| bch.imaginary.cash | 50004 |
| electroncash.de | 60002 |
| electrum.imaginary.cash | 50004 |
| bch.loping.net | 50004 |

### Electrum Client Setup

```typescript
// src/blockchain/electrum.ts
import { ElectrumCluster, ElectrumClient } from 'electrum-cash';

// Single server connection
export async function createElectrumClient(): Promise<ElectrumClient> {
  const client = new ElectrumClient(
    'SportsBet.cash',
    '1.5.1',
    'bch.imaginary.cash',
    50004,
    'wss' // WebSocket Secure for browser
  );

  await client.connect();
  return client;
}

// Cluster for reliability (2 of 3 consensus)
export async function createElectrumCluster(): Promise<ElectrumCluster> {
  const cluster = new ElectrumCluster('SportsBet.cash', '1.5.1', 2, 3);

  cluster.addServer('bch.imaginary.cash', 50004, 'wss');
  cluster.addServer('electroncash.de', 60002, 'wss');
  cluster.addServer('electrum.imaginary.cash', 50004, 'wss');

  await cluster.ready();
  return cluster;
}
```

### Common Queries

```typescript
// src/blockchain/queries.ts
import { ElectrumClient } from 'electrum-cash';
import { cashAddressToLockingBytecode, lockingBytecodeToAddress } from '@bitauth/libauth';

export class BlockchainQueries {
  constructor(private electrum: ElectrumClient) {}

  // Convert address to scripthash (Electrum format)
  private addressToScripthash(address: string): string {
    const lockingBytecode = cashAddressToLockingBytecode(address);
    if (typeof lockingBytecode === 'string') throw new Error(lockingBytecode);

    const hash = sha256(lockingBytecode.bytecode);
    // Reverse for Electrum's little-endian format
    return Buffer.from(hash).reverse().toString('hex');
  }

  // Get address balance
  async getBalance(address: string): Promise<{ confirmed: bigint; unconfirmed: bigint }> {
    const scripthash = this.addressToScripthash(address);
    const result = await this.electrum.request(
      'blockchain.scripthash.get_balance',
      scripthash
    );
    return {
      confirmed: BigInt(result.confirmed),
      unconfirmed: BigInt(result.unconfirmed)
    };
  }

  // Get UTXOs for an address
  async getUtxos(address: string): Promise<UTXO[]> {
    const scripthash = this.addressToScripthash(address);
    const utxos = await this.electrum.request(
      'blockchain.scripthash.listunspent',
      scripthash
    );

    return utxos.map((utxo: any) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      satoshis: BigInt(utxo.value),
      height: utxo.height
    }));
  }

  // Get transaction history
  async getHistory(address: string): Promise<TxHistory[]> {
    const scripthash = this.addressToScripthash(address);
    const history = await this.electrum.request(
      'blockchain.scripthash.get_history',
      scripthash
    );

    return history.map((tx: any) => ({
      txid: tx.tx_hash,
      height: tx.height
    }));
  }

  // Get raw transaction
  async getTransaction(txid: string): Promise<string> {
    return this.electrum.request('blockchain.transaction.get', txid);
  }

  // Broadcast transaction
  async broadcastTransaction(txHex: string): Promise<string> {
    return this.electrum.request('blockchain.transaction.broadcast', txHex);
  }

  // Get current block height
  async getBlockHeight(): Promise<number> {
    const header = await this.electrum.request('blockchain.headers.subscribe');
    return header.height;
  }

  // Get block header (for block hash VRF)
  async getBlockHeader(height: number): Promise<string> {
    return this.electrum.request('blockchain.block.header', height);
  }

  // Subscribe to new blocks
  async subscribeToBlocks(callback: (header: BlockHeader) => void): Promise<void> {
    this.electrum.on('blockchain.headers.subscribe', callback);
    await this.electrum.subscribe('blockchain.headers.subscribe');
  }

  // Subscribe to address changes
  async subscribeToAddress(address: string, callback: () => void): Promise<void> {
    const scripthash = this.addressToScripthash(address);
    this.electrum.on('blockchain.scripthash.subscribe', (params: any) => {
      if (params[0] === scripthash) callback();
    });
    await this.electrum.subscribe('blockchain.scripthash.subscribe', scripthash);
  }
}

interface UTXO {
  txid: string;
  vout: number;
  satoshis: bigint;
  height: number;
}

interface TxHistory {
  txid: string;
  height: number;
}

interface BlockHeader {
  height: number;
  hex: string;
}
```

### React Hook for Blockchain

```typescript
// src/hooks/useBlockchain.ts
import { useState, useEffect, useCallback } from 'react';
import { createElectrumClient } from '../blockchain/electrum';
import { BlockchainQueries } from '../blockchain/queries';

export function useBlockchain() {
  const [queries, setQueries] = useState<BlockchainQueries | null>(null);
  const [blockHeight, setBlockHeight] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    createElectrumClient().then((client) => {
      const q = new BlockchainQueries(client);
      setQueries(q);
      setIsConnected(true);

      // Subscribe to new blocks
      q.subscribeToBlocks((header) => {
        setBlockHeight(header.height);
      });

      // Get initial block height
      q.getBlockHeight().then(setBlockHeight);
    });
  }, []);

  return {
    queries,
    blockHeight,
    isConnected
  };
}
```

---

## 4. CashScript Contract Integration

### Loading Contract in Browser

```typescript
// src/contracts/pool.ts
import { Contract, ElectrumNetworkProvider } from 'cashscript';
import poolArtifact from '../../contracts/amm-pool-v2.json';

export async function loadPoolContract(
  homeTokenCategory: string,
  awayTokenCategory: string,
  network: 'mainnet' | 'chipnet' = 'chipnet'
): Promise<Contract> {
  const provider = new ElectrumNetworkProvider(network);

  const contract = new Contract(
    poolArtifact,
    [
      homeTokenCategory,
      awayTokenCategory,
      30n,      // feeNumerator (0.3%)
      10000n,   // feeDenominator
      10000n    // pricePerUnit
    ],
    { provider }
  );

  return contract;
}
```

### Building Transactions

```typescript
// src/contracts/trading.ts
import { Contract, SignatureTemplate, TransactionBuilder } from 'cashscript';

export async function buildBuyTransaction(
  pool: Contract,
  buyHome: boolean,
  minTokensOut: bigint,
  userUtxo: any,
  userAddress: string
): Promise<{ txHex: string; sourceOutputs: any[] }> {
  // Get pool UTXO
  const poolUtxos = await pool.getUtxos();
  const poolUtxo = poolUtxos.find(u => u.token?.nft);

  if (!poolUtxo) throw new Error('Pool not found');

  // Build transaction using contract function
  const tx = pool.functions
    .buyTokens(buyHome, minTokensOut)
    .from(poolUtxo)
    .fromP2PKH(userUtxo, new SignatureTemplate(userAddress));

  // Get unsigned transaction hex
  const { txHex, sourceOutputs } = await tx.build();

  return { txHex, sourceOutputs };
}
```

### Integrating with WalletConnect

```typescript
// src/trading.ts
import { useWallet } from './hooks/useWallet';
import { loadPoolContract, buildBuyTransaction } from './contracts';

export function useTrade(matchId: string) {
  const { address, signTransaction } = useWallet();
  const { queries } = useBlockchain();

  const buyTokens = async (buyHome: boolean, bchAmount: bigint) => {
    if (!address || !queries) throw new Error('Not connected');

    // 1. Load contract
    const pool = await loadPoolContract(/* categories */);

    // 2. Get user UTXOs
    const userUtxos = await queries.getUtxos(address);
    const utxo = userUtxos.find(u => u.satoshis >= bchAmount + 1000n);

    if (!utxo) throw new Error('Insufficient funds');

    // 3. Calculate expected output
    const poolState = await pool.getUtxos();
    // ... calculate minTokensOut with slippage

    // 4. Build transaction
    const { txHex, sourceOutputs } = await buildBuyTransaction(
      pool,
      buyHome,
      minTokensOut,
      utxo,
      address
    );

    // 5. Sign with wallet (via WalletConnect)
    const signedTx = await signTransaction(txHex, sourceOutputs);

    // 6. Broadcast
    const txid = await queries.broadcastTransaction(signedTx);

    return txid;
  };

  return { buyTokens };
}
```

---

## 5. Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // Required for some packages
      stream: 'stream-browserify',
      buffer: 'buffer',
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  }
});
```

---

## 6. Project Structure

```
frontend/
├── public/
│   └── logo.png
├── src/
│   ├── components/
│   │   ├── ConnectButton.tsx
│   │   ├── MatchCard.tsx
│   │   ├── TradingPanel.tsx
│   │   └── PoolChart.tsx
│   ├── hooks/
│   │   ├── useWallet.ts
│   │   ├── useBlockchain.ts
│   │   ├── useMatches.ts
│   │   └── usePool.ts
│   ├── contracts/
│   │   ├── pool.ts
│   │   ├── trading.ts
│   │   └── artifacts/
│   │       └── amm-pool-v2.json
│   ├── blockchain/
│   │   ├── electrum.ts
│   │   └── queries.ts
│   ├── wallet/
│   │   └── walletconnect.ts
│   ├── pages/
│   │   ├── Home.tsx
│   │   ├── Match.tsx
│   │   └── Portfolio.tsx
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## 7. Example Components

### Connect Button

```tsx
// src/components/ConnectButton.tsx
import { useWallet } from '../hooks/useWallet';

export function ConnectButton() {
  const { address, isConnected, isConnecting, connect, disconnect } = useWallet();

  if (isConnecting) {
    return <button disabled>Connecting...</button>;
  }

  if (isConnected) {
    return (
      <div>
        <span>{address?.slice(0, 10)}...{address?.slice(-4)}</span>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <button onClick={connect}>
      Connect Wallet
    </button>
  );
}
```

### Trading Panel

```tsx
// src/components/TradingPanel.tsx
import { useState } from 'react';
import { useTrade } from '../hooks/useTrade';
import { usePool } from '../hooks/usePool';

interface Props {
  matchId: string;
}

export function TradingPanel({ matchId }: Props) {
  const { buyTokens, sellTokens } = useTrade(matchId);
  const { priceHome, priceAway, reserveHome, reserveAway } = usePool(matchId);
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<'home' | 'away'>('home');

  const handleBuy = async () => {
    const bchAmount = BigInt(parseFloat(amount) * 100_000_000);
    await buyTokens(side === 'home', bchAmount);
  };

  return (
    <div className="trading-panel">
      <div className="prices">
        <div>
          HOME: {(priceHome * 100).toFixed(1)}%
          <span>(Odds: {(1/priceHome).toFixed(2)}x)</span>
        </div>
        <div>
          AWAY: {(priceAway * 100).toFixed(1)}%
          <span>(Odds: {(1/priceAway).toFixed(2)}x)</span>
        </div>
      </div>

      <div className="trade-form">
        <select value={side} onChange={e => setSide(e.target.value as any)}>
          <option value="home">HOME_WIN</option>
          <option value="away">AWAY_WIN</option>
        </select>

        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="BCH amount"
        />

        <button onClick={handleBuy}>Buy {side.toUpperCase()}</button>
      </div>
    </div>
  );
}
```

---

## 8. Key Resources

### Documentation
- [CashScript Docs](https://cashscript.org/)
- [mainnet.cash Tutorial](https://mainnet.cash/tutorial/)
- [Electrum Protocol Reference](https://electrum-cash-protocol.readthedocs.io/)
- [WalletConnect Docs](https://docs.walletconnect.com/)

### Example Projects
- [Cash Ninjas](https://github.com/cashninjas/ninjas.cash) - NFT minting dApp
- [TapSwap](https://tapswap.cash) - DEX for CashTokens
- [Cashonize Wallet](https://github.com/cashonize/cashonize-wallet) - Reference wallet
- [WC2-BCH-BCR](https://github.com/mainnet-pat/wc2-bch-bcr) - WalletConnect spec

### NPM Packages
- [`cashscript`](https://www.npmjs.com/package/cashscript)
- [`electrum-cash`](https://www.npmjs.com/package/electrum-cash)
- [`@bitauth/libauth`](https://www.npmjs.com/package/@bitauth/libauth)
- [`mainnet-js`](https://www.npmjs.com/package/mainnet-js)
- [`@walletconnect/sign-client`](https://www.npmjs.com/package/@walletconnect/sign-client)

### Wallet Support
- [Cashonize](https://cashonize.com/) - Best for development
- [Paytaca](https://www.paytaca.com/) - Mobile + Extension
- [Zapit](https://zapit.io/) - Mobile

---

## 9. Development Workflow

```bash
# 1. Create project
npm create vite@latest sportsbet-frontend -- --template react-ts

# 2. Install dependencies
cd sportsbet-frontend
npm install @walletconnect/sign-client @walletconnect/modal
npm install electrum-cash cashscript @bitauth/libauth
npm install vite-plugin-wasm vite-plugin-top-level-await

# 3. Copy contract artifacts
cp ../contracts/*.json src/contracts/artifacts/

# 4. Start development
npm run dev
```

---

## 10. Testing on Chipnet

1. Get testnet BCH from [tbch.googol.cash](https://tbch.googol.cash/)
2. Use Cashonize in testnet mode
3. Connect to chipnet Electrum servers:
   - `chipnet.imaginary.cash:50004`

```typescript
// For testnet
const provider = new ElectrumNetworkProvider('chipnet');
```
