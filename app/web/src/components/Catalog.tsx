import React, { useState } from 'react';
import type { VideoContentItem } from '../types';
import './Catalog.css';

interface CatalogProps {
  items: VideoContentItem[];
  walletConnected: boolean;
  channelActive: boolean;
  clientBalance: string;
  onPurchase: (videoId: string, purchaseType: 'full' | 'segment', segmentName?: string) => void;
  onPreview: (videoId: string) => void;
  purchasing: string | null;
}

export function Catalog({
  items,
  walletConnected,
  channelActive,
  clientBalance,
  onPurchase,
  onPreview,
  purchasing
}: CatalogProps) {
  const [selectedPurchaseType, setSelectedPurchaseType] = useState<{ [key: string]: 'full' | 'segment' }>({});

  if (items.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">Loading video catalog...</div>
      </div>
    );
  }

  const canAfford = (price: string) => parseFloat(clientBalance) >= parseFloat(price);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="panel">
      <div className="catalog-grid">
        {items.map(item => {
          const purchaseType = selectedPurchaseType[item.id] || 'full';
          const price = purchaseType === 'full' ? item.fullPrice : item.pricePerSegment;
          const affordable = canAfford(price);
          const canPurchaseNow = walletConnected && channelActive && affordable && purchasing === null;

          return (
            <div key={item.id} className="video-card">
              {/* Video Thumbnail Section */}
              <div className="video-thumbnail-container">
                <div className="video-thumbnail">
                  <div className="video-placeholder">
                    <span className="video-icon">🎬</span>
                  </div>
                  <div className="video-duration">{formatDuration(item.duration)}</div>
                  {item.hasPreview && (
                    <button
                      className="preview-button"
                      onClick={() => onPreview(item.id)}
                      title="Watch preview"
                    >
                      ▶️ Preview
                    </button>
                  )}
                </div>
              </div>

              {/* Video Info */}
              <div className="video-info">
                <h3>{item.title}</h3>
                <p className="video-description">{item.description}</p>
                <div className="video-metadata">
                  <span className="segment-count">{item.segmentCount} segments</span>
                </div>
              </div>

              {/* Purchase Options */}
              <div className="purchase-section">
                <div className="purchase-type-selector">
                  <button
                    className={`type-btn ${purchaseType === 'full' ? 'active' : ''}`}
                    onClick={() => setSelectedPurchaseType({ ...selectedPurchaseType, [item.id]: 'full' })}
                  >
                    Full Video
                  </button>
                  <button
                    className={`type-btn ${purchaseType === 'segment' ? 'active' : ''}`}
                    onClick={() => setSelectedPurchaseType({ ...selectedPurchaseType, [item.id]: 'segment' })}
                  >
                    Per Segment
                  </button>
                </div>

                <div className="price-info">
                  <div className="current-price">
                    <span className="price-value">{price}</span>
                    <span className="price-unit">ETH</span>
                  </div>
                  <div className="price-detail">
                    {purchaseType === 'full'
                      ? `All ${item.segmentCount} segments`
                      : `${item.pricePerSegment} ETH per segment`
                    }
                  </div>
                </div>

                <button
                  className={`btn purchase-btn ${affordable ? 'btn-success' : 'btn-disabled'}`}
                  onClick={() => onPurchase(item.id, purchaseType)}
                  disabled={!canPurchaseNow}
                  title={!affordable ? 'Insufficient funds' : !channelActive ? 'No active channel' : ''}
                >
                  {purchasing === item.id
                    ? 'Processing...'
                    : !affordable
                      ? 'Insufficient Funds'
                      : purchaseType === 'full'
                        ? 'Buy Full Video'
                        : 'Start Watching'
                  }
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}