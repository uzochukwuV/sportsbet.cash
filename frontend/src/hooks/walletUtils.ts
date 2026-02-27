/**
 * Wallet utility functions — kept separate from useWallet.tsx so that
 * react-refresh fast-reload works correctly (hooks file should only export
 * components/hooks, not plain functions).
 */
import {
  generatePrivateKey,
  privateKeyToP2pkhCashAddress,
  cashAddressToLockingBytecode,
  hexToBin,
  binToHex,
} from '@bitauth/libauth';

const IS_CHIPNET = import.meta.env.VITE_NETWORK !== 'mainnet';
const ADDRESS_PREFIX = IS_CHIPNET ? 'bchtest' : 'bitcoincash';

/** Generate a fresh random private key (hex string). */
export function generateLocalPrivKey(): string {
  const privKey = generatePrivateKey(() => crypto.getRandomValues(new Uint8Array(32)));
  if (typeof privKey === 'string') throw new Error('Key generation failed: ' + privKey);
  return binToHex(privKey);
}

/** Derive a P2PKH cash address from a hex private key. */
export function privKeyToAddress(privKeyHex: string): string {
  const privKeyBytes = hexToBin(privKeyHex);
  const result = privateKeyToP2pkhCashAddress({ privateKey: privKeyBytes, prefix: ADDRESS_PREFIX });
  if (typeof result === 'string') throw new Error('Address derivation failed: ' + result);
  return result.address;
}

/** Validate a hex private key and return its derived address, or null if invalid. */
export function validateAndDeriveAddress(privKeyHex: string): string | null {
  try {
    if (!/^[0-9a-fA-F]{64}$/.test(privKeyHex)) return null;
    return privKeyToAddress(privKeyHex);
  } catch {
    return null;
  }
}

export { cashAddressToLockingBytecode };
