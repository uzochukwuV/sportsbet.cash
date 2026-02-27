/**
 * SportsBet.cash — Advance Game Script
 *
 * Advances the pool through game phases:
 *   State 0 (TRADING)          → endTradingPhase1()
 *   State 1 (HALFTIME_PENDING) → revealHalftime(h1, h2, h3)
 *   State 2 (HALFTIME_TRADING) → endHalftimeTrading()
 *   State 3 (FINAL_PENDING)    → revealFinal(h1, h2, h3)
 *   State 4 (SETTLED)          → done, winners can redeem
 *
 * The block hash VRF is trustless — anyone can call these transitions.
 * This script calls all transitions sequentially until the pool is settled.
 *
 * Usage:
 *   yarn ts-node scripts/advance-game.ts
 *   NETWORK=mainnet yarn ts-node scripts/advance-game.ts
 */

import 'dotenv/config';
import {
  Contract,
  ElectrumNetworkProvider,
  SignatureTemplate,
  TransactionBuilder,
  Network,
} from 'cashscript';
import {
  hexToBin,
  binToHex,
  hash256,
  decodePrivateKeyWif,
  secp256k1,
  hash160,
  encodeCashAddress,
  CashAddressNetworkPrefix,
  CashAddressType,
} from '@bitauth/libauth';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Config
// =============================================================================

const NETWORK_ARG = process.env.NETWORK ?? 'chipnet';
const NETWORK: Network = NETWORK_ARG === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
const NETWORK_PREFIX: CashAddressNetworkPrefix =
  NETWORK === Network.MAINNET ? CashAddressNetworkPrefix.mainnet : CashAddressNetworkPrefix.testnet;

const FEE_NUMERATOR   = 30n;
const FEE_DENOMINATOR = 10000n;
const PRICE_PER_UNIT  = 10_000n;
const FEE = 2000n;
const DUST = 546n;

const ELECTRUM_HOSTNAMES: Record<string, string> = {
  chipnet: 'chipnet.imaginary.cash',
  mainnet: 'bch.imaginary.cash',
};

function getProvider(): ElectrumNetworkProvider {
  const hostname = ELECTRUM_HOSTNAMES[NETWORK_ARG] ?? ELECTRUM_HOSTNAMES.chipnet;
  return new ElectrumNetworkProvider(NETWORK, { hostname });
}

// =============================================================================
// Wallet helpers
// =============================================================================

function loadPrivateKey(wif: string): Uint8Array {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error('Invalid WIF: ' + decoded);
  return decoded.privateKey;
}

function deriveAddress(privateKey: Uint8Array): { address: string } {
  const pubKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pubKey === 'string') throw new Error('Failed to derive public key');
  const pubKeyHash = hash160(pubKey);
  if (typeof pubKeyHash === 'string') throw new Error('Failed to hash160');
  const result = encodeCashAddress({ prefix: NETWORK_PREFIX, type: CashAddressType.p2pkh, payload: pubKeyHash });
  if (typeof result === 'string') return { address: result };
  if (result && typeof result === 'object' && 'address' in result) return { address: (result as {address:string}).address };
  throw new Error('Failed to encode address');
}

function loadWif(wifEnv: string): { privateKey: Uint8Array; address: string } {
  const isWif = /^[KL5]/.test(wifEnv.trim());
  if (isWif) {
    const privateKey = loadPrivateKey(wifEnv.trim());
    const { address } = deriveAddress(privateKey);
    return { privateKey, address };
  }
  const filePath = resolve(__dirname, '..', wifEnv.trim());
  if (!existsSync(filePath)) throw new Error(`Key file not found: ${filePath}`);
  const json: Record<string, string> = JSON.parse(readFileSync(filePath, 'utf8'));
  const entries = Object.entries(json);
  if (entries.length === 0) throw new Error('Key file is empty');
  const [, wif] = entries[0];
  const privateKey = loadPrivateKey(wif);
  const { address } = deriveAddress(privateKey);
  return { privateKey, address };
}

// =============================================================================
// Block hash computation
// =============================================================================

/**
 * Fetch block headers and compute block hashes for a list of heights.
 * Block hash = hash256 (double SHA256) of the 80-byte header.
 * We pass the hash as-is (in natural byte order) to the CashScript function.
 */
async function getBlockHashes(heights: number[], wsUrl: string): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = new Map<number, Uint8Array>();
    let pending = heights.length;

    ws.on('open', () => {
      heights.forEach((height, i) => {
        ws.send(JSON.stringify({ id: i + 1, method: 'blockchain.block.header', params: [height] }));
      });
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id >= 1 && msg.id <= heights.length) {
        const headerHex: string = msg.result;
        const headerBytes = hexToBin(headerHex);
        const hashResult = hash256(headerBytes);
        results.set(msg.id, hashResult);
        pending--;
        if (pending === 0) {
          ws.close();
          resolve(heights.map((_, i) => results.get(i + 1)!));
        }
      }
    });

    ws.on('error', (e: Error) => reject(e));
    setTimeout(() => { ws.close(); reject(new Error('Block header fetch timeout')); }, 15000);
  });
}

// =============================================================================
// Commitment parsing
// =============================================================================

function readLE(bytes: Uint8Array, offset: number, length: number): bigint {
  let result = 0n;
  for (let i = length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[offset + i]);
  }
  return result;
}

interface PoolState {
  state: number;
  reserveHome: bigint;
  reserveAway: bigint;
  halftimeBlock: number;
  endBlock: number;
  sportType: number;
  matchId: Uint8Array;
  scores: { home1H: number; away1H: number; homeFinal: number; awayFinal: number };
}

function parseCommitment(hex: string): PoolState {
  const bytes = hexToBin(hex);
  return {
    state:         bytes[0],
    reserveHome:   readLE(bytes, 1, 8),
    reserveAway:   readLE(bytes, 9, 8),
    halftimeBlock: Number(readLE(bytes, 17, 4)),
    endBlock:      Number(readLE(bytes, 21, 4)),
    sportType:     bytes[25],
    matchId:       bytes.slice(26, 34),
    scores: {
      home1H:    bytes[34],
      away1H:    bytes[35],
      homeFinal: bytes[36],
      awayFinal: bytes[37],
    },
  };
}

const STATE_NAMES = ['TRADING', 'HALFTIME_PENDING', 'HALFTIME_TRADING', 'FINAL_PENDING', 'SETTLED'];

// =============================================================================
// Script integer arithmetic helpers
// =============================================================================

/**
 * Interpret bytes as a Bitcoin Script integer (little-endian, sign bit in MSB of last byte).
 * This matches CashScript's `int(bytes)` operator.
 */
function scriptIntFromBytes(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let result = 0;
  for (let i = 0; i < bytes.length; i++) {
    result |= bytes[i] << (i * 8);
  }
  // Check sign bit (top bit of last byte)
  const isNegative = (bytes[bytes.length - 1] & 0x80) !== 0;
  if (isNegative) {
    // Clear sign bit and negate
    result &= ~(0x80 << ((bytes.length - 1) * 8));
    result = -result;
  }
  return result;
}

/**
 * Perform OP_MOD semantics: result has same sign as dividend (like C remainder, not Python modulo).
 */
function scriptMod(a: number, b: number): number {
  return a % b; // JS % already matches OP_MOD sign behavior
}

/**
 * Encode a Script integer as N bytes (mirrors CashScript's bytesN(x) = NUM2BIN(x, N)).
 * For N=1: positive < 128 → the byte value; negative → (|x| | 0x80).
 */
function scriptIntToBytes1(value: number): number {
  if (value >= 0) {
    if (value > 127) throw new Error(`Value ${value} does not fit in 1 signed byte`);
    return value;
  } else {
    // Negative: store magnitude with sign bit set
    const magnitude = -value;
    if (magnitude > 127) throw new Error(`Value ${value} does not fit in 1 signed byte`);
    return magnitude | 0x80;
  }
}

// =============================================================================
// Commitment builders (mirror the contract logic)
// =============================================================================

/** Change just the state byte, preserving the rest of the commitment. */
function buildNewCommitment(currentHex: string, newState: number): string {
  const bytes = hexToBin(currentHex);
  const copy = new Uint8Array(bytes);
  copy[0] = newState;
  return binToHex(copy);
}

/**
 * Compute what the contract will produce as the halftime commitment.
 * Mirrors revealHalftime() in amm-pool-v2.cash:
 *   seed = hash256(h1 + h2 + h3 + matchId)
 *   scoreHash = hash256(seed + 0x48)   // 'H' = 72
 *   homeScore1H = 30 + (int(scoreHash[0:2]) % 46)
 *   awayScore1H = 30 + (int(scoreHash[2:4]) % 46)
 *   new commitment: byte[0]=2, bytes[1-33] unchanged, bytes[34]=homeScore1H, bytes[35]=awayScore1H, bytes[36-37]=0
 */
function computeHalftimeCommitment(
  currentHex: string,
  h1: Uint8Array,
  h2: Uint8Array,
  h3: Uint8Array,
): string {
  const bytes = hexToBin(currentHex);
  const sportType = bytes[25];
  const matchId = bytes.slice(26, 34);

  // seed = hash256(h1 + h2 + h3 + matchId)
  const seedInput = new Uint8Array([...h1, ...h2, ...h3, ...matchId]);
  const seed = hash256(seedInput);

  // scoreHash = hash256(seed + 'H')
  const scoreHashInput = new Uint8Array([...seed, 0x48]);
  const scoreHash = hash256(scoreHashInput);

  let homeScore1H: number;
  let awayScore1H: number;

  // CashScript int(bytes) = Bitcoin Script integer (little-endian, sign bit in MSB of last byte)
  // Must use scriptIntFromBytes() to match OP_BIN2NUM behavior exactly.
  if (sportType === 0) {
    // Basketball: 30-75 (range 46)
    const v1 = scriptIntFromBytes(scoreHash.slice(0, 2));
    const v2 = scriptIntFromBytes(scoreHash.slice(2, 4));
    homeScore1H = 30 + scriptMod(v1, 46);
    awayScore1H = 30 + scriptMod(v2, 46);
  } else if (sportType === 1) {
    // Football/Soccer: 0-4 (range 5)
    // scoreHash.split(1)[0] = byte[0] only (1 byte, sign bit in bit 7)
    // scoreHash.split(2)[0].split(1)[1] = byte[1] only (1 byte)
    const v1 = scriptIntFromBytes(scoreHash.slice(0, 1));
    const v2 = scriptIntFromBytes(scoreHash.slice(1, 2));
    homeScore1H = scriptMod(v1, 5);
    awayScore1H = scriptMod(v2, 5);
  } else {
    // American football: 0-28 (range 29)
    const v1 = scriptIntFromBytes(scoreHash.slice(0, 2));
    const v2 = scriptIntFromBytes(scoreHash.slice(2, 4));
    homeScore1H = scriptMod(v1, 29);
    awayScore1H = scriptMod(v2, 29);
  }

  const result = new Uint8Array(38);
  result[0] = 2; // HALFTIME_TRADING
  result.set(bytes.slice(1, 34), 1); // preserve reserves, blocks, sportType, matchId
  result[34] = scriptIntToBytes1(homeScore1H);
  result[35] = scriptIntToBytes1(awayScore1H);
  result[36] = 0;
  result[37] = 0;
  return binToHex(result);
}

/**
 * Compute what the contract will produce as the final commitment.
 * Mirrors revealFinal() in amm-pool-v2.cash:
 *   seed = hash256(h1 + h2 + h3 + matchId)
 *   scoreHash = hash256(seed + 0x46)   // 'F' = 70
 *   homeScore2H = 30 + (int(scoreHash[0:2]) % 46)
 *   awayScore2H = 30 + (int(scoreHash[2:4]) % 46)
 *   homeFinal = homeScore1H + homeScore2H
 *   awayFinal = awayScore1H + awayScore2H
 */
function computeFinalCommitment(
  currentHex: string,
  h1: Uint8Array,
  h2: Uint8Array,
  h3: Uint8Array,
): string {
  const bytes = hexToBin(currentHex);
  const sportType = bytes[25];
  const matchId = bytes.slice(26, 34);
  // Scores are stored as Script integer bytes (bytes1 encoding).
  // Must decode them back to Script integers to match the contract's int() read.
  const homeScore1H = scriptIntFromBytes(bytes.slice(34, 35));
  const awayScore1H = scriptIntFromBytes(bytes.slice(35, 36));

  // seed = hash256(h1 + h2 + h3 + matchId)
  const seedInput = new Uint8Array([...h1, ...h2, ...h3, ...matchId]);
  const seed = hash256(seedInput);

  // scoreHash = hash256(seed + 'F')
  const scoreHashInput = new Uint8Array([...seed, 0x46]);
  const scoreHash = hash256(scoreHashInput);

  let homeScore2H: number;
  let awayScore2H: number;

  // CashScript int(bytes) = Bitcoin Script integer (little-endian, sign bit in MSB of last byte)
  if (sportType === 0) {
    const v1 = scriptIntFromBytes(scoreHash.slice(0, 2));
    const v2 = scriptIntFromBytes(scoreHash.slice(2, 4));
    homeScore2H = 30 + scriptMod(v1, 46);
    awayScore2H = 30 + scriptMod(v2, 46);
  } else if (sportType === 1) {
    const v1 = scriptIntFromBytes(scoreHash.slice(0, 1));
    const v2 = scriptIntFromBytes(scoreHash.slice(1, 2));
    homeScore2H = scriptMod(v1, 5);
    awayScore2H = scriptMod(v2, 5);
  } else {
    const v1 = scriptIntFromBytes(scoreHash.slice(0, 2));
    const v2 = scriptIntFromBytes(scoreHash.slice(2, 4));
    homeScore2H = scriptMod(v1, 29);
    awayScore2H = scriptMod(v2, 29);
  }

  const homeFinal = homeScore1H + homeScore2H;
  const awayFinal = awayScore1H + awayScore2H;

  const result = new Uint8Array(38);
  result[0] = 4; // SETTLED
  result.set(bytes.slice(1, 34), 1);
  result[34] = scriptIntToBytes1(homeScore1H);
  result[35] = scriptIntToBytes1(awayScore1H);
  result[36] = scriptIntToBytes1(homeFinal);
  result[37] = scriptIntToBytes1(awayFinal);
  return binToHex(result);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function printSep(c = '─', n = 62) { console.log(c.repeat(n)); }

// =============================================================================
// Main
// =============================================================================

async function main() {
  // Load config
  const WIF = process.env.DEPLOY_WIF;
  if (!WIF) {
    console.error('ERROR: DEPLOY_WIF not set in .env');
    process.exit(1);
  }

  const POOL_REGISTRY_ENV = process.env.POOL_REGISTRY ?? process.env.VITE_POOL_REGISTRY ?? '[]';
  const registry: Array<{
    poolAddress: string;
    homeTokenCategory: string;
    awayTokenCategory: string;
  }> = JSON.parse(POOL_REGISTRY_ENV);

  if (registry.length === 0) {
    console.error('ERROR: POOL_REGISTRY is empty in .env. Run deploy first.');
    process.exit(1);
  }

  const { poolAddress, homeTokenCategory, awayTokenCategory } = registry[0];
  console.log(`Pool: ${poolAddress}`);
  console.log(`HOME category: ${homeTokenCategory}`);
  console.log(`AWAY category: ${awayTokenCategory}`);

  const { privateKey, address: caller } = loadWif(WIF);
  const sigTemplate = new SignatureTemplate(privateKey);
  const provider    = getProvider();
  const wsUrl       = `wss://${ELECTRUM_HOSTNAMES[NETWORK_ARG] ?? ELECTRUM_HOSTNAMES.chipnet}:50004`;

  // Load contract
  const artifactPath = resolve(__dirname, '..', 'contracts', 'amm-pool.json');
  const artifact     = JSON.parse(readFileSync(artifactPath, 'utf8'));

  const contract = new Contract(artifact, [
    hexToBin(homeTokenCategory),
    hexToBin(awayTokenCategory),
    FEE_NUMERATOR,
    FEE_DENOMINATOR,
    PRICE_PER_UNIT,
  ], { provider });

  printSep('═');
  console.log('  SportsBet.cash — Advance Game');
  printSep('═');

  // Main loop: advance state until SETTLED (4)
  while (true) {
    // Fetch pool UTXOs (token UTXOs require special Electrum query)
    const allUtxos = await provider.getUtxos(contract.tokenAddress);
    const poolUtxo = allUtxos.find(u => u.token?.nft?.capability === 'minting');

    if (!poolUtxo || !poolUtxo.token?.nft?.commitment) {
      console.error('ERROR: Could not find pool state UTXO (minting NFT)');
      process.exit(1);
    }

    const ps = parseCommitment(poolUtxo.token.nft.commitment);

    printSep();
    console.log(`Current state: ${ps.state} (${STATE_NAMES[ps.state] ?? 'UNKNOWN'})`);
    console.log(`Halftime block: ${ps.halftimeBlock}  |  End block: ${ps.endBlock}`);
    console.log(`Reserves: HOME=${ps.reserveHome} sats  AWAY=${ps.reserveAway} sats`);

    if (ps.state === 4) {
      printSep('═');
      console.log('  Pool is SETTLED!');
      console.log(`  Halftime scores: ${ps.scores.home1H} - ${ps.scores.away1H}`);
      console.log(`  Final scores:    ${ps.scores.homeFinal} - ${ps.scores.awayFinal}`);
      const winner = ps.scores.homeFinal > ps.scores.awayFinal ? 'HOME' :
                     ps.scores.awayFinal > ps.scores.homeFinal ? 'AWAY' : 'DRAW';
      console.log(`  Winner: ${winner}`);
      printSep('═');
      break;
    }

    if (ps.state === 0) {
      // ─── endTradingPhase1: state 0 → 1 ──────────────────────────────────
      // New commitment: byte 0 = 0x01, rest unchanged
      console.log('\n→ Calling endTradingPhase1() ...');

      const newToken = {
        ...poolUtxo.token!,
        nft: { ...poolUtxo.token!.nft!, commitment: buildNewCommitment(poolUtxo.token!.nft!.commitment, 1) },
      };

      const tx = await new TransactionBuilder({ provider })
        .addInput(poolUtxo, contract.unlock.endTradingPhase1())
        .addOutput({ to: contract.tokenAddress, amount: poolUtxo.satoshis - FEE, token: newToken })
        .setLocktime(ps.halftimeBlock)
        .send();

      console.log(`  ✓ endTradingPhase1 txid: ${tx.txid}`);
      await sleep(3000);
      continue;
    }

    if (ps.state === 1) {
      // ─── revealHalftime: state 1 → 2 ────────────────────────────────────
      console.log(`\n→ Fetching block hashes for halftime reveal (blocks ${ps.halftimeBlock}, ${ps.halftimeBlock+1}, ${ps.halftimeBlock+2}) ...`);

      const [h1, h2, h3] = await getBlockHashes(
        [ps.halftimeBlock, ps.halftimeBlock + 1, ps.halftimeBlock + 2],
        wsUrl,
      );

      console.log(`  h1 (${ps.halftimeBlock}): ${binToHex(h1)}`);
      console.log(`  h2 (${ps.halftimeBlock+1}): ${binToHex(h2)}`);
      console.log(`  h3 (${ps.halftimeBlock+2}): ${binToHex(h3)}`);

      console.log('\n→ Calling revealHalftime() ...');

      // The contract enforces the new commitment (state=2, scores set).
      // We let CashScript verify; we need to provide the CORRECT expected output commitment.
      // Simulate what the contract will compute for the output commitment:
      const htCommitment = computeHalftimeCommitment(poolUtxo.token!.nft!.commitment, h1, h2, h3);
      console.log(`  Expected HT commitment: ${htCommitment}`);

      const newToken = {
        ...poolUtxo.token!,
        nft: { ...poolUtxo.token!.nft!, commitment: htCommitment },
      };

      const tx = await new TransactionBuilder({ provider })
        .addInput(poolUtxo, contract.unlock.revealHalftime(h1, h2, h3))
        .addOutput({ to: contract.tokenAddress, amount: poolUtxo.satoshis - FEE, token: newToken })
        .send();

      console.log(`  ✓ revealHalftime txid: ${tx.txid}`);
      await sleep(3000);
      continue;
    }

    if (ps.state === 2) {
      // ─── endHalftimeTrading: state 2 → 3 ────────────────────────────────
      console.log('\n→ Calling endHalftimeTrading() ...');

      const newToken = {
        ...poolUtxo.token!,
        nft: { ...poolUtxo.token!.nft!, commitment: buildNewCommitment(poolUtxo.token!.nft!.commitment, 3) },
      };

      const tx = await new TransactionBuilder({ provider })
        .addInput(poolUtxo, contract.unlock.endHalftimeTrading())
        .addOutput({ to: contract.tokenAddress, amount: poolUtxo.satoshis - FEE, token: newToken })
        .setLocktime(ps.endBlock)
        .send();

      console.log(`  ✓ endHalftimeTrading txid: ${tx.txid}`);
      await sleep(3000);
      continue;
    }

    if (ps.state === 3) {
      // ─── revealFinal: state 3 → 4 ────────────────────────────────────────
      console.log(`\n→ Fetching block hashes for final reveal (blocks ${ps.endBlock}, ${ps.endBlock+1}, ${ps.endBlock+2}) ...`);

      const [h1, h2, h3] = await getBlockHashes(
        [ps.endBlock, ps.endBlock + 1, ps.endBlock + 2],
        wsUrl,
      );

      console.log(`  h1 (${ps.endBlock}): ${binToHex(h1)}`);
      console.log(`  h2 (${ps.endBlock+1}): ${binToHex(h2)}`);
      console.log(`  h3 (${ps.endBlock+2}): ${binToHex(h3)}`);

      console.log('\n→ Calling revealFinal() ...');

      const finalCommitment = computeFinalCommitment(poolUtxo.token!.nft!.commitment, h1, h2, h3);
      console.log(`  Expected final commitment: ${finalCommitment}`);

      const newToken = {
        ...poolUtxo.token!,
        nft: { ...poolUtxo.token!.nft!, commitment: finalCommitment },
      };

      const tx = await new TransactionBuilder({ provider })
        .addInput(poolUtxo, contract.unlock.revealFinal(h1, h2, h3))
        .addOutput({ to: contract.tokenAddress, amount: poolUtxo.satoshis - FEE, token: newToken })
        .send();

      console.log(`  ✓ revealFinal txid: ${tx.txid}`);
      await sleep(3000);
      continue;
    }

    console.error(`Unknown state: ${ps.state}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
