import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { StatusBar } from './components/StatusBar';
import { Tabs, type TabId } from './components/Tabs';
import { VideoFeed } from './components/VideoFeed';
import { Purchased } from './components/Purchased';
import { Logs } from './components/Logs';
import { ChannelSetup } from './components/ChannelSetup';
import { Settings } from './components/Settings';
import { useAppState } from './hooks/useAppState';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('catalog');
  const [purchasing, setPurchasing] = useState<string | null>(null);

  const { isConnected } = useAccount();

  const {
    address,
    onWalletConnect,
    channels,
    channelAddress,
    selectChannel,
    currentNonce,
    aliceBalance,
    bobBalance,
    catalog,
    loadCatalog,
    purchasedContent,
    purchaseContent,
    purchaseVideo,
    serverAddress,
    serverConnected,
    contractAbi,
    loadServerInfo,
    serverUrl,
    setServerUrl,
    logs,
    addLog,
    setupChannel,
    closeChannel,
  } = useAppState();

  // Initialize revocation seed when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      onWalletConnect(address);
    }
  }, [isConnected, address, onWalletConnect]);

  // Auto-fetch server config when server URL is saved
  const handleServerUrlSave = async () => {
    try {
      await loadServerInfo();
      await loadCatalog();
    } catch {
      // Error already logged in loadServerInfo
    }
  };

  // Auto-connect to server on startup
  useEffect(() => {
    addLog('Content client initialized', 'info');
    const connectToServer = async () => {
      try {
        await loadServerInfo();
        await loadCatalog();
      } catch {
        addLog('Failed to connect to server. Check Settings.', 'warning');
      }
    };
    connectToServer();
  }, []);

  const handlePurchase = async (videoId: string, purchaseType: 'full' | 'segment', segmentName?: string) => {
    setPurchasing(videoId);
    try {
      addLog(`Purchase request: ${videoId} (${purchaseType})`, 'info');

      // Use the new purchaseVideo function for video purchases
      const result = await purchaseVideo(videoId, purchaseType, segmentName);
      if (result.success) {
        addLog(`Successfully purchased: ${videoId} (${purchaseType})`, 'success');
        // Return the revocation secret if present (for full video purchases)
        return result.revocationSecret;
      } else {
        addLog(`Failed to purchase: ${videoId}`, 'error');
        return undefined;
      }
    } catch (error) {
      addLog(`Purchase error: ${(error as Error).message}`, 'error');
    } finally {
      setPurchasing(null);
    }
  };


  return (
    <>
      <StatusBar
        walletAddress={address || null}
        channelAddress={channelAddress}
        currentNonce={currentNonce}
        aliceBalance={aliceBalance}
        bobBalance={bobBalance}
      />

      {/* Video feed gets full screen without container */}
      {activeTab === 'catalog' ? (
        <>
          <Tabs activeTab={activeTab} onTabChange={setActiveTab} />
          <VideoFeed
            items={catalog}
            serverUrl={serverUrl}
            channelAddress={channelAddress}
            walletConnected={isConnected}
            channelActive={!!channelAddress}
            clientBalance={aliceBalance}
            onPurchase={handlePurchase}
            purchasing={purchasing}
          />
        </>
      ) : (
        <>
          <Tabs activeTab={activeTab} onTabChange={setActiveTab} />
          <div className="container">
            {activeTab === 'purchased' && (
              <Purchased items={purchasedContent} />
            )}

            {activeTab === 'logs' && (
              <Logs logs={logs} />
            )}

            {activeTab === 'channel-setup' && (
              <ChannelSetup
                channels={channels}
                activeChannelAddress={channelAddress}
                serverAddress={serverAddress}
                serverConnected={serverConnected}
                walletConnected={isConnected}
                contractLoaded={!!contractAbi}
                onSelectChannel={selectChannel}
                onSetupChannel={setupChannel}
                onCloseChannel={closeChannel}
              />
            )}

            {activeTab === 'settings' && (
              <Settings
                serverUrl={serverUrl}
                onServerUrlChange={setServerUrl}
                onServerUrlSave={handleServerUrlSave}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

export default App;
