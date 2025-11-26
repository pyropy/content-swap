import type { ContentItem } from '../types';
import './Catalog.css';

interface CatalogProps {
  items: ContentItem[];
  walletConnected: boolean;
  channelActive: boolean;
  clientBalance: string;
  onPurchase: (contentId: string) => void;
  purchasing: string | null;
}

export function Catalog({ items, walletConnected, channelActive, clientBalance, onPurchase, purchasing }: CatalogProps) {
  if (items.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">Loading catalog...</div>
      </div>
    );
  }

  const canAfford = (price: string) => parseFloat(clientBalance) >= parseFloat(price);

  return (
    <div className="panel">
      <div className="catalog-grid">
        {items.map(item => {
          const affordable = canAfford(item.price);
          const canPurchase = walletConnected && channelActive && affordable && purchasing === null;

          return (
            <div key={item.id} className="content-card">
              <div className="content-info">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <div className="content-price">
                <div className="price">{item.price}</div>
                <div className="unit">ETH</div>
                <button
                  className={`btn ${affordable ? 'btn-success' : 'btn-disabled'}`}
                  onClick={() => onPurchase(item.id)}
                  disabled={!canPurchase}
                  title={!affordable ? 'Insufficient funds' : !channelActive ? 'No active channel' : ''}
                >
                  {purchasing === item.id ? 'Buying...' : !affordable ? 'Insufficient' : 'Buy'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
