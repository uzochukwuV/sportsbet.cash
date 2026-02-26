/**
 * Debug script: inspect pool UTXO and test commitment computation
 */
import 'dotenv/config';
import {
  Contract,
  ElectrumNetworkProvider,
  Network,
} from 'cashscript';
import { hexToBin, binToHex, hash256 } from '@bitauth/libauth';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FEE_NUMERATOR   = 30n;
const FEE_DENOMINATOR = 10000n;
const PRICE_PER_UNIT  = 10_000n;

const POOL_REGISTRY_ENV = process.env.POOL_REGISTRY ?? process.env.VITE_POOL_REGISTRY ?? '[]';
const registry = JSON.parse(POOL_REGISTRY_ENV);
const { poolAddress, homeTokenCategory, awayTokenCategory } = registry[0];

const provider = new ElectrumNetworkProvider(Network.CHIPNET, { hostname: 'chipnet.imaginary.cash' });
const artifactPath = resolve(__dirname, '..', 'contracts', 'amm-pool.json');
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));

const contract = new Contract(artifact, [
  hexToBin(homeTokenCategory),
  hexToBin(awayTokenCategory),
  FEE_NUMERATOR,
  FEE_DENOMINATOR,
  PRICE_PER_UNIT,
], { provider });

console.log('Contract address:', contract.address);
console.log('Contract tokenAddress:', contract.tokenAddress);
console.log('Pool address from env:', poolAddress);

// Fetch UTXOs
const utxos = await provider.getUtxos(contract.tokenAddress);
console.log(`\nFound ${utxos.length} UTXOs:`);

for (const utxo of utxos) {
  console.log(`\nUTXO ${utxo.txid}:${utxo.vout}`);
  console.log(`  satoshis: ${utxo.satoshis}`);
  if (utxo.token) {
    const cat = utxo.token.category;
    const catType = cat instanceof Uint8Array ? 'Uint8Array' : typeof cat;
    const catHex = cat instanceof Uint8Array ? binToHex(cat) : String(cat);
    console.log(`  token.category: ${catHex} (type: ${catType})`);
    console.log(`  token.amount: ${utxo.token.amount} (type: ${typeof utxo.token.amount})`);
    if (utxo.token.nft) {
      console.log(`  token.nft.capability: ${utxo.token.nft.capability}`);
      const comm = utxo.token.nft.commitment;
      console.log(`  token.nft.commitment: ${comm} (type: ${typeof comm}, instanceof Uint8Array: ${comm instanceof Uint8Array})`);
      if (comm instanceof Uint8Array) {
        console.log(`  commitment hex: ${binToHex(comm)}`);
        console.log(`  commitment length: ${comm.length} bytes`);
      } else {
        console.log(`  commitment length: ${(String(comm).length ?? 0) / 2} bytes`);
      }
    }
  }
}

const poolUtxo = utxos.find(u => u.token?.nft?.capability === 'minting');
if (!poolUtxo) {
  console.log('\nERROR: No minting NFT found!');
  process.exit(1);
}

const commitment = poolUtxo.token!.nft!.commitment!;
console.log('\nPool commitment:', commitment);
const bytes = hexToBin(commitment);
console.log('State:', bytes[0]);

// Fetch block headers for halftime blocks
const wsUrl = 'wss://chipnet.imaginary.cash:50004';
const halftimeBlock = 294489;

const hashes: Uint8Array[] = await new Promise((res, rej) => {
  const ws = new WebSocket(wsUrl);
  const results = new Map<number, Uint8Array>();
  ws.on('open', () => {
    [halftimeBlock, halftimeBlock+1, halftimeBlock+2].forEach((h, i) => {
      ws.send(JSON.stringify({ id: i+1, method: 'blockchain.block.header', params: [h] }));
    });
  });
  ws.on('message', (data: Buffer) => {
    const msg = JSON.parse(data.toString());
    if (msg.id >= 1 && msg.id <= 3) {
      const headerHex: string = msg.result;
      const headerBytes = hexToBin(headerHex);
      const hashResult = hash256(headerBytes);
      results.set(msg.id, hashResult);
      if (results.size === 3) { ws.close(); res([results.get(1)!, results.get(2)!, results.get(3)!]); }
    }
  });
  ws.on('error', rej);
  setTimeout(() => { ws.close(); rej(new Error('timeout')); }, 10000);
});

const [h1, h2, h3] = hashes;
console.log('\nBlock hashes:');
console.log('h1:', binToHex(h1));
console.log('h2:', binToHex(h2));
console.log('h3:', binToHex(h3));

// matchId from commitment bytes 26-33
const matchId = bytes.slice(26, 34);
console.log('matchId:', binToHex(matchId));
console.log('sportType:', bytes[25]);

// Compute seed
const seedInput = new Uint8Array([...h1, ...h2, ...h3, ...matchId]);
console.log('\nseedInput length:', seedInput.length, '(expect 104)');
console.log('seedInput hex:', binToHex(seedInput));

const seed = hash256(seedInput);
console.log('seed:', binToHex(seed));

const scoreHashInput = new Uint8Array([...seed, 0x48]);
const scoreHash = hash256(scoreHashInput);
console.log('scoreHash:', binToHex(scoreHash));

// Basketball: 30-75
const v1 = scoreHash[0] | (scoreHash[1] << 8);
const v2 = scoreHash[2] | (scoreHash[3] << 8);
const homeScore1H = 30 + (v1 % 46);
const awayScore1H = 30 + (v2 % 46);
console.log(`\nhomeScore1H: 30 + (${v1} % 46) = ${homeScore1H} = 0x${homeScore1H.toString(16)}`);
console.log(`awayScore1H: 30 + (${v2} % 46) = ${awayScore1H} = 0x${awayScore1H.toString(16)}`);

// Expected output commitment
const result = new Uint8Array(38);
result[0] = 2;
result.set(bytes.slice(1, 34), 1);
result[34] = homeScore1H;
result[35] = awayScore1H;
result[36] = 0;
result[37] = 0;
console.log('\nExpected output commitment:', binToHex(result));
console.log('Current commitment (input):', commitment);

// Also verify contract tokenAddress matches poolAddress
console.log('\nAddresses match:', contract.tokenAddress === poolAddress);

process.exit(0);
