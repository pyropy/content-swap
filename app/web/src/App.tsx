import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { StatusBar } from './components/StatusBar';
import { Tabs, type TabId } from './components/Tabs';
import { Catalog } from './components/Catalog';
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

  const handlePurchase = async (contentId: string) => {
    setPurchasing(contentId);
    try {
      const success = await purchaseContent(contentId);
      if (success) {
        setActiveTab('purchased');
      }
    } finally {
      setPurchasing(null);
    }
  };

  return (
    <div className="container">
      <header>
        <h1>Payment Channel Content Client</h1>
        <p>Purchase digital content using Lightning Network payment channels</p>
      </header>

      <StatusBar
        walletAddress={address || null}
        channelAddress={channelAddress}
        aliceBalance={aliceBalance}
        bobBalance={bobBalance}
        currentNonce={currentNonce}
      />

      <Tabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'catalog' && (
        <Catalog
          items={catalog}
          walletConnected={isConnected}
          channelActive={!!channelAddress}
          clientBalance={aliceBalance}
          onPurchase={handlePurchase}
          purchasing={purchasing}
        />
      )}

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
  );
}

export default App;
