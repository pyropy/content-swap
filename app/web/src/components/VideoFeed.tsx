import React, { useState, useEffect, useRef, useCallback } from 'react';
import VideoPlayer from './VideoPlayer';
import { MiniAccountBar } from './MiniAccountBar';
import type { VideoContentItem } from '../types';
import './VideoFeed.css';

interface VideoFeedProps {
  items: VideoContentItem[];
  serverUrl: string;
  channelAddress: string | null;
  walletConnected: boolean;
  channelActive: boolean;
  clientBalance: string;
  onPurchase: (videoId: string, purchaseType: 'full' | 'segment', segmentName?: string) => Promise<string | undefined>;
  purchasing: string | null;
  onAccountClick?: () => void;
}

export function VideoFeed({
  items,
  serverUrl,
  channelAddress,
  walletConnected,
  channelActive,
  clientBalance,
  onPurchase,
  purchasing,
  onAccountClick
}: VideoFeedProps) {
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [purchaseType, setPurchaseType] = useState<'full' | 'segment'>('full');
  const [hasFullAccess, setHasFullAccess] = useState<{ [key: string]: boolean }>({});
  const [segmentPurchaseMode, setSegmentPurchaseMode] = useState<{ [key: string]: boolean }>({});
  const [purchasedSegments, setPurchasedSegments] = useState<{ [key: string]: Set<string> }>({});
  const [videoRevocationSecrets, setVideoRevocationSecrets] = useState<{ [key: string]: string }>({});
  const [segmentRevocationSecrets, setSegmentRevocationSecrets] = useState<{ [key: string]: { [segmentName: string]: string } }>({});
  const [purchasingSegment, setPurchasingSegment] = useState<string | null>(null);
  const [currentSegment, setCurrentSegment] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);

  const currentVideo = items[currentVideoIndex];
  const canAfford = (price: string) => parseFloat(clientBalance) >= parseFloat(price);

  // Reset current segment when video changes
  useEffect(() => {
    setCurrentSegment(null);
  }, [currentVideoIndex]);

  // Handle keyboard navigation with infinite scroll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        // Go to previous video, loop to last if at first
        setCurrentVideoIndex(prev => prev === 0 ? items.length - 1 : prev - 1);
      } else if (e.key === 'ArrowDown') {
        // Go to next video, loop to first if at last
        setCurrentVideoIndex(prev => (prev + 1) % items.length);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items.length]);

  // Handle swipe gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartY.current) return;

    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchStartY.current - touchEndY;

    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        // Swipe up - next video with infinite loop
        setCurrentVideoIndex(prev => (prev + 1) % items.length);
      } else if (diff < 0) {
        // Swipe down - previous video with infinite loop
        setCurrentVideoIndex(prev => prev === 0 ? items.length - 1 : prev - 1);
      }
    }

    touchStartY.current = null;
  };

  // Handle mouse wheel with infinite scroll
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();

    if (e.deltaY > 50) {
      // Scroll down - next video with infinite loop
      setCurrentVideoIndex(prev => (prev + 1) % items.length);
    } else if (e.deltaY < -50) {
      // Scroll up - previous video with infinite loop
      setCurrentVideoIndex(prev => prev === 0 ? items.length - 1 : prev - 1);
    }
  }, [items.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  const handlePurchase = async () => {
    if (!currentVideo) return;

    if (purchaseType === 'full') {
      // For full video purchase
      const revocationSecret = await onPurchase(currentVideo.id, purchaseType);
      setHasFullAccess(prev => ({ ...prev, [currentVideo.id]: true }));

      // Store the revocation secret for decrypting segments
      if (revocationSecret) {
        setVideoRevocationSecrets(prev => ({ ...prev, [currentVideo.id]: revocationSecret }));
      }
    } else {
      // For segment mode, enable segment purchase mode
      // The video will start playing and segments will be purchased on demand
      setSegmentPurchaseMode(prev => ({ ...prev, [currentVideo.id]: true }));

      // Initialize purchased segments set if it doesn't exist
      if (!purchasedSegments[currentVideo.id]) {
        setPurchasedSegments(prev => ({ ...prev, [currentVideo.id]: new Set() }));
      }

      // Initialize segment revocation secrets storage for this video
      if (!segmentRevocationSecrets[currentVideo.id]) {
        setSegmentRevocationSecrets(prev => ({ ...prev, [currentVideo.id]: {} }));
      }

      // The VideoPlayer will now switch to playing mode and request segments as needed
      console.log('Pay-per-segment mode enabled for video:', currentVideo.id);
    }
  };

  const handleSegmentRequest = async (segmentName: string): Promise<boolean> => {
    if (!currentVideo) return false;

    // Update current segment being played
    setCurrentSegment(segmentName);

    // Check if this is the preview segment (always free)
    if (segmentName === currentVideo.previewSegment) {
      console.log(`Segment ${segmentName} is preview segment - free access`);
      return true;
    }

    // Check if user has full access
    if (hasFullAccess[currentVideo.id]) {
      return true;
    }

    // Check if in segment purchase mode
    if (segmentPurchaseMode[currentVideo.id]) {
      // Check if segment was already purchased
      const videoSegments = purchasedSegments[currentVideo.id];
      if (videoSegments && videoSegments.has(segmentName)) {
        return true;
      }

      // Need to purchase this segment
      try {
        console.log(`Purchasing segment: ${segmentName}`);
        setPurchasingSegment(segmentName);

        const revocationSecret = await onPurchase(currentVideo.id, 'segment', segmentName);

        // Mark segment as purchased
        setPurchasedSegments(prev => ({
          ...prev,
          [currentVideo.id]: new Set([...(prev[currentVideo.id] || []), segmentName])
        }));

        // Store the segment-specific revocation secret
        if (revocationSecret) {
          setSegmentRevocationSecrets(prev => ({
            ...prev,
            [currentVideo.id]: {
              ...(prev[currentVideo.id] || {}),
              [segmentName]: revocationSecret
            }
          }));
        }

        // Clear the purchasing indicator after a short delay to let user see success
        setTimeout(() => setPurchasingSegment(null), 1000);
        console.log(`Successfully purchased segment: ${segmentName}`);
        return true;
      } catch (error) {
        console.error('Failed to purchase segment:', error);
        setPurchasingSegment(null);
        return false;
      }
    }

    // Not in segment purchase mode and no full access
    return false;
  };

  const handleVideoEnd = () => {
    // Auto-advance to next video with infinite loop when current one ends
    setCurrentVideoIndex(prev => (prev + 1) % items.length);
  };

  const handleSwipeUp = () => {
    // Next video with infinite loop
    setCurrentVideoIndex(prev => (prev + 1) % items.length);
  };

  const handleSwipeDown = () => {
    // Previous video with infinite loop
    setCurrentVideoIndex(prev => prev === 0 ? items.length - 1 : prev - 1);
  };

  if (items.length === 0) {
    return (
      <div className="video-feed-empty">
        <p>Loading videos...</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="video-feed-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Persistent account status bar */}
      <MiniAccountBar
        isConnected={walletConnected}
        channelAddress={channelAddress}
        balance={clientBalance}
        onAccountClick={onAccountClick || (() => {})}
      />

      {/* Main content area with video and sidebar */}
      <div className="feed-content">
        {/* Video Player */}
        {currentVideo && (
          <VideoPlayer
            key={`${currentVideo.id}-${hasFullAccess[currentVideo.id] ? 'full' : segmentPurchaseMode[currentVideo.id] ? 'segment' : 'preview'}`}
            videoId={currentVideo.id}
            title={currentVideo.title}
            channelAddress={channelAddress || ''}
            isPreview={!hasFullAccess[currentVideo.id] && !segmentPurchaseMode[currentVideo.id]}
            previewUrl={`${serverUrl}/video/${currentVideo.id}/preview`}
            playlistUrl={(hasFullAccess[currentVideo.id] || segmentPurchaseMode[currentVideo.id]) && channelAddress
              ? `${serverUrl}/video/${currentVideo.id}/playlist.m3u8?channel=${channelAddress}`
              : undefined}
            revocationSecret={videoRevocationSecrets[currentVideo.id]}
            segmentRevocationSecrets={segmentRevocationSecrets[currentVideo.id] || {}}
            onSegmentRequest={handleSegmentRequest}
            onVideoEnd={handleVideoEnd}
            onSwipeUp={handleSwipeUp}
            onSwipeDown={handleSwipeDown}
          />
        )}

        {/* Right Sidebar with purchase and info */}
        <div className="right-sidebar">
          {/* Video Info */}
          {currentVideo && (
            <div className="video-info">
              <h2>{currentVideo.title}</h2>
              <p>{currentVideo.description}</p>
              <div className="tags">
                <span className="tag">#{currentVideo.segmentCount} parts</span>
                <span className="tag">Preview available</span>
              </div>
            </div>
          )}

          {/* Interaction Buttons */}
          <div className="interaction-buttons">
            <button className="interaction-btn">
              <span className="icon">❤️</span>
              <span className="count">0</span>
            </button>
            <button className="interaction-btn">
              <span className="icon">💬</span>
              <span className="count">0</span>
            </button>
            <button className="interaction-btn">
              <span className="icon">🔗</span>
            </button>
            <button className="interaction-btn">
              <span className="icon">📥</span>
            </button>
          </div>

          {/* Balance Display */}
          {channelActive && (
            <div className="balance-card">
              <div className="balance-header">
                <span className="balance-label">Channel Balance</span>
                <span className="balance-value">{parseFloat(clientBalance).toFixed(4)} ETH</span>
              </div>
              {currentVideo && (
                <div className="affordability-indicator">
                  {canAfford(currentVideo.fullPrice) ? (
                    <span className="can-afford">✓ Can afford full video</span>
                  ) : canAfford(currentVideo.pricePerSegment) ? (
                    <span className="can-afford-partial">✓ Can afford segments</span>
                  ) : (
                    <span className="cannot-afford">✗ Insufficient funds</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Purchase Card */}
          {currentVideo && !hasFullAccess[currentVideo.id] && !segmentPurchaseMode[currentVideo.id] && (
            <div className="purchase-card">
              <h3>Unlock Content</h3>

              <div className="purchase-options">
                <div className="option-toggle">
                  <button
                    className={`toggle-btn ${purchaseType === 'full' ? 'active' : ''}`}
                    onClick={() => setPurchaseType('full')}
                  >
                    Full Video
                  </button>
                  <button
                    className={`toggle-btn ${purchaseType === 'segment' ? 'active' : ''}`}
                    onClick={() => setPurchaseType('segment')}
                  >
                    Pay Per Part
                  </button>
                </div>

                <div className="price-display">
                  <span className="price-amount">
                    {purchaseType === 'full' ? currentVideo.fullPrice : currentVideo.pricePerSegment}
                  </span>
                  <span className="price-unit">ETH</span>
                  {purchaseType === 'segment' && (
                    <span className="price-note">per segment</span>
                  )}
                </div>

                <button
                  className={`purchase-btn ${!canAfford(purchaseType === 'full' ? currentVideo.fullPrice : currentVideo.pricePerSegment) ? 'disabled' : ''}`}
                  onClick={handlePurchase}
                  disabled={
                    !walletConnected ||
                    !channelActive ||
                    !canAfford(purchaseType === 'full' ? currentVideo.fullPrice : currentVideo.pricePerSegment) ||
                    purchasing === currentVideo.id
                  }
                >
                  {purchasing === currentVideo.id
                    ? 'Processing...'
                    : !walletConnected
                      ? 'Connect Wallet'
                      : !channelActive
                        ? 'Open Channel First'
                        : !canAfford(purchaseType === 'full' ? currentVideo.fullPrice : currentVideo.pricePerSegment)
                          ? 'Insufficient Funds'
                          : purchaseType === 'full'
                            ? 'Unlock Full Video'
                            : 'Enable Pay-Per-Segment'
                  }
                </button>
              </div>
            </div>
          )}

          {/* Show segment purchase status */}
          {currentVideo && segmentPurchaseMode[currentVideo.id] && !hasFullAccess[currentVideo.id] && (
            <div className="purchase-card">
              <h3>Pay-Per-Segment Mode</h3>
              <p style={{ fontSize: '14px', color: 'rgba(255, 255, 255, 0.8)', marginBottom: '12px' }}>
                You'll be charged {currentVideo.pricePerSegment} ETH for each new segment as you watch.
              </p>
              <div className="price-display">
                <span className="price-amount">{currentVideo.pricePerSegment}</span>
                <span className="price-unit">ETH</span>
                <span className="price-note">per segment</span>
              </div>
              {/* Show current segment status */}
              {currentSegment && (
                <div style={{ marginTop: '12px', padding: '8px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '4px' }}>
                  <p style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '4px' }}>
                    Current segment: <strong>{currentSegment}</strong>
                  </p>
                  {currentSegment === currentVideo.previewSegment && (
                    <p style={{ fontSize: '12px', color: '#00ff88' }}>
                      ✓ Preview segment (free)
                    </p>
                  )}
                  {purchasedSegments[currentVideo.id]?.has(currentSegment || '') && (
                    <p style={{ fontSize: '12px', color: '#00ff88' }}>
                      ✓ Already purchased
                    </p>
                  )}
                </div>
              )}

              {/* Only show purchase message when actively purchasing */}
              {purchasingSegment && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  backgroundColor: 'rgba(255, 170, 0, 0.2)',
                  border: '1px solid #ffaa00',
                  borderRadius: '6px',
                  animation: 'pulse 1s ease-in-out'
                }}>
                  <p style={{ fontSize: '14px', color: '#ffaa00', fontWeight: 'bold' }}>
                    🔄 Purchasing segment: {purchasingSegment}...
                  </p>
                  <p style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)', marginTop: '4px' }}>
                    {currentVideo.pricePerSegment} ETH will be deducted
                  </p>
                </div>
              )}

              {/* Show total segments purchased */}
              {purchasedSegments[currentVideo.id] && purchasedSegments[currentVideo.id].size > 0 && (
                <p style={{ fontSize: '12px', color: '#00ff88', marginTop: '8px' }}>
                  Total segments purchased: {purchasedSegments[currentVideo.id].size} / {currentVideo.segmentCount - 1}
                </p>
              )}
            </div>
          )}

          {/* Navigation Arrows */}
          <div className="navigation-arrows">
            <button
              className="nav-arrow nav-arrow-up"
              onClick={() => setCurrentVideoIndex(prev => prev === 0 ? items.length - 1 : prev - 1)}
              aria-label="Previous video"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" fill="currentColor"/>
              </svg>
            </button>
            <button
              className="nav-arrow nav-arrow-down"
              onClick={() => setCurrentVideoIndex(prev => (prev + 1) % items.length)}
              aria-label="Next video"
            >
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" fill="currentColor"/>
              </svg>
            </button>
          </div>

          {/* Navigation Dots */}
          <div className="navigation-dots-sidebar">
            {items.map((_, index) => (
              <div
                key={index}
                className={`dot ${index === currentVideoIndex ? 'active' : ''}`}
                onClick={() => setCurrentVideoIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}