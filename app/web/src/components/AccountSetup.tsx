import React, { useState } from 'react';
import { useConnect, useAccount, useDisconnect } from 'wagmi';
import './AccountSetup.css';

interface AccountSetupProps {
  isOpen: boolean;
  onClose: () => void;
  onChannelSetup: (fundAmount: string) => Promise<void>;
  channelExists: boolean;
  isSettingUp: boolean;
  setupStep: number;
  setupMessage: string;
}

export function AccountSetup({
  isOpen,
  onClose,
  onChannelSetup,
  channelExists,
  isSettingUp,
  setupStep,
  setupMessage
}: AccountSetupProps) {
  const { isConnected, address } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [fundAmount, setFundAmount] = useState('0.1');
  const [currentStep, setCurrentStep] = useState<'welcome' | 'wallet' | 'channel' | 'success'>(
    !isConnected ? 'wallet' : !channelExists ? 'channel' : 'success'
  );

  // Update current step based on connection state
  React.useEffect(() => {
    if (!isConnected) {
      setCurrentStep('wallet');
    } else if (!channelExists) {
      setCurrentStep('channel');
    } else {
      setCurrentStep('success');
    }
  }, [isConnected, channelExists]);

  const handleChannelSetup = async () => {
    try {
      await onChannelSetup(fundAmount);
      setCurrentStep('success');
    } catch (error) {
      console.error('Channel setup failed:', error);
    }
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (!isOpen) return null;

  return (
    <div className="account-setup-overlay">
      <div className="account-setup-modal">
        {/* Close button for browsing without setup */}
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Welcome Step */}
        {currentStep === 'welcome' && (
          <div className="setup-step">
            <div className="step-icon">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"
                      fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
            <h2>Welcome to ContentSwap</h2>
            <p>Watch preview videos for free, or set up your account to purchase full content.</p>
            <div className="step-features">
              <div className="feature">
                <span className="feature-icon">🎬</span>
                <span>Watch free previews</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🔓</span>
                <span>Purchase full videos</span>
              </div>
              <div className="feature">
                <span className="feature-icon">⚡</span>
                <span>Instant micropayments</span>
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={() => setCurrentStep('wallet')}
            >
              Get Started
            </button>
            <button className="btn-secondary" onClick={onClose}>
              Just Browse
            </button>
          </div>
        )}

        {/* Wallet Connection Step */}
        {currentStep === 'wallet' && !isConnected && (
          <div className="setup-step">
            <div className="step-icon">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <path d="M21 18v1a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1"
                      stroke="currentColor" strokeWidth="1.5"/>
                <path d="M21 8h-7a2 2 0 00-2 2v4a2 2 0 002 2h7v-8z"
                      fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </div>
            <h2>Connect Your Wallet</h2>
            <p>Connect your Ethereum wallet to get started</p>

            <div className="wallet-options">
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  className="wallet-option"
                  onClick={() => connect({ connector })}
                  disabled={isPending}
                >
                  <span className="wallet-icon">
                    {connector.name.includes('MetaMask') ? '🦊' : '🔌'}
                  </span>
                  <span>{connector.name}</span>
                  {isPending && <span className="spinner-small"></span>}
                </button>
              ))}
            </div>

            <button className="btn-text" onClick={onClose}>
              Continue Browsing
            </button>
          </div>
        )}

        {/* Channel Setup Step */}
        {currentStep === 'channel' && isConnected && !channelExists && (
          <div className="setup-step">
            <div className="step-icon">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h2>Set Up Payment Channel</h2>
            <p>Fund your payment channel to start purchasing content</p>

            <div className="connected-wallet">
              <span className="wallet-badge">
                <span className="dot-connected"></span>
                {formatAddress(address || '')}
              </span>
            </div>

            <div className="fund-input">
              <label>Initial Deposit (ETH)</label>
              <input
                type="number"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                min="0.01"
                step="0.01"
                disabled={isSettingUp}
              />
              <span className="input-hint">Minimum: 0.01 ETH</span>
            </div>

            {isSettingUp && (
              <div className="setup-progress">
                <div className="progress-steps">
                  {[1, 2, 3, 4, 5].map((step) => (
                    <div
                      key={step}
                      className={`progress-step ${step <= setupStep ? 'active' : ''}`}
                    />
                  ))}
                </div>
                <p className="setup-message">{setupMessage}</p>
              </div>
            )}

            <button
              className="btn-primary"
              onClick={handleChannelSetup}
              disabled={isSettingUp || parseFloat(fundAmount) < 0.01}
            >
              {isSettingUp ? (
                <>
                  <span className="spinner-small"></span>
                  Setting Up...
                </>
              ) : (
                'Create Channel'
              )}
            </button>

            <button
              className="btn-text"
              onClick={() => {
                disconnect();
                setCurrentStep('wallet');
              }}
            >
              Use Different Wallet
            </button>
          </div>
        )}

        {/* Success Step */}
        {currentStep === 'success' && channelExists && (
          <div className="setup-step">
            <div className="step-icon success">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2>You're All Set!</h2>
            <p>Your payment channel is active. You can now purchase full videos.</p>

            <div className="success-info">
              <div className="info-item">
                <span className="info-label">Wallet</span>
                <span className="info-value">{formatAddress(address || '')}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Status</span>
                <span className="info-value status-active">
                  <span className="dot-active"></span>
                  Channel Active
                </span>
              </div>
            </div>

            <button className="btn-primary" onClick={onClose}>
              Start Watching
            </button>
          </div>
        )}
      </div>
    </div>
  );
}