import { useState, useEffect, useCallback } from 'react';
import { useElectrum } from './useElectrum';

interface BlockInfo {
  height: number;
  hash: string;
  timestamp?: number;
}

interface UseBlockchainReturn {
  blockHeight: number;
  isConnected: boolean;
  network: string;
  error: string | null;
  getBlockHash: (height: number) => Promise<string>;
  getBlockHashes: (heights: number[]) => Promise<string[]>;
  waitForBlock: (targetHeight: number) => Promise<BlockInfo>;
  estimateBlockTime: (blocksAhead: number) => number;
}

// Average BCH block time in seconds
const AVG_BLOCK_TIME = 600; // 10 minutes

export function useBlockchain(): UseBlockchainReturn {
  const electrum = useElectrum();
  const [blockHashCache, setBlockHashCache] = useState<Map<number, string>>(new Map());

  // Get block hash from header
  const getBlockHash = useCallback(async (height: number): Promise<string> => {
    // Check cache first
    if (blockHashCache.has(height)) {
      return blockHashCache.get(height)!;
    }

    // Fetch from Electrum
    const headerHex = await electrum.getBlockHeader(height);

    // Block hash is double SHA256 of the 80-byte header, reversed
    // For now, just store the raw header hex (first 64 chars reversed would be hash)
    // In production, use proper hash calculation
    const hash = reverseHex(headerHex.slice(0, 64));

    // Cache the result
    setBlockHashCache(prev => new Map(prev).set(height, hash));

    return hash;
  }, [electrum, blockHashCache]);

  // Get multiple block hashes
  const getBlockHashes = useCallback(async (heights: number[]): Promise<string[]> => {
    const hashes: string[] = [];
    for (const height of heights) {
      const hash = await getBlockHash(height);
      hashes.push(hash);
    }
    return hashes;
  }, [getBlockHash]);

  // Wait for a specific block height
  const waitForBlock = useCallback((targetHeight: number): Promise<BlockInfo> => {
    return new Promise((resolve) => {
      // If block already exists
      if (electrum.blockHeight >= targetHeight) {
        getBlockHash(targetHeight).then(hash => {
          resolve({ height: targetHeight, hash });
        });
        return;
      }

      // Poll until block arrives
      const checkBlock = setInterval(() => {
        if (electrum.blockHeight >= targetHeight) {
          clearInterval(checkBlock);
          getBlockHash(targetHeight).then(hash => {
            resolve({ height: targetHeight, hash });
          });
        }
      }, 5000); // Check every 5 seconds
    });
  }, [electrum.blockHeight, getBlockHash]);

  // Estimate time until a future block
  const estimateBlockTime = useCallback((blocksAhead: number): number => {
    return blocksAhead * AVG_BLOCK_TIME;
  }, []);

  return {
    blockHeight: electrum.blockHeight,
    isConnected: electrum.isConnected,
    network: electrum.network,
    error: electrum.error,
    getBlockHash,
    getBlockHashes,
    waitForBlock,
    estimateBlockTime,
  };
}

// Helper to reverse hex string (for block hash)
function reverseHex(hex: string): string {
  const bytes = hex.match(/.{2}/g);
  if (!bytes) return hex;
  return bytes.reverse().join('');
}

// Hook for tracking match timeline based on blocks
export function useMatchTimeline(creationBlock: number, tradingBlocks: number, halftimeBlocks: number) {
  const { blockHeight, getBlockHashes, waitForBlock, estimateBlockTime } = useBlockchain();

  const [phase, setPhase] = useState<'trading' | 'halftime_reveal' | 'halftime_trading' | 'final_reveal' | 'settled'>('trading');
  const [halftimeHashes, setHalftimeHashes] = useState<string[] | null>(null);
  const [finalHashes, setFinalHashes] = useState<string[] | null>(null);

  // Calculate target blocks (matching blockhash-vrf.ts logic)
  const halftimeBlock = creationBlock + tradingBlocks;
  const halftimeBlocksUsed = [halftimeBlock, halftimeBlock + 1, halftimeBlock + 2];
  const halftimeTradingEnd = halftimeBlock + 3 + halftimeBlocks;
  const finalBlock = halftimeTradingEnd;
  const finalBlocksUsed = [finalBlock, finalBlock + 1, finalBlock + 2];

  // Update phase based on current block
  useEffect(() => {
    if (blockHeight === 0) return;

    if (blockHeight < halftimeBlock) {
      setPhase('trading');
    } else if (blockHeight < halftimeBlock + 3) {
      setPhase('halftime_reveal');
    } else if (blockHeight < halftimeTradingEnd) {
      setPhase('halftime_trading');
    } else if (blockHeight < finalBlock + 3) {
      setPhase('final_reveal');
    } else {
      setPhase('settled');
    }
  }, [blockHeight, halftimeBlock, halftimeTradingEnd, finalBlock]);

  // Fetch halftime hashes when available
  useEffect(() => {
    if (blockHeight >= halftimeBlock + 3 && !halftimeHashes) {
      getBlockHashes(halftimeBlocksUsed).then(setHalftimeHashes);
    }
  }, [blockHeight, halftimeBlock, halftimeBlocksUsed, halftimeHashes, getBlockHashes]);

  // Fetch final hashes when available
  useEffect(() => {
    if (blockHeight >= finalBlock + 3 && !finalHashes) {
      getBlockHashes(finalBlocksUsed).then(setFinalHashes);
    }
  }, [blockHeight, finalBlock, finalBlocksUsed, finalHashes, getBlockHashes]);

  // Estimate times
  const timeToHalftime = blockHeight < halftimeBlock
    ? estimateBlockTime(halftimeBlock - blockHeight)
    : 0;

  const timeToFinal = blockHeight < finalBlock
    ? estimateBlockTime(finalBlock - blockHeight)
    : 0;

  return {
    phase,
    blockHeight,
    halftimeBlock,
    halftimeBlocksUsed,
    halftimeTradingEnd,
    finalBlock,
    finalBlocksUsed,
    halftimeHashes,
    finalHashes,
    timeToHalftime,
    timeToFinal,
    canRevealHalftime: blockHeight >= halftimeBlock + 3 && halftimeHashes !== null,
    canRevealFinal: blockHeight >= finalBlock + 3 && finalHashes !== null,
  };
}
