import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { VideoFeed } from './components/VideoFeed';
import { Purchased } from './components/Purchased';
import { Profile } from './components/Profile';
import { BottomNav } from './components/BottomNav';
import { AccountSetup } from './components/AccountSetup';
import { useAppState } from './hooks/useAppState';
import './App.css';

function App() {
  const [activeView, setActiveView] = useState<'feed' | 'purchased' | 'profile'>('feed');
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [setupMessage, setSetupMessage] = useState('');
  const [isSettingUpChannel, setIsSettingUpChannel] = useState(false);

  const { isConnected } = useAccount();

  const {
    address,
    onWalletConnect,
    channelAddress,
    currentNonce,
    aliceBalance,
    bobBalance,
    catalog,
    loadCatalog,
    purchasedContent,
    purchaseVideo,
    serverAddress,
    serverConnected,
    loadServerInfo,
    serverUrl,
    setServerUrl,
    logs,
    addLog,
    setupChannel,
    closeChannel,
    resetChannelState,
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

  // Check if onboarding should be shown
  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem('hasSeenOnboarding');

    // Show onboarding for new users (no flag set) or
    // when user has disconnected and wants to reconnect
    if (!hasSeenOnboarding) {
      // First time user
      if (!isConnected) {
        setShowOnboarding(true);
      }
    }
  }, []); // Only run once on mount

  const handlePurchase = async (videoId: string, purchaseType: 'full' | 'segment', segmentName?: string) => {
    // Check if wallet is connected
    if (!isConnected) {
      setShowOnboarding(true);
      return undefined;
    }

    // Check if channel exists
    if (!channelAddress) {
      setShowOnboarding(true);
      return undefined;
    }

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

  const handleChannelSetup = async (fundAmount: string) => {
    setIsSettingUpChannel(true);
    try {
      // Update progress callbacks
      const updateProgress = (step: number, message: string) => {
        setSetupStep(step);
        setSetupMessage(message);
      };

      await setupChannel(
        fundAmount,
        86400, // 24 hour dispute period
        updateProgress
      );

      // Mark onboarding as complete
      localStorage.setItem('hasSeenOnboarding', 'true');
    } catch (error) {
      addLog(`Channel setup failed: ${(error as Error).message}`, 'error');
      throw error;
    } finally {
      setIsSettingUpChannel(false);
    }
  };

  const handleOnboardingClose = () => {
    setShowOnboarding(false);
    localStorage.setItem('hasSeenOnboarding', 'true');
  };

  return (
    <div className="app-container">
      {/* Account Setup Modal */}
      <AccountSetup
        isOpen={showOnboarding}
        onClose={handleOnboardingClose}
        onChannelSetup={handleChannelSetup}
        channelExists={!!channelAddress}
        isSettingUp={isSettingUpChannel}
        setupStep={setupStep}
        setupMessage={setupMessage}
      />

      {/* Main Content Views */}
      {activeView === 'feed' && (
        <VideoFeed
          items={catalog}
          serverUrl={serverUrl}
          channelAddress={channelAddress}
          walletConnected={isConnected}
          channelActive={!!channelAddress}
          clientBalance={aliceBalance}
          onPurchase={handlePurchase}
          purchasing={purchasing}
          onAccountClick={() => {
            // If not connected or no channel, show onboarding
            if (!isConnected || !channelAddress) {
              setShowOnboarding(true);
            } else {
              // Otherwise, switch to profile view
              setActiveView('profile');
            }
          }}
        />
      )}

      {activeView === 'purchased' && (
        <div className="purchased-view">
          <div className="view-header">
            <h1>Your Library</h1>
          </div>
          <Purchased items={purchasedContent} />
        </div>
      )}

      {activeView === 'profile' && (
        <Profile
          channelAddress={channelAddress}
          aliceBalance={aliceBalance}
          bobBalance={bobBalance}
          currentNonce={currentNonce}
          serverUrl={serverUrl}
          serverConnected={serverConnected}
          serverAddress={serverAddress}
          onServerUrlChange={setServerUrl}
          onServerUrlSave={handleServerUrlSave}
          onCloseChannel={closeChannel}
          onResetChannel={resetChannelState}
          onClose={() => setActiveView('feed')}
          logs={logs}
        />
      )}

      {/* Bottom Navigation */}
      <BottomNav
        activeView={activeView}
        onViewChange={setActiveView}
        purchasedCount={purchasedContent.length}
      />
    </div>
  );
}

export default App;
