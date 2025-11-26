import { useState, useCallback } from 'react';
import { useSignMessage } from 'wagmi';
import { keccak256, encodePacked, parseEther, type Address } from 'viem';
import type { ContentItem, PurchasedContent } from '../types';
import { decryptContent } from '../utils/crypto';
import * as api from '../utils/api';

export interface UseContentOptions {
  onLog?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
}

export function useContent(options: UseContentOptions = {}) {
  const { onLog } = options;

  const { signMessageAsync } = useSignMessage();

  const [catalog, setCatalog] = useState<ContentItem[]>([]);
  const [purchasedContent, setPurchasedContent] = useState<PurchasedContent[]>([]);

  // Revocation state
  const [revocationSeed, setRevocationSeed] = useState<string | null>(null);
  const [revocationSecrets] = useState<Map<number, string>>(new Map());

  const log = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    onLog?.(message, type);
  }, [onLog]);

  const initializeRevocationSeed = useCallback((walletAddress: string) => {
    const seed = keccak256(encodePacked(['string'], ['client-seed-' + walletAddress]));
    setRevocationSeed(seed);
  }, []);

  const generateRevocationSecret = useCallback((nonce: number): string => {
    if (!revocationSeed) throw new Error('Revocation seed not initialized');
    const secret = keccak256(encodePacked(['bytes32', 'uint256'], [revocationSeed as `0x${string}`, BigInt(nonce)]));
    revocationSecrets.set(nonce, secret);
    return secret;
  }, [revocationSeed, revocationSecrets]);

  const generateRevocationHash = useCallback((nonce: number): string => {
    const secret = generateRevocationSecret(nonce);
    return keccak256(secret as `0x${string}`);
  }, [generateRevocationSecret]);

  const loadCatalog = useCallback(async (serverUrl: string) => {
    try {
      const items = await api.fetchCatalog(serverUrl);
      setCatalog(items);
      log(`Loaded ${items.length} items`, 'success');
    } catch (error) {
      log(`Failed to fetch catalog: ${(error as Error).message}`, 'error');
    }
  }, [log]);

  const purchaseContent = useCallback(async (
    contentId: string,
    config: {
      address: string;
      serverUrl: string;
      channelAddress: string;
    }
  ): Promise<{ success: boolean; newAlice?: string; newBob?: string; newNonce?: number }> => {
    const { address, serverUrl, channelAddress } = config;

    try {
      log(`Purchasing content: ${contentId}`, 'info');

      // Step 1: Request content (server tracks balances)
      const { invoice } = await api.requestContent(
        serverUrl,
        contentId,
        channelAddress,
        address
      );

      log(`Received invoice for: ${invoice.title}`, 'info');

      // Step 2: Generate revocation hash
      const aliceRevocationHash = generateRevocationHash(invoice.nonce);
      log(`Generated revocation hash for nonce ${invoice.nonce}`, 'info');

      // Step 3: Sign commitment
      const commitment = invoice.commitment;
      const commitmentData = encodePacked(
        ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
        [
          commitment.channelAddress as Address,
          BigInt(commitment.nonce),
          parseEther(commitment.aliceBalance),
          parseEther(commitment.bobBalance),
          aliceRevocationHash as `0x${string}`,
          commitment.bobRevocationHash as `0x${string}`,
        ]
      );

      const commitmentHash = keccak256(commitmentData);

      const aliceSignature = await signMessageAsync({
        message: { raw: commitmentHash as `0x${string}` },
      });
      log('Commitment signed', 'success');

      // Step 4: Submit to server
      const { revocationSecret } = await api.submitCommitment(
        serverUrl,
        invoice.id,
        commitment,
        aliceSignature,
        aliceRevocationHash
      );
      log('Payment accepted by server', 'success');

      // Step 5: Decrypt content
      const decrypted = await decryptContent(invoice.encryptedContent, revocationSecret);
      log('Content decrypted successfully', 'success');

      setPurchasedContent(prev => [...prev, {
        id: invoice.contentId,
        title: invoice.title,
        content: decrypted,
        price: invoice.price,
        nonce: invoice.nonce,
        timestamp: Date.now(),
      }]);

      log(`Successfully purchased: ${invoice.title}`, 'success');
      // Return balances as strings (from commitment) for consistent formatting
      return { success: true, newAlice: commitment.aliceBalance, newBob: commitment.bobBalance, newNonce: invoice.nonce };
    } catch (error) {
      log(`Purchase failed: ${(error as Error).message}`, 'error');
      return { success: false };
    }
  }, [generateRevocationHash, signMessageAsync, log]);

  return {
    catalog,
    loadCatalog,
    purchasedContent,
    purchaseContent,
    initializeRevocationSeed,
  };
}
