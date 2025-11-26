import { useState } from 'react';
import type { Channel } from '../types';
import './ChannelSetup.css';

interface ChannelSetupProps {
  channels: Channel[];
  activeChannelAddress: string | null;
  serverAddress: string | null;
  serverConnected: boolean;
  walletConnected: boolean;
  contractLoaded: boolean;
  onSelectChannel: (channel: Channel) => void;
  onSetupChannel: (
    yourDeposit: string,
    disputePeriod: number,
    onProgress: (step: number, message: string) => void
  ) => Promise<string | null>;
  onCloseChannel: () => Promise<boolean>;
}

export function ChannelSetup({
  channels,
  activeChannelAddress,
  serverAddress,
  serverConnected,
  walletConnected,
  contractLoaded,
  onSelectChannel,
  onSetupChannel,
  onCloseChannel,
}: ChannelSetupProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [yourDeposit, setYourDeposit] = useState('1.0');
  const [disputePeriod, setDisputePeriod] = useState('86400');
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const [stepStatus, setStepStatus] = useState('');

  const handleSetupChannel = async () => {
    setLoading(true);
    setSetupStep(0);
    setStepStatus('');
    try {
      const address = await onSetupChannel(
        yourDeposit,
        parseInt(disputePeriod),
        (step: number, message: string) => {
          setSetupStep(step);
          setStepStatus(message);
        }
      );
      if (address) {
        setShowCreateForm(false);
        setSetupStep(0);
        setStepStatus('');
      }
    } catch (error) {
      setStepStatus(`Error: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCloseChannel = async () => {
    if (!confirm('Are you sure you want to close this channel? Funds will be returned to both parties.')) {
      return;
    }
    setClosing(true);
    try {
      await onCloseChannel();
    } catch {
      // Error is logged in the hook
    } finally {
      setClosing(false);
    }
  };

  const canSetup = walletConnected && contractLoaded && serverAddress && !loading && !closing;

  if (!serverConnected) {
    return (
      <div className="panel">
        <div className="empty-state">
          <p>Connect to a server in Settings to manage channels</p>
        </div>
      </div>
    );
  }

  if (!walletConnected) {
    return (
      <div className="panel">
        <div className="empty-state">
          <p>Connect your wallet in Settings to manage channels</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="channel-setup">
        <div className="channel-header">
          <h3>Payment Channels</h3>
          {!showCreateForm && (
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateForm(true)}
            >
              + New Channel
            </button>
          )}
        </div>

        {showCreateForm && (
          <div className="create-channel-form">
            <h4>Create New Channel</h4>

            <div className="form-group">
              <label>Server Address</label>
              <input
                type="text"
                value={serverAddress || ''}
                readOnly
                className="readonly"
              />
            </div>

            <div className="form-group">
              <label>Your Deposit (ETH)</label>
              <input
                type="text"
                value={yourDeposit}
                onChange={e => setYourDeposit(e.target.value)}
                placeholder="1.0"
              />
            </div>

            <div className="form-group">
              <label>Dispute Period (seconds)</label>
              <input
                type="text"
                value={disputePeriod}
                onChange={e => setDisputePeriod(e.target.value)}
                placeholder="86400"
              />
            </div>

            <div className="button-group">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowCreateForm(false);
                  setSetupStep(0);
                  setStepStatus('');
                }}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="btn btn-success"
                onClick={handleSetupChannel}
                disabled={!canSetup}
              >
                {loading ? 'Creating...' : 'Create Channel'}
              </button>
            </div>

            {setupStep > 0 && (
              <div className="setup-progress">
                <div className="step-indicator">
                  {[1, 2, 3, 4, 5].map(step => (
                    <div
                      key={step}
                      className={`step ${setupStep > step ? 'complete' : ''} ${setupStep === step ? 'active' : ''}`}
                    >
                      {step}
                    </div>
                  ))}
                </div>
                <p className="step-status">{stepStatus}</p>
              </div>
            )}
          </div>
        )}

        {!showCreateForm && (
          <div className="channel-list">
            {channels.length === 0 ? (
              <div className="empty-channels">
                <p>No channels yet. Create one to start purchasing content.</p>
              </div>
            ) : (
              channels.map(channel => (
                <div
                  key={channel.address}
                  className={`channel-item ${channel.address === activeChannelAddress ? 'active' : ''}`}
                  onClick={() => onSelectChannel(channel)}
                >
                  <div className="channel-info">
                    <div className="channel-address">
                      {channel.address.slice(0, 10)}...{channel.address.slice(-8)}
                    </div>
                    <div className="channel-details">
                      <span className="balance">Balance: {parseFloat(channel.aliceBalance).toFixed(4)} ETH</span>
                      <span className="nonce">Nonce: {channel.nonce}</span>
                    </div>
                  </div>
                  <div className="channel-actions">
                    {channel.address === activeChannelAddress && (
                      <span className="active-badge">Active</span>
                    )}
                    {channel.address === activeChannelAddress && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCloseChannel();
                        }}
                        disabled={closing}
                      >
                        {closing ? 'Closing...' : 'Close'}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
