import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { processSegmentResponse } from '../utils/videoCrypto';
import './VideoPlayer.css';

interface VideoPlayerProps {
  videoId: string;
  title: string;
  channelAddress: string;
  isPreview?: boolean;
  previewUrl?: string;
  playlistUrl?: string;
  revocationSecret?: string;
  segmentRevocationSecrets?: { [segmentName: string]: string };
  onSegmentRequest?: (segmentName: string) => Promise<boolean>;
  onVideoEnd?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  title,
  channelAddress,
  isPreview = false,
  previewUrl,
  playlistUrl,
  revocationSecret,
  segmentRevocationSecrets = {},
  onSegmentRequest,
  onVideoEnd,
  onSwipeUp,
  onSwipeDown
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const revocationSecretRef = useRef<string | undefined>(revocationSecret);
  const segmentRevocationSecretsRef = useRef<{ [segmentName: string]: string }>(segmentRevocationSecrets);
  const onSegmentRequestRef = useRef(onSegmentRequest);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [currentSourceUrl, setCurrentSourceUrl] = useState<string | undefined>(undefined);

  // Update the refs when props change
  useEffect(() => {
    revocationSecretRef.current = revocationSecret;
  }, [revocationSecret]);

  useEffect(() => {
    segmentRevocationSecretsRef.current = segmentRevocationSecrets;
  }, [segmentRevocationSecrets]);

  useEffect(() => {
    onSegmentRequestRef.current = onSegmentRequest;
  }, [onSegmentRequest]);

  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;

    // Handle both preview and full video with HLS
    const sourceUrl = isPreview ? previewUrl : playlistUrl;

    // Skip re-initialization if the source URL hasn't actually changed
    if (sourceUrl === currentSourceUrl && hlsRef.current) {
      return;
    }

    // Clean up existing HLS instance if switching sources
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setCurrentSourceUrl(sourceUrl);

    if (sourceUrl) {
      if (Hls.isSupported()) {
        // Custom fragment loader to handle encrypted segments
        class CustomFragmentLoader extends Hls.DefaultConfig.loader {
          load(context: any, config: any, callbacks: any) {
            const url = context.url;
            const xhr = new XMLHttpRequest();

            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';

            // Add headers
            xhr.setRequestHeader('Cache-Control', 'no-cache');
            if (url.includes('/segment/')) {
              xhr.setRequestHeader('X-Channel-Address', channelAddress);
            }

            xhr.onload = async () => {
              if (xhr.status === 200) {
                try {
                  // Check if segment is encrypted
                  const isEncrypted = xhr.getResponseHeader('X-Encrypted') === 'true';

                  if (isEncrypted) {
                    // Extract segment name from URL
                    const segmentName = url.split('/').pop()?.split('?')[0];

                    // Determine which revocation secret to use
                    let secretToUse = revocationSecretRef.current;

                    // Check if we have a segment-specific revocation secret
                    if (segmentName && segmentRevocationSecretsRef.current[segmentName]) {
                      secretToUse = segmentRevocationSecretsRef.current[segmentName];
                    }

                    if (secretToUse) {
                      // Create a fake Response object for processSegmentResponse
                      const response = new Response(xhr.response, {
                        headers: {
                          'X-Encrypted': 'true'
                        }
                      });

                      const decrypted = await processSegmentResponse(response, secretToUse);
                      callbacks.onSuccess({
                        url,
                        data: decrypted
                      }, context, xhr);
                    } else {
                      console.error('No revocation secret available for encrypted segment:', segmentName);
                      callbacks.onError({ code: xhr.status, text: 'No decryption key available' }, context, xhr);
                    }
                  } else {
                    // Not encrypted, use as-is
                    callbacks.onSuccess({
                      url,
                      data: xhr.response
                    }, context, xhr);
                  }
                } catch (error) {
                  console.error('Decryption error:', error);
                  callbacks.onError({ code: xhr.status, text: 'Decryption failed' }, context, xhr);
                }
              } else {
                callbacks.onError({ code: xhr.status, text: xhr.statusText }, context, xhr);
              }
            };

            xhr.onerror = () => {
              callbacks.onError({ code: xhr.status, text: xhr.statusText }, context, xhr);
            };

            xhr.ontimeout = () => {
              callbacks.onTimeout(context, xhr);
            };

            xhr.send();

            return {
              abort: () => xhr.abort()
            };
          }
        }

        const hls = new Hls({
          debug: false, // Disable debug logging
          enableWorker: true,
          lowLatencyMode: false, // Disable low latency for better stability
          backBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          maxBufferSize: 60 * 1000 * 1000, // 60MB
          maxBufferHole: 0.5,
          startLevel: -1, // Auto start level
          fragLoadingTimeOut: 20000, // 20 seconds timeout
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 1000,
          manifestLoadingTimeOut: 10000,
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          fLoader: CustomFragmentLoader as any
        });

        console.log('Loading HLS source:', sourceUrl);
        hls.loadSource(sourceUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('HLS Manifest parsed successfully');
          setIsLoading(false);
          setError(''); // Clear any previous errors
          // Setup for preview mode
          if (isPreview) {
            video.loop = true;
            video.muted = true; // Required for auto-play
          } else {
            // For full video, disable looping
            video.loop = false;
          }
          // Auto-play for TikTok-like experience
          video.play().catch((err) => {
            console.error('Autoplay failed:', err);
            // Try to play muted if not already
            if (!video.muted) {
              video.muted = true;
              video.play().catch(() => {/* Auto-play blocked */});
            }
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.error('HLS Network Error:', data);
                // Attempt to recover from network errors
                setTimeout(() => {
                  hls.startLoad();
                }, 1000);
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.error('HLS Media Error:', data);
                hls.recoverMediaError();
                break;
              default:
                console.error('HLS Fatal Error:', data);
                setError('An error occurred while loading the video');
                break;
            }
          }
        });

        hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
          // Handle segment authorization if needed
          // For preview segments, don't check authorization
          if (data.frag.url.includes('preview-segment')) {
            console.log('Loading preview segment:', data.frag.url);
            return;
          }

          if (onSegmentRequestRef.current && data.frag.url) {
            const segmentName = data.frag.url.split('/').pop()?.split('?')[0];
            if (segmentName) {
              onSegmentRequestRef.current(segmentName).then(authorized => {
                if (!authorized) {
                  setError('Segment not authorized. Please purchase access.');
                  hls.stopLoad();
                }
              });
            }
          }
        });

        hlsRef.current = hls;

        return () => {
          hls.destroy();
        };
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = sourceUrl;
        if (isPreview) {
          video.loop = true;
          video.muted = true;
        } else {
          // For full video, disable looping
          video.loop = false;
        }
        video.load();
        setIsLoading(false);
        // Auto-play
        video.play().catch(() => {/* Auto-play blocked */});
      } else {
        setError('HLS is not supported in this browser');
      }
    }
    // Removed revocationSecret and onSegmentRequest from dependencies to prevent re-initialization
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, previewUrl, playlistUrl, channelAddress, isPreview]);

  // Video event handlers
  useEffect(() => {
    if (!videoRef.current) return;

    const video = videoRef.current;

    const handlePlay = () => {
      setIsPlaying(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
    };
    const handleTimeUpdate = () => {
      setProgress(video.currentTime);
      setDuration(video.duration);
    };
    const handleLoadedMetadata = () => {
      setDuration(video.duration);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      if (isPreview) {
        // For preview, loop back
        video.currentTime = 0;
        video.play().catch(() => {/* Failed to restart */});
      } else if (onVideoEnd) {
        onVideoEnd();
      }
    };
    const handleError = () => {
      setError('Failed to load video');
      setIsLoading(false);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [onVideoEnd, isPreview]);

  // Touch handlers for swipe gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return;

    const touchEndY = e.changedTouches[0].clientY;
    const diff = touchStartY - touchEndY;

    if (Math.abs(diff) > 50) {
      if (diff > 0 && onSwipeUp) {
        onSwipeUp(); // Next video
      } else if (diff < 0 && onSwipeDown) {
        onSwipeDown(); // Previous video
      }
    }

    setTouchStartY(null);
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      // Ensure video is muted for autoplay
      if (isPreview && !videoRef.current.muted) {
        videoRef.current.muted = true;
      }
      videoRef.current.play()
        .catch(() => {
          // Try muted if not already
          videoRef.current!.muted = true;
          videoRef.current!.play().catch(() => {/* Failed to play */});
        });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const newTime = parseFloat(e.target.value);
    videoRef.current.currentTime = newTime;
    setProgress(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const newVolume = parseFloat(e.target.value);
    videoRef.current.volume = newVolume;
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;

    if (isMuted) {
      videoRef.current.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      videoRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Hide controls after inactivity
  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const resetTimeout = () => {
      setShowControls(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowControls(false), 3000);
    };

    const handleMouseMove = () => resetTimeout();
    const handleClick = () => resetTimeout();

    if (containerRef.current) {
      containerRef.current.addEventListener('mousemove', handleMouseMove);
      containerRef.current.addEventListener('click', handleClick);
    }

    resetTimeout();

    return () => {
      clearTimeout(timeout);
      if (containerRef.current) {
        containerRef.current.removeEventListener('mousemove', handleMouseMove);
        containerRef.current.removeEventListener('click', handleClick);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="video-player-container"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <video
        ref={videoRef}
        className="video-element"
        playsInline
        autoPlay={isPreview}
        muted={isPreview}
        loop={isPreview}
        onClick={togglePlayPause}
      />

      {/* Loading spinner */}
      {isLoading && (
        <div className="video-loading">
          <div className="spinner"></div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="video-error">
          <span>{error}</span>
        </div>
      )}

      {/* Preview overlay */}
      {isPreview && (
        <div className="preview-overlay">
          <span>Preview</span>
        </div>
      )}

      {/* Video controls */}
      <div className={`video-controls ${showControls ? 'visible' : ''}`}>
        {/* Title */}
        <div className="video-title">
          <h3>{title}</h3>
        </div>

        {/* Bottom controls */}
        <div className="controls-bottom">
          {/* Play/Pause button */}
          <button
            className="play-pause-btn"
            onClick={togglePlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>

          {/* Progress bar */}
          <div className="progress-container">
            <span className="time-current">{formatTime(progress)}</span>
            <input
              type="range"
              className="progress-bar"
              min="0"
              max={duration || 100}
              value={progress}
              onChange={handleSeek}
            />
            <span className="time-total">{formatTime(duration)}</span>
          </div>

          {/* Volume control */}
          <div className="volume-control">
            <button
              className="mute-btn"
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              className="volume-slider"
              min="0"
              max="1"
              step="0.1"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
            />
          </div>
        </div>

      </div>

      {/* Swipe indicators */}
      <div className="swipe-indicators">
        {onSwipeUp && <div className="swipe-up">↑ Next</div>}
        {onSwipeDown && <div className="swipe-down">↓ Previous</div>}
      </div>
    </div>
  );
};

export default VideoPlayer;