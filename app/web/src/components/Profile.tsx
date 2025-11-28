import React, { useState } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import './Profile.css';

interface ProfileProps {
  channelAddress: string | null;
  aliceBalance: string;
  bobBalance: string;
  currentNonce: number;
  serverUrl: string;
  serverConnected: boolean;
  serverAddress: string | null;
  onServerUrlChange: (url: string) => void;
  onServerUrlSave: () => void;
  onCloseChannel?: () => void;
  onResetChannel?: () => void;
  onClose?: () => void;
  logs: Array<{ message: string; timestamp: Date; type: string }>;
}

export function Profile({
  channelAddress,
  aliceBalance,
  bobBalance,
  currentNonce,
  serverUrl,
  serverConnected,
  serverAddress,
  onServerUrlChange,
  onServerUrlSave,
  onCloseChannel,
  onResetChannel,
  onClose,
  logs
}: ProfileProps) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatBalance = (balance: string) => {
    const value = parseFloat(balance);
    return value.toFixed(4);
  };

  return (
    <div className="profile-container">
      {/* Close Button */}
      {onClose && (
        <button className="profile-close-btn" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}

      {/* Profile Header */}
      <div className="profile-header">
        <div className="profile-avatar">
          {isConnected ? (
            <div className="avatar-connected">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 14a3 3 0 100-6 3 3 0 000 6z" fill="currentColor"/>
                <path d="M12 14c-3.3 0-6 1.3-6 3v1h12v-1c0-1.7-2.7-3-6-3z" fill="currentColor" opacity="0.5"/>
              </svg>
            </div>
          ) : (
            <div className="avatar-disconnected">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
          )}
        </div>

        {isConnected ? (
          <>
            <h2 className="profile-address">{formatAddress(address || '')}</h2>
            <span className="connection-badge connected">
              <span className="status-dot"></span>
              Wallet Connected
            </span>
          </>
        ) : (
          <>
            <h2 className="profile-address">Not Connected</h2>
            <span className="connection-badge disconnected">
              No Wallet Connected
            </span>
          </>
        )}
      </div>

      {/* Channel Information */}
      {isConnected && channelAddress && (
        <div className="profile-section">
          <h3 className="section-title">Payment Channel</h3>
          <div className="channel-card">
            <div className="channel-info">
              <div className="info-row">
                <span className="info-label">Channel</span>
                <span className="info-value">{formatAddress(channelAddress)}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Your Balance</span>
                <span className="info-value balance">{formatBalance(aliceBalance)} ETH</span>
              </div>
              <div className="info-row">
                <span className="info-label">Server Earnings</span>
                <span className="info-value">{formatBalance(bobBalance)} ETH</span>
              </div>
              <div className="info-row">
                <span className="info-label">Transaction #</span>
                <span className="info-value">{currentNonce}</span>
              </div>
            </div>
            {onCloseChannel && (
              <button className="btn-danger-outline" onClick={onCloseChannel}>
                Close Channel
              </button>
            )}
          </div>
        </div>
      )}

      {/* Server Connection */}
      <div className="profile-section">
        <h3 className="section-title">Server Connection</h3>
        <div className="server-card">
          <div className="server-status">
            <span className={`status-indicator ${serverConnected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot"></span>
              {serverConnected ? 'Connected' : 'Disconnected'}
            </span>
            {serverAddress && (
              <span className="server-address">{formatAddress(serverAddress)}</span>
            )}
          </div>

          <button
            className="btn-settings"
            onClick={() => setShowSettings(!showSettings)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
                    stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            Configure
          </button>

          {showSettings && (
            <div className="settings-panel">
              <input
                type="text"
                className="server-input"
                value={serverUrl}
                onChange={(e) => onServerUrlChange(e.target.value)}
                placeholder="Server URL"
              />
              <button className="btn-primary-small" onClick={onServerUrlSave}>
                Save & Connect
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Activity Logs */}
      <div className="profile-section">
        <h3 className="section-title">
          Activity
          <button
            className="btn-toggle"
            onClick={() => setShowLogs(!showLogs)}
          >
            {showLogs ? 'Hide' : 'Show'}
          </button>
        </h3>

        {showLogs && (
          <div className="logs-container">
            {logs.slice(-10).reverse().map((log, index) => (
              <div key={index} className={`log-item ${log.type}`}>
                <span className="log-time">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {isConnected && (
        <div className="profile-actions">
          <button
            className="btn-disconnect"
            onClick={() => {
              // Clear localStorage flag to allow reconnection
              localStorage.removeItem('hasSeenOnboarding');
              // Reset channel state
              if (onResetChannel) {
                onResetChannel();
              }
              // Disconnect wallet
              disconnect();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Disconnect Wallet
          </button>
        </div>
      )}
    </div>
  );
}