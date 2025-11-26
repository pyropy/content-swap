import './StatusBar.css';

interface StatusBarProps {
  walletAddress: string | null;
  channelAddress: string | null;
  aliceBalance: string;
  bobBalance: string;
  currentNonce: number;
}

export function StatusBar({
  walletAddress,
  channelAddress,
  aliceBalance,
  bobBalance,
  currentNonce,
}: StatusBarProps) {
  const formatAddress = (addr: string | null) => {
    if (!addr) return 'Not Set';
    return `${addr.substring(0, 6)}...${addr.substring(38)}`;
  };

  return (
    <div className="status-bar">
      <div className="status-item">
        <label>Wallet</label>
        <span>{walletAddress ? formatAddress(walletAddress) : 'Not Connected'}</span>
      </div>
      <div className="status-item">
        <label>Channel</label>
        <span>{formatAddress(channelAddress)}</span>
      </div>
      <div className="status-item">
        <label>Your Balance</label>
        <span>{parseFloat(aliceBalance).toFixed(4)} ETH</span>
      </div>
      <div className="status-item">
        <label>Server Balance</label>
        <span>{parseFloat(bobBalance).toFixed(4)} ETH</span>
      </div>
      <div className="status-item">
        <label>Nonce</label>
        <span>{currentNonce}</span>
      </div>
    </div>
  );
}
