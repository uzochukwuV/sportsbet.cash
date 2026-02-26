/**
 * SportsBet.cash — Deploy Script
 *
 * Deploys an AmmPoolV2 prediction market pool to Bitcoin Cash.
 *
 * Steps:
 *   1. Derive deployer address from DEPLOY_WIF
 *   2. Check balance (prints faucet link if on chipnet)
 *   3. Mint HOME fungible tokens (genesis tx, input 0 = HOME category)
 *   4. Mint AWAY fungible tokens (genesis tx, input 0 = AWAY category)
 *   5. Initialize pool: send state-NFT + both token reserves + BCH liquidity
 *   6. Print pool address + VITE_POOL_REGISTRY env line
 *
 * Usage:
 *   yarn deploy                                  # basketball, chipnet
 *   yarn deploy --generate-wallet                # create fresh deployer key
 *   yarn deploy --network mainnet --sport football --home RMAD --away BARCA
 *
 * Prerequisites:
 *   cp .env.example .env  (fill in DEPLOY_WIF)
 *   Fund deployer address with ≥ INITIAL_LIQUIDITY*2 + ~0.001 BCH fees
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
  binToHex,
  hexToBin,
  generatePrivateKey,
  secp256k1,
  encodeCashAddress,
  hash160,
  encodePrivateKeyWif,
  decodePrivateKeyWif,
  CashAddressNetworkPrefix,
  CashAddressType,
} from '@bitauth/libauth';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as nodeCrypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// CLI args
// =============================================================================

const args = process.argv.slice(2);
function getArg(flag: string, fallback = ''): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (flag: string) => args.includes(flag);

// =============================================================================
// Config
// =============================================================================

const NETWORK_ARG = getArg('--network', process.env.NETWORK ?? 'chipnet');
const NETWORK: Network = NETWORK_ARG === 'mainnet' ? Network.MAINNET : Network.CHIPNET;
const NETWORK_PREFIX: CashAddressNetworkPrefix =
  NETWORK === Network.MAINNET ? CashAddressNetworkPrefix.mainnet : CashAddressNetworkPrefix.testnet;
const WIF_TYPE: 'mainnet' | 'testnet' = NETWORK === Network.MAINNET ? 'mainnet' : 'testnet';

const SPORT_ARG = getArg('--sport', 'basketball');
const HOME_TEAM = getArg('--home', 'LAL1').padEnd(4, '\0').slice(0, 4);
const AWAY_TEAM = getArg('--away', 'GSW1').padEnd(4, '\0').slice(0, 4);

const SPORT_TYPES: Record<string, number> = {
  basketball: 0,
  football: 1,
  american_football: 2,
};
const SPORT_TYPE = SPORT_TYPES[SPORT_ARG] ?? 0;

const FEE_NUMERATOR   = 30n;
const FEE_DENOMINATOR = 10000n;
const PRICE_PER_UNIT  = 10_000n;
const INITIAL_LIQUIDITY = BigInt(process.env.INITIAL_LIQUIDITY ?? '1000000000'); // 10 BCH
const HALFTIME_OFFSET = parseInt(process.env.HALFTIME_OFFSET ?? '6', 10);
const FINAL_OFFSET    = parseInt(process.env.FINAL_OFFSET    ?? '12', 10);
const DUST     = 546n;
const TOKEN_DUST = 800n; // cashscript requires ≥ 651 sats for token outputs; use 800 for safety
const FEE    = 2000n;

// =============================================================================
// Wallet helpers (using correct libauth APIs from BCH.md)
// =============================================================================

// cashscript's default chipnet server (chipnet.bch.ninja) is often unreliable.
// Override with known-good public servers via the { hostname } option.
const ELECTRUM_HOSTNAMES: Record<string, string> = {
  chipnet: 'chipnet.imaginary.cash',
  mainnet: 'bch.imaginary.cash',
};

function getProvider(): ElectrumNetworkProvider {
  const hostname = ELECTRUM_HOSTNAMES[NETWORK_ARG] ?? ELECTRUM_HOSTNAMES.chipnet;
  return new ElectrumNetworkProvider(NETWORK, { hostname });
}

function getCashAddress(pubKeyHash: Uint8Array): string {
  const result = encodeCashAddress({
    prefix: NETWORK_PREFIX,
    type: CashAddressType.p2pkh,
    payload: pubKeyHash,
  });
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'address' in result) {
    return (result as { address: string }).address;
  }
  throw new Error('Failed to encode cash address');
}

function getCashTokenAddress(pubKeyHash: Uint8Array): string {
  const result = encodeCashAddress({
    prefix: NETWORK_PREFIX,
    type: CashAddressType.p2pkhWithTokens,
    payload: pubKeyHash,
  });
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'address' in result) {
    return (result as { address: string }).address;
  }
  throw new Error('Failed to encode token cash address');
}

function deriveAddress(privateKey: Uint8Array): { pubKey: Uint8Array; pubKeyHash: Uint8Array; address: string; tokenAddress: string } {
  const pubKeyResult = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof pubKeyResult === 'string') throw new Error('Failed to derive public key: ' + pubKeyResult);

  const hashResult = hash160(pubKeyResult);
  if (typeof hashResult === 'string') throw new Error('Failed to hash160 public key');

  return {
    pubKey:       pubKeyResult,
    pubKeyHash:   hashResult,
    address:      getCashAddress(hashResult),
    tokenAddress: getCashTokenAddress(hashResult),
  };
}

function loadPrivateKey(wif: string): Uint8Array {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') throw new Error('Invalid WIF: ' + decoded);
  return decoded.privateKey;
}

/**
 * Load deployer key from either:
 *   - A raw WIF string (starts with K, L, or 5)
 *   - A path to an Electron Cash key export JSON: { "cashaddr": "WIF", ... }
 *     Pass --address <suffix> to pick a specific address, otherwise uses first entry.
 */
function loadWif(deployWifEnv: string, selectAddress?: string): { privateKey: Uint8Array; address: string; tokenAddress: string } {
  const isWif = /^[KL5]/.test(deployWifEnv.trim());

  if (isWif) {
    const privateKey = loadPrivateKey(deployWifEnv.trim());
    const { address, tokenAddress } = deriveAddress(privateKey);
    return { privateKey, address, tokenAddress };
  }

  // Treat as path to Electron Cash JSON export: { "qpkc8k...": "L4w1iA...", ... }
  const filePath = resolve(__dirname, '..', deployWifEnv.trim());
  if (!existsSync(filePath)) {
    throw new Error(
      `Key file not found: ${filePath}\n` +
      `Set DEPLOY_WIF to a WIF string or a relative path to your Electron Cash key export JSON.`
    );
  }

  const json: Record<string, string> = JSON.parse(readFileSync(filePath, 'utf8'));
  const entries = Object.entries(json); // [["qpkc8k...", "L4w1iA..."], ...]
  if (entries.length === 0) throw new Error('Key file is empty');

  let wif: string;
  if (selectAddress) {
    const found = entries.find(([addr]) => addr === selectAddress || addr.endsWith(selectAddress));
    if (!found) throw new Error(`Address "${selectAddress}" not found in key file`);
    wif = found[1];
    console.log(`  Using address: ${found[0]}`);
  } else {
    const [addr, w] = entries[0];
    wif = w;
    console.log(`  Using first address in key file: ${addr}`);
  }

  const privateKey = loadPrivateKey(wif);
  const { address, tokenAddress } = deriveAddress(privateKey);
  return { privateKey, address, tokenAddress };
}

// =============================================================================
// Commitment builder
// =============================================================================

function writeLE(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = 0; i < length; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}

function buildCommitment(p: {
  state: number;
  reserveHome: bigint;
  reserveAway: bigint;
  halftimeBlock: number;
  endBlock: number;
  sportType: number;
  matchId: Uint8Array;   // 8 bytes
}): Uint8Array {
  // 38 bytes — within BCH CashTokens 40-byte NFT commitment limit
  // [0] state, [1-8] reserveHome, [9-16] reserveAway,
  // [17-20] halftimeBlock, [21-24] endBlock, [25] sportType,
  // [26-33] matchId, [34-37] scores (init 0)
  const buf = new Uint8Array(38);
  buf[0] = p.state;
  buf.set(writeLE(p.reserveHome, 8), 1);
  buf.set(writeLE(p.reserveAway, 8), 9);
  buf.set(writeLE(BigInt(p.halftimeBlock), 4), 17);
  buf.set(writeLE(BigInt(p.endBlock),      4), 21);
  buf[25] = p.sportType;
  buf.set(p.matchId.slice(0, 8), 26);
  return buf; // bytes 34-37 = scores, stay 0
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function printSep(c = '─', n = 62) { console.log(c.repeat(n)); }

// =============================================================================
// --generate-wallet mode
// =============================================================================

async function generateWallet() {
  const privateKey = generatePrivateKey(() => nodeCrypto.randomBytes(32));
  const wif        = encodePrivateKeyWif(privateKey, WIF_TYPE);
  const { address } = deriveAddress(privateKey);

  printSep('═');
  console.log('  New Deployer Wallet');
  printSep('═');
  console.log(`  WIF:     ${wif}`);
  console.log(`  Address: ${address}`);
  console.log(`  Network: ${NETWORK_ARG}`);
  printSep();
  console.log('\nAdd to .env:');
  console.log(`  DEPLOY_WIF=${wif}`);
  console.log(`\nFund this address before deploying:`);
  if (NETWORK !== Network.MAINNET) {
    console.log('  Chipnet faucet: https://tbch.googol.cash/');
    console.log('  Or:             https://faucet.chipnet.cash/');
  }
  console.log(`\n  Amount needed: ≥ ${Number(INITIAL_LIQUIDITY * 2n) / 1e8} BCH + fees`);
}

// =============================================================================
// UTXO pre-splitter — creates 3 UTXOs each with a unique txid
//
// CashTokens genesis: category = txid of input[0]. Two genesis txs that both
// use outputs of the SAME parent tx would produce the SAME category (same txid,
// different vouts). We must chain 3 sequential send-to-self txs so each
// genesis UTXO has a unique txid.
//
// Chain:  bigUtxo → splitA (change=utxoB) → splitB (change=utxoC)
// Result: utxoA=bigUtxo.txid, utxoB=splitA.txid, utxoC=splitB.txid — all unique.
// =============================================================================

type Utxo = Awaited<ReturnType<ElectrumNetworkProvider['getUtxos']>>[number];

async function prepareGenesisUtxos(
  deployer: string,
  sigTemplate: SignatureTemplate,
  provider: ElectrumNetworkProvider,
  allClean: Utxo[],
): Promise<[Utxo, Utxo, Utxo]> {
  // Each genesis UTXO must have a unique txid (CashTokens category = txid of input[0]).
  // We create them via 3 sequential peel transactions:
  //   bigUtxo → txA: [genesisA (TOKEN_DUST+FEE), change]
  //   change  → txB: [genesisB (TOKEN_DUST+FEE), change]
  //   change  → txC: [genesisC (large, holds pool BCH)]
  //
  // genesisA.txid = bigUtxo.txid (pre-existing, unique)
  // genesisB.txid = txA.txid     (unique)
  // genesisC.txid = txB.txid     (unique)

  // Amount for genesis A and B — must cover TOKEN_DUST output + FEE with no tiny change
  const genesisAmt = TOKEN_DUST + FEE; // exact: token output + fee, no change needed

  // Consolidate if needed
  let bigUtxo: Utxo;
  if (allClean.length === 1) {
    bigUtxo = allClean[0];
  } else {
    console.log(`  Consolidating ${allClean.length} UTXOs into one...`);
    const consolidate = new TransactionBuilder({ provider });
    for (const u of allClean) consolidate.addInput(u, sigTemplate.unlockP2PKH());
    const total = allClean.reduce((s, u) => s + u.satoshis, 0n);
    consolidate.addOutput({ to: deployer, amount: total - FEE });
    const cTx = await consolidate.send();
    console.log(`  ✓ Consolidate txid: ${cTx.txid}`);
    await sleep(3000);
    const fresh = await provider.getUtxos(deployer);
    bigUtxo = fresh.filter(u => !u.token && u.txid === cTx.txid)[0];
  }

  // Peel A: bigUtxo → [genesisA, changeA]
  const txA = await new TransactionBuilder({ provider })
    .addInput(bigUtxo, sigTemplate.unlockP2PKH())
    .addOutput({ to: deployer, amount: genesisAmt })
    .addOutput({ to: deployer, amount: bigUtxo.satoshis - genesisAmt - FEE })
    .send();
  console.log(`  ✓ Pre-split A txid: ${txA.txid}`);
  await sleep(3000);

  const freshA  = (await provider.getUtxos(deployer)).filter(u => !u.token && u.txid === txA.txid);
  const genesisA = freshA.find(u => u.satoshis === genesisAmt)!;
  const changeA  = freshA.find(u => u.satoshis !== genesisAmt)!;

  // Peel B: changeA → [genesisB, changeB]
  const txB = await new TransactionBuilder({ provider })
    .addInput(changeA, sigTemplate.unlockP2PKH())
    .addOutput({ to: deployer, amount: genesisAmt })
    .addOutput({ to: deployer, amount: changeA.satoshis - genesisAmt - FEE })
    .send();
  console.log(`  ✓ Pre-split B txid: ${txB.txid}`);
  await sleep(3000);

  const freshB  = (await provider.getUtxos(deployer)).filter(u => !u.token && u.txid === txB.txid);
  const genesisB = freshB.find(u => u.satoshis === genesisAmt)!;
  const changeB  = freshB.find(u => u.satoshis !== genesisAmt)!;

  // Peel C: changeB → [genesisC (large, holds pool BCH + stateNFT)]
  // genesisC = changeB itself (txid = txB.txid... wait, that's same as genesisB)
  // We need genesisC to have a DIFFERENT txid from genesisB.
  // So do one more peel: changeB → txC with a single large output.
  const txC = await new TransactionBuilder({ provider })
    .addInput(changeB, sigTemplate.unlockP2PKH())
    .addOutput({ to: deployer, amount: changeB.satoshis - FEE })
    .send();
  console.log(`  ✓ Pre-split C txid: ${txC.txid}`);
  await sleep(3000);

  const freshC  = (await provider.getUtxos(deployer)).filter(u => !u.token && u.txid === txC.txid);
  const genesisC = freshC[0];

  console.log(`  Genesis UTXOs ready (all unique txids):`);
  console.log(`    Home:  ${genesisA.txid}:${genesisA.vout} (${genesisA.satoshis} sats)`);
  console.log(`    Away:  ${genesisB.txid}:${genesisB.vout} (${genesisB.satoshis} sats)`);
  console.log(`    State: ${genesisC.txid}:${genesisC.vout} (${genesisC.satoshis} sats)`);

  return [genesisA, genesisB, genesisC];
}

// =============================================================================
// Main deploy
// =============================================================================

async function deploy() {
  // Load deployer key
  const WIF = process.env.DEPLOY_WIF;
  if (!WIF) {
    console.error('ERROR: DEPLOY_WIF not set. Run with --generate-wallet to create one.');
    process.exit(1);
  }

  const { privateKey, address: deployer, tokenAddress: deployerToken } = loadWif(WIF, getArg('--address'));
  const sigTemplate = new SignatureTemplate(privateKey);
  const provider    = getProvider();

  printSep('═');
  console.log('  SportsBet.cash — Pool Deployment');
  printSep('═');
  console.log(`  Network:     ${NETWORK_ARG}`);
  console.log(`  Sport:       ${SPORT_ARG} (type ${SPORT_TYPE})`);
  console.log(`  Home:        ${HOME_TEAM}`);
  console.log(`  Away:        ${AWAY_TEAM}`);
  console.log(`  Liquidity:   ${Number(INITIAL_LIQUIDITY) / 1e8} BCH per side`);
  console.log(`  Deployer:    ${deployer}`);
  printSep();

  // ── Load artifact ──────────────────────────────────────────────────────────
  const artifactPath = resolve(__dirname, '../contracts/amm-pool.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  console.log(`\nArtifact: ${artifact.contractName}`);

  // ── Check balance ──────────────────────────────────────────────────────────
  console.log('\nFetching deployer UTXOs...');
  const allUtxos  = await provider.getUtxos(deployer);
  const total     = allUtxos.reduce((s, u) => s + u.satoshis, 0n);
  const needed    = INITIAL_LIQUIDITY * 2n + FEE * 6n + DUST * 4n;

  console.log(`  Balance:  ${(Number(total) / 1e8).toFixed(8)} BCH  (${total.toLocaleString()} sats)`);
  console.log(`  Required: ${(Number(needed) / 1e8).toFixed(8)} BCH  (${needed.toLocaleString()} sats)`);

  if (total < needed) {
    console.error(`\nInsufficient balance.`);
    if (NETWORK !== Network.MAINNET) {
      console.error('Chipnet faucet: https://tbch.googol.cash/');
    }
    process.exit(1);
  }

  // Pre-split into 3 UTXOs each with a unique txid (required for CashTokens genesis)
  console.log('\nPreparing genesis UTXOs (3 unique txids required)...');
  const cleanUtxos = allUtxos.filter(u => !u.token);
  const [genesisHome, genesisAway, genesisState] =
    await prepareGenesisUtxos(deployer, sigTemplate, provider, cleanUtxos);

  // ── Block heights ──────────────────────────────────────────────────────────
  // Estimate current block by fetching deployer balance history length, or default 0
  let currentBlock = 0;
  try {
    // ElectrumNetworkProvider exposes .getBlockHeight() in newer versions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ep = provider as any;
    if (typeof ep.getBlockHeight === 'function') {
      currentBlock = await ep.getBlockHeight();
    } else if (typeof ep.electrum?.request === 'function') {
      const result = await ep.electrum.request('blockchain.headers.subscribe');
      currentBlock = (result as { height: number }).height;
    }
  } catch { /* use 0 */ }

  const creationBlock = currentBlock;
  const halftimeBlock = currentBlock + HALFTIME_OFFSET;
  const endBlock      = currentBlock + FINAL_OFFSET;

  console.log(`\nBlocks: current=${creationBlock}, halftime=${halftimeBlock}, final=${endBlock}`);

  // ── Match ID + commitment ──────────────────────────────────────────────────
  const matchId    = new Uint8Array(nodeCrypto.randomBytes(8));
  const commitment = buildCommitment({
    state: 0,  // TRADING
    reserveHome: INITIAL_LIQUIDITY,
    reserveAway: INITIAL_LIQUIDITY,
    halftimeBlock,
    endBlock,
    sportType: SPORT_TYPE,
    matchId,
  });

  console.log(`\nMatch ID:   ${binToHex(matchId)}`);
  console.log(`Commitment: ${binToHex(commitment)}`);

  const tokenSupply = INITIAL_LIQUIDITY / PRICE_PER_UNIT; // token units per side

  // Each pre-split UTXO has a unique txid → unique CashToken category when used as input[0]
  const homeTokenCategory  = genesisHome.txid;
  const awayTokenCategory  = genesisAway.txid;
  const stateNftCategory   = genesisState.txid;

  console.log('\nToken categories:');
  console.log(`  HOME  (FT):          ${homeTokenCategory}`);
  console.log(`  AWAY  (FT):          ${awayTokenCategory}`);
  console.log(`  State (minting NFT): ${stateNftCategory}`);

  // ── Instantiate contract ───────────────────────────────────────────────────
  const contract = new Contract(
    artifact,
    [hexToBin(homeTokenCategory), hexToBin(awayTokenCategory), FEE_NUMERATOR, FEE_DENOMINATOR, PRICE_PER_UNIT],
    { provider },
  );
  const poolAddress      = contract.address;
  const poolTokenAddress = contract.tokenAddress;
  console.log(`\nPool address:       ${poolAddress}`);
  console.log(`Pool token address: ${poolTokenAddress}`);

  // ── TX 1: Mint HOME tokens ─────────────────────────────────────────────────
  printSep();
  console.log('\n[1/3] Minting HOME tokens...');

  // genesisHome at index 0 → homeTokenCategory = genesisHome.txid
  // genesisHome.satoshis = TOKEN_DUST + FEE exactly, so no change output needed
  const tx1 = await new TransactionBuilder({ provider })
    .addInput(genesisHome, sigTemplate.unlockP2PKH())
    .addOutput({ to: deployerToken, amount: TOKEN_DUST,
      token: { category: homeTokenCategory, amount: tokenSupply } })
    .send();
  console.log(`  ✓ Minted ${tokenSupply.toLocaleString()} HOME tokens  txid: ${tx1.txid}`);
  await sleep(3000);

  // ── TX 2: Mint AWAY tokens ─────────────────────────────────────────────────
  console.log('\n[2/3] Minting AWAY tokens...');

  // genesisAway at index 0 → awayTokenCategory = genesisAway.txid
  const tx2 = await new TransactionBuilder({ provider })
    .addInput(genesisAway, sigTemplate.unlockP2PKH())
    .addOutput({ to: deployerToken, amount: TOKEN_DUST,
      token: { category: awayTokenCategory, amount: tokenSupply } })
    .send();
  console.log(`  ✓ Minted ${tokenSupply.toLocaleString()} AWAY tokens  txid: ${tx2.txid}`);
  await sleep(3000);

  // ── TX 3: Initialize pool ──────────────────────────────────────────────────
  console.log('\n[3/3] Initializing pool (state NFT + liquidity + token reserves)...');

  const [bchUtxos, tokUtxos] = await Promise.all([
    provider.getUtxos(deployer),
    provider.getUtxos(deployerToken),
  ]);
  const homeTokenU = tokUtxos.find(u => u.token?.category === homeTokenCategory && !u.token?.nft);
  const awayTokenU = tokUtxos.find(u => u.token?.category === awayTokenCategory && !u.token?.nft);

  if (!homeTokenU || !awayTokenU) {
    console.error('Could not find minted token UTXOs'); process.exit(1);
  }

  // genesisState at index 0 → stateNftCategory = genesisState.txid
  const poolBch   = INITIAL_LIQUIDITY * 2n;
  const bchTotal  = bchUtxos.filter(u => !u.token).reduce((s, u) => s + u.satoshis, 0n);
  const bchNeeded = poolBch + TOKEN_DUST * 2n + FEE;
  if (bchTotal < bchNeeded) {
    console.error(`Insufficient BCH: have ${bchTotal}, need ${bchNeeded}`); process.exit(1);
  }

  const tx3Builder = new TransactionBuilder({ provider })
    .addInput(genesisState, sigTemplate.unlockP2PKH())  // index 0 → stateNftCategory
    .addInput(homeTokenU,   sigTemplate.unlockP2PKH())
    .addInput(awayTokenU,   sigTemplate.unlockP2PKH());

  // Add BCH inputs to cover pool liquidity
  let bchIn = genesisState.satoshis + homeTokenU.satoshis + awayTokenU.satoshis;
  for (const u of bchUtxos.filter(u2 => !u2.token)) {
    if (bchIn >= bchNeeded) break;
    tx3Builder.addInput(u, sigTemplate.unlockP2PKH());
    bchIn += u.satoshis;
  }

  tx3Builder
    .addOutput({ to: poolTokenAddress, amount: poolBch,
      token: { category: stateNftCategory, amount: 0n,
        nft: { capability: 'minting', commitment: binToHex(commitment) } } })
    .addOutput({ to: poolTokenAddress, amount: TOKEN_DUST,
      token: { category: homeTokenCategory, amount: tokenSupply } })
    .addOutput({ to: poolTokenAddress, amount: TOKEN_DUST,
      token: { category: awayTokenCategory, amount: tokenSupply } });

  const tx3Change = bchIn - poolBch - TOKEN_DUST * 2n - FEE;
  if (tx3Change > DUST) tx3Builder.addOutput({ to: deployer, amount: tx3Change });

  const tx3 = await tx3Builder.send();
  console.log(`  ✓ Pool initialized!`);
  console.log(`  txid: ${tx3.txid}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  printSep('═');
  console.log('\n  DEPLOYMENT COMPLETE\n');
  printSep('═');

  const summary = {
    network:           NETWORK_ARG,
    poolAddress,
    homeTokenCategory,
    awayTokenCategory,
    stateNftCategory,
    matchId:           binToHex(matchId),
    sport:             SPORT_ARG,
    homeTeam:          HOME_TEAM,
    awayTeam:          AWAY_TEAM,
    initialLiquidity:  INITIAL_LIQUIDITY.toString(),
    pricePerUnit:      PRICE_PER_UNIT.toString(),
    blocks:            { creationBlock, halftimeBlock, endBlock },
    txids:             { mintHome: tx1.txid, mintAway: tx2.txid, init: tx3.txid },
  };

  console.log(JSON.stringify(summary, null, 2));

  printSep();
  console.log('\nAdd to frontend/.env:');
  console.log(`VITE_POOL_REGISTRY='${JSON.stringify([{ poolAddress, homeTokenCategory, awayTokenCategory }])}'`);
  printSep();
  console.log('\nNext steps:');
  console.log(`  1. Paste VITE_POOL_REGISTRY into frontend/.env`);
  console.log(`  2. yarn frontend:dev`);
  console.log(`  3. At block ${halftimeBlock}: yarn tsx scripts/reveal-halftime.ts`);
  console.log(`  4. At block ${endBlock}:      yarn tsx scripts/reveal-final.ts`);
}

// =============================================================================
// Entry point
// =============================================================================

if (hasFlag('--generate-wallet')) {
  generateWallet().catch(e => { console.error(e); process.exit(1); });
} else {
  deploy().catch(e => { console.error('\nDeployment failed:', e); process.exit(1); });
}
