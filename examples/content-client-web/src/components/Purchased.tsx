import type { PurchasedContent } from '../types';
import './Purchased.css';

interface PurchasedProps {
  items: PurchasedContent[];
}

export function Purchased({ items }: PurchasedProps) {
  if (items.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">No content purchased yet</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="purchased-list">
        {items.map((item, index) => (
          <div key={`${item.id}-${index}`} className="purchased-item">
            <h3>{item.title}</h3>
            <p>Price: {item.price} ETH | Nonce: {item.nonce}</p>
            <div className="content-text">{item.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
