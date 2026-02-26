import { ElectrumNetworkProvider, Contract, Network } from 'cashscript';
import type { Artifact } from 'cashscript';

export interface ConstructorArg {
  name: string;
  type: 'bytes20' | 'int' | 'bytes' | 'pubkey' | 'sig';
  value?: string | bigint;
}

interface DeployRequest {
  artifact: Artifact;
  constructorArgs: ConstructorArg[];
}

interface DeployResponse {
  address?: string;
  error?: string;
}

const providerCache = new Map<Network, ElectrumNetworkProvider>();

export function getProvider(network: Network): ElectrumNetworkProvider {
  if (!providerCache.has(network)) {
    providerCache.set(network, new ElectrumNetworkProvider(network));
  }
  return providerCache.get(network)!;
}

// Deploy contract to specified network
export async function deployToNetwork(
  request: DeployRequest,
  network: Network,
): Promise<DeployResponse> {
  try {
    const networkProvider = getProvider(network);

    // Build args in the order defined by the artifact's constructorInputs,
    // matching by name so the caller's ordering never matters.
    const argMap = new Map(request.constructorArgs.map((a) => [a.name, a]));
    const args = request.artifact.constructorInputs.map((input) => {
      const arg = argMap.get(input.name);
      if (!arg) throw new Error(`Missing constructor arg: ${input.name}`);
      if (arg.type === 'bytes20' || arg.type === 'bytes') {
        return arg.value as string;
      }
      if (arg.type === 'int') {
        return typeof arg.value === 'bigint' ? arg.value : BigInt(arg.value ?? 0);
      }
      return arg.value;
    });

    // Create contract instance
    const contract = new Contract(request.artifact, args, { provider: networkProvider });

    // Ensure address is a string
    const address = typeof contract.address === 'string'
      ? contract.address
      : String(contract.address);

    return { address };
  } catch (err) {
    const error = err as Error;
    return { error: `Deployment error: ${error.message}` };
  }
}

// Get balance for an address
export async function getBalance(
  address: string,
  network: Network,
): Promise<{ balance?: string; error?: string }> {
  try {
    const networkProvider = getProvider(network);
    const utxos = await networkProvider.getUtxos(address);
    const balance = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);
    return { balance: balance.toString() };
  } catch (err) {
    const error = err as Error;
    return { error: `Balance error: ${error.message}` };
  }
}

// Validate deploy request
export function validateDeployRequest(body: unknown): DeployRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const req = body as Record<string, unknown>;
  if (!req.artifact || typeof req.artifact !== 'object') {
    return null;
  }
  if (!Array.isArray(req.constructorArgs)) {
    return null;
  }
  return req as unknown as DeployRequest;
}


// compile 

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);
const CASHC_VERSION = '0.10.0';

interface CompileRequest {
  source: string;
}

interface CompileResponse {
  artifact?: object;
  error?: string;
}

// Compile CashScript source to artifact using cashc CLI
export async function compileCashScript(source: string): Promise<CompileResponse> {
  const uuid = uuidv4();
  const tempDir = tmpdir();
  const sourcePath = join(tempDir, `cb-${uuid}.cash`);
  const outputPath = join(tempDir, `cb-${uuid}.json`);

  try {
    // Write source to temp file
    await writeFile(sourcePath, source, 'utf-8');

    // Execute cashc compiler (pin to version matching pragma)
    try {
      await execAsync(`npx cashc@${CASHC_VERSION} "${sourcePath}" --output "${outputPath}"`, {
        timeout: 30000, // 30 second timeout
      });
    } catch (execError) {
      const error = execError as { stderr?: string; message?: string };
      const errorMessage = error.stderr || error.message || 'Unknown compilation error';
      return { error: `Compilation failed: ${errorMessage}` };
    }

    // Read artifact JSON
    const artifactJson = await readFile(outputPath, 'utf-8');
    const artifact = JSON.parse(artifactJson) as object;

    return { artifact };
  } catch (err) {
    const error = err as Error;
    return { error: `Compilation error: ${error.message}` };
  } finally {
    // Cleanup temp files
    try {
      await unlink(sourcePath);
    } catch {
      // Ignore cleanup errors
    }
    try {
      await unlink(outputPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// Validate compile request
export function validateCompileRequest(body: unknown): CompileRequest | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const req = body as Record<string, unknown>;
  if (typeof req.source !== 'string' || req.source.trim() === '') {
    return null;
  }
  return { source: req.source };
}

// 


import {
  generatePrivateKey,
  secp256k1,
  encodeCashAddress,
  hash160,
  CashAddressNetworkPrefix,
  CashAddressType,
  encodePrivateKeyWif,
  decodePrivateKeyWif,
  sha256,
} from '@bitauth/libauth';
import { ElectrumNetworkProvider, Network } from 'cashscript';
import * as crypto from 'crypto';

const providerCache = new Map<Network, ElectrumNetworkProvider>();

function getProvider(network: Network): ElectrumNetworkProvider {
  if (!providerCache.has(network)) {
    providerCache.set(network, new ElectrumNetworkProvider(network));
  }
  return providerCache.get(network)!;
}

function getNetworkEncoding(network: Network): { prefix: CashAddressNetworkPrefix; wif: 'mainnet' | 'testnet' } {
  switch (network) {
    case Network.MAINNET:
      return { prefix: CashAddressNetworkPrefix.mainnet, wif: 'mainnet' };
    case Network.TESTNET3:
    case Network.TESTNET4:
    case Network.CHIPNET:
    default:
      return { prefix: CashAddressNetworkPrefix.testnet, wif: 'testnet' };
  }
}

// Generate BIP39-like mnemonic (simplified - use proper BIP39 in production)
function generateMnemonic(): string {
  const words = [
    'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
    'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
    'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
    'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
    'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
    'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
    'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
    'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
    'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
    'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
    'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
    'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  ];

  const selected: string[] = [];
  for (let i = 0; i < 12; i++) {
    const randomIndex = crypto.randomInt(0, words.length);
    selected.push(words[randomIndex]);
  }
  return selected.join(' ');
}

interface WalletData {
  mnemonic: string;
  privateKeyWif: string;
  publicKeyHex: string;
  address: string;
  cashAddress: string;
}

// Helper to get CashAddress string from result
function getCashAddressString(prefix: string, type: CashAddressType, payload: Uint8Array): string {
  const result = encodeCashAddress({
    prefix: prefix as CashAddressNetworkPrefix,
    type: type,
    payload: payload,
  });

  if (typeof result === 'string') {
    return result;
  }

  // If result is an object with address property
  if (result && typeof result === 'object' && 'address' in result) {
    return (result as { address: string }).address;
  }

  throw new Error('Failed to encode cash address');
}

// Generate a new wallet
export async function generateWallet(network: Network): Promise<WalletData> {
  // Generate random private key
  const privateKey = generatePrivateKey(() => crypto.randomBytes(32));

  // Derive public key
  const publicKeyResult = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKeyResult === 'string') {
    throw new Error('Failed to derive public key: ' + publicKeyResult);
  }
  const publicKey = publicKeyResult;

  // Hash public key for address
  const pubKeyHashResult = hash160(publicKey);
  if (typeof pubKeyHashResult === 'string') {
    throw new Error('Failed to hash public key');
  }
  const pubKeyHash = pubKeyHashResult;

  const networkConfig = getNetworkEncoding(network);

  // Create CashAddress with network prefix
  const cashAddress = getCashAddressString(networkConfig.prefix, CashAddressType.p2pkh, pubKeyHash);

  // Encode private key as WIF
  const wif = encodePrivateKeyWif(privateKey, networkConfig.wif);

  // Generate mnemonic for backup
  const mnemonic = generateMnemonic();

  return {
    mnemonic,
    privateKeyWif: wif,
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
    address: Buffer.from(pubKeyHash).toString('hex'),
    cashAddress,
  };
}

// Import wallet from WIF
export async function importFromWif(wif: string, network: Network): Promise<WalletData> {
  const decoded = decodePrivateKeyWif(wif);

  if (typeof decoded === 'string') {
    throw new Error('Invalid WIF: ' + decoded);
  }

  const privateKey = decoded.privateKey;

  // Derive public key
  const publicKeyResult = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKeyResult === 'string') {
    throw new Error('Failed to derive public key');
  }
  const publicKey = publicKeyResult;

  // Hash public key
  const pubKeyHashResult = hash160(publicKey);
  if (typeof pubKeyHashResult === 'string') {
    throw new Error('Failed to hash public key');
  }
  const pubKeyHash = pubKeyHashResult;

  const networkConfig = getNetworkEncoding(network);

  // Create CashAddress
  const cashAddress = getCashAddressString(networkConfig.prefix, CashAddressType.p2pkh, pubKeyHash);

  return {
    mnemonic: '(imported from WIF)',
    privateKeyWif: wif,
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
    address: Buffer.from(pubKeyHash).toString('hex'),
    cashAddress,
  };
}

// Get wallet balance
export async function getWalletBalance(address: string, network: Network): Promise<{
  confirmed: string;
  unconfirmed: string;
  utxos: number;
}> {
  const networkProvider = getProvider(network);
  const utxos = await networkProvider.getUtxos(address);

  const confirmed = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0n);

  return {
    confirmed: confirmed.toString(),
    unconfirmed: '0',
    utxos: utxos.length,
  };
}

// Sign message with private key
export async function signMessage(message: string, wif: string): Promise<string> {
  const decoded = decodePrivateKeyWif(wif);
  if (typeof decoded === 'string') {
    throw new Error('Invalid WIF');
  }

  const messageHash = sha256.hash(new TextEncoder().encode(message));
  if (typeof messageHash === 'string') {
    throw new Error('Hash failed');
  }

  const signatureResult = secp256k1.signMessageHashSchnorr(decoded.privateKey, messageHash);
  if (typeof signatureResult === 'string') {
    throw new Error('Signing failed: ' + signatureResult);
  }

  return Buffer.from(signatureResult).toString('hex');
}

// No faucet integration: keep logic server-side for balance + wallet only


import { TransactionBuilder, SignatureTemplate, Network } from 'cashscript';
import { decodePrivateKeyWif } from '@bitauth/libauth';
import { getProvider } from './deploy.js';

export interface FundRequest {
  contractAddress: string;
  walletWif: string;
  walletCashAddress: string;
  amountSats: string;
}

export interface FundResponse {
  txid?: string;
  error?: string;
}

const FEE = 1000n; // fixed miner fee in satoshis

export function validateFundRequest(body: unknown): FundRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const req = body as Record<string, unknown>;
  if (typeof req.contractAddress !== 'string' || !req.contractAddress) return null;
  if (typeof req.walletWif !== 'string' || !req.walletWif) return null;
  if (typeof req.walletCashAddress !== 'string' || !req.walletCashAddress) return null;
  if (typeof req.amountSats !== 'string' || !req.amountSats) return null;
  return req as unknown as FundRequest;
}

export async function fundContract(
  request: FundRequest,
  network: Network,
): Promise<FundResponse> {
  try {
    const provider = getProvider(network);
    const amountSats = BigInt(request.amountSats);

    // Decode private key from WIF
    const decoded = decodePrivateKeyWif(request.walletWif);
    if (typeof decoded === 'string') {
      throw new Error('Invalid WIF: ' + decoded);
    }

    // Fetch wallet UTXOs
    const utxos = await provider.getUtxos(request.walletCashAddress);
    if (utxos.length === 0) {
      throw new Error('Wallet has no UTXOs — fund it from the faucet first');
    }

    const totalSats = utxos.reduce((sum, u) => sum + u.satoshis, 0n);
    const changeSats = totalSats - amountSats - FEE;
    if (changeSats < 0n) {
      throw new Error(
        `Insufficient balance: have ${totalSats} sats, need ${amountSats + FEE} (${amountSats} + ${FEE} fee)`,
      );
    }

    // Build the transaction: P2PKH inputs → P2SH32 contract output + change
    const sigTemplate = new SignatureTemplate(decoded.privateKey);
    const txBuilder = new TransactionBuilder({ provider });

    for (const utxo of utxos) {
      txBuilder.addInput(utxo, sigTemplate.unlockP2PKH());
    }

    txBuilder.addOutput({ to: request.contractAddress, amount: amountSats });

    // Return change to wallet (dust threshold: 546 sats)
    if (changeSats >= 546n) {
      txBuilder.addOutput({ to: request.walletCashAddress, amount: changeSats });
    }

    const details = await txBuilder.send();
    const txid = typeof details === 'string' ? details : details.txid;
    return { txid };
  } catch (err) {
    const error = err as Error;
    return { error: `Funding error: ${error.message}` };
  }
}

import { Contract, SignatureTemplate, Network } from 'cashscript';
import type { Artifact } from 'cashscript';
import type { ConstructorArg } from './deploy.js';
import { getProvider } from './deploy.js';

interface FunctionArg extends ConstructorArg {
  signer?: 'wallet' | 'manual';
}

interface UtxoInput {
  txid: string;
  vout: number;
  satoshis: string | number | bigint;
}

interface OutputInput {
  to: string;
  amount: string | number | bigint;
}

export interface InteractionRequest {
  artifact: Artifact;
  constructorArgs: ConstructorArg[];
  functionName: string;
  functionArgs: FunctionArg[];
  utxos: UtxoInput[];
  outputs: OutputInput[];
  fee?: string | number;
  signerWif?: string;
}

export function validateInteractionRequest(body: unknown): InteractionRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const req = body as Record<string, unknown>;
  if (!req.artifact || typeof req.artifact !== 'object') return null;
  if (!Array.isArray(req.constructorArgs)) return null;
  if (typeof req.functionName !== 'string' || req.functionName.length === 0) return null;
  if (!Array.isArray(req.functionArgs)) return null;
  if (!Array.isArray(req.utxos) || req.utxos.length === 0) return null;
  if (!Array.isArray(req.outputs) || req.outputs.length === 0) return null;
  return req as unknown as InteractionRequest;
}

function mapArgs(args: ConstructorArg[]): unknown[] {
  return args.map((arg) => {
    if (arg.type === 'int') {
      return typeof arg.value === 'bigint' ? arg.value : BigInt(arg.value ?? 0);
    }
    return arg.value;
  });
}

function mapFunctionArgs(args: FunctionArg[], signerWif?: string): unknown[] {
  return args.map((arg) => {
    if (arg.type === 'int') {
      return typeof arg.value === 'bigint' ? arg.value : BigInt(arg.value ?? 0);
    }
    if (arg.type === 'sig' && arg.value === 'wallet') {
      if (!signerWif) {
        throw new Error('Signer WIF required for signature arguments');
      }
      return new SignatureTemplate(signerWif);
    }
    return arg.value;
  });
}

export async function interactWithContract(
  request: InteractionRequest,
  network: Network,
): Promise<{ txid?: string; error?: string }> {
  try {
    const provider = getProvider(network);
    const contract = new Contract(request.artifact, mapArgs(request.constructorArgs), { provider });

    const contractFunction = (contract.functions as Record<string, (...args: unknown[]) => any>)[request.functionName];
    if (!contractFunction) {
      return { error: `Function ${request.functionName} not found in contract ABI` };
    }

    const tx = contractFunction(...mapFunctionArgs(request.functionArgs, request.signerWif));

    request.utxos.forEach((utxo) => {
      tx.from({
        txid: utxo.txid,
        vout: utxo.vout,
        satoshis: typeof utxo.satoshis === 'bigint'
          ? utxo.satoshis
          : BigInt(utxo.satoshis),
      });
    });

    if (request.fee) {
      tx.withHardcodedFee(BigInt(request.fee));
    }

    request.outputs.forEach((output) => {
      tx.to(output.to, typeof output.amount === 'bigint' ? output.amount : BigInt(output.amount));
    });

    const details = await tx.send();
    const txid = typeof details === 'string' ? details : details.txid;
    return { txid };
  } catch (err) {
    const error = err as Error;
    return { error: error.message };
  }
}