import { useState, useEffect } from 'react';
import { useConnect, useAccount, useDisconnect } from 'wagmi';
import './Settings.css';

interface SettingsProps {
  serverUrl: string;
  onServerUrlChange: (url: string) => void;
  onServerUrlSave: () => void;
}

export function Settings({
  serverUrl,
  onServerUrlChange,
  onServerUrlSave,
}: SettingsProps) {
  const { connectors, connect, isPending } = useConnect();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const [localServerUrl, setLocalServerUrl] = useState(serverUrl);

  useEffect(() => {
    setLocalServerUrl(serverUrl);
  }, [serverUrl]);

  const handleSave = () => {
    onServerUrlChange(localServerUrl);
    onServerUrlSave();
  };

  return (
    <div className="panel">
      <div className="config-form">
        <h3>Wallet Connection</h3>

        {isConnected ? (
          <div className="wallet-connected">
            <div className="connected-info">
              <span className="connected-badge">Connected</span>
              <span className="address">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            </div>
            <button className="btn btn-secondary" onClick={() => disconnect()}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className="wallet-connectors">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                className="btn btn-primary"
                onClick={() => connect({ connector })}
                disabled={isPending}
              >
                {isPending ? 'Connecting...' : `Connect ${connector.name}`}
              </button>
            ))}
          </div>
        )}

        <hr className="divider" />

        <h3>Server Configuration</h3>

        <div className="form-group">
          <label>Server URL</label>
          <input
            type="text"
            value={localServerUrl}
            onChange={e => setLocalServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </div>

        <button className="btn btn-primary" onClick={handleSave}>
          Save & Connect to Server
        </button>
      </div>
    </div>
  );
}
