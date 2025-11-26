import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useLogs } from './useLogs';
import { useServer } from './useServer';
import { useChannels } from './useChannels';
import { useContent } from './useContent';

export function useAppState() {
  const { address, isConnected } = useAccount();

  // Logs hook
  const { logs, addLog } = useLogs();

  // Server hook
  const {
    serverUrl,
    setServerUrl,
    serverAddress,
    serverConnected,
    contractAbi,
    contractBytecode,
    loadServerInfo,
  } = useServer({ onLog: addLog });

  // Channels hook
  const {
    channels,
    channelAddress,
    currentNonce,
    aliceBalance,
    bobBalance,
    selectChannel,
    updateChannelState,
    setupChannel: setupChannelBase,
    closeChannel: closeChannelBase,
  } = useChannels({ onLog: addLog });

  // Content hook
  const {
    catalog,
    loadCatalog: loadCatalogBase,
    purchasedContent,
    purchaseContent: purchaseContentBase,
    initializeRevocationSeed,
  } = useContent({ onLog: addLog });

  // Wrap loadCatalog to inject serverUrl
  const loadCatalog = useCallback(async () => {
    await loadCatalogBase(serverUrl);
  }, [loadCatalogBase, serverUrl]);

  // Wrap purchaseContent to inject config and update channel state
  const purchaseContent = useCallback(async (contentId: string): Promise<boolean> => {
    if (!address || !isConnected) throw new Error('Wallet not connected');
    if (!channelAddress) throw new Error('No active channel');

    const result = await purchaseContentBase(contentId, {
      address,
      serverUrl,
      channelAddress,
    });

    if (result.success && result.newAlice !== undefined && result.newBob !== undefined && result.newNonce !== undefined) {
      updateChannelState(result.newAlice, result.newBob, result.newNonce);
    }

    return result.success;
  }, [address, isConnected, purchaseContentBase, serverUrl, channelAddress, updateChannelState]);

  // Wrap setupChannel to inject config
  const setupChannel = useCallback(async (
    yourDeposit: string,
    disputePeriod: number,
    onProgress: (step: number, message: string) => void
  ): Promise<string | null> => {
    if (!address || !isConnected || !contractAbi || !contractBytecode || !serverAddress) {
      throw new Error('Missing requirements for channel setup');
    }

    return setupChannelBase(yourDeposit, disputePeriod, onProgress, {
      address,
      serverAddress,
      serverUrl,
      contractAbi,
      contractBytecode,
    });
  }, [address, isConnected, contractAbi, contractBytecode, serverAddress, serverUrl, setupChannelBase]);

  // Wrap closeChannel to inject config
  const closeChannel = useCallback(async (): Promise<boolean> => {
    if (!contractAbi) {
      throw new Error('Contract not loaded');
    }

    return closeChannelBase({
      serverUrl,
      contractAbi,
    });
  }, [contractAbi, serverUrl, closeChannelBase]);

  // Initialize when wallet connects
  const onWalletConnect = useCallback((walletAddress: string) => {
    initializeRevocationSeed(walletAddress);
    addLog(`Wallet connected: ${walletAddress}`, 'success');
  }, [initializeRevocationSeed, addLog]);

  return {
    // Wallet
    address,
    isConnected,
    onWalletConnect,

    // Channel
    channels,
    channelAddress,
    selectChannel,
    currentNonce,
    aliceBalance,
    bobBalance,
    setupChannel,
    closeChannel,

    // Content
    catalog,
    loadCatalog,
    purchasedContent,
    purchaseContent,

    // Server/Contract
    serverAddress,
    serverConnected,
    contractAbi,
    loadServerInfo,

    // Config
    serverUrl,
    setServerUrl,

    // Logs
    logs,
    addLog,
  };
}
