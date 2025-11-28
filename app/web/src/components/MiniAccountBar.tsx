import React from 'react';
import './MiniAccountBar.css';

interface MiniAccountBarProps {
  isConnected: boolean;
  channelAddress: string | null;
  balance: string;
  onAccountClick: () => void;
}

export function MiniAccountBar({ isConnected, channelAddress, balance, onAccountClick }: MiniAccountBarProps) {
  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatBalance = (bal: string) => {
    const value = parseFloat(bal);
    return value.toFixed(4);
  };

  return (
    <div className="mini-account-bar" onClick={onAccountClick}>
      <div className="account-status">
        {isConnected ? (
          <>
            <div className="status-dot connected"></div>
            {channelAddress ? (
              <div className="account-info">
                <span className="balance">{formatBalance(balance)} ETH</span>
                <span className="channel">{formatAddress(channelAddress)}</span>
              </div>
            ) : (
              <span className="status-text">Setup Channel</span>
            )}
          </>
        ) : (
          <>
            <div className="status-dot disconnected"></div>
            <span className="status-text">Connect Wallet</span>
          </>
        )}
      </div>
      <svg className="account-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 14a3 3 0 100-6 3 3 0 000 6z" fill="currentColor"/>
        <path d="M12 14c-3.3 0-6 1.3-6 3v1h12v-1c0-1.7-2.7-3-6-3z" fill="currentColor" opacity="0.5"/>
      </svg>
    </div>
  );
}