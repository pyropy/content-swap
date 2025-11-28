import React from 'react';
import './BottomNav.css';

interface BottomNavProps {
  activeView: 'feed' | 'purchased' | 'profile';
  onViewChange: (view: 'feed' | 'purchased' | 'profile') => void;
  purchasedCount?: number;
}

export function BottomNav({ activeView, onViewChange, purchasedCount = 0 }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      <button
        className={`nav-item ${activeView === 'feed' ? 'active' : ''}`}
        onClick={() => onViewChange('feed')}
        aria-label="Home"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="nav-label">Home</span>
      </button>

      <button
        className={`nav-item ${activeView === 'purchased' ? 'active' : ''}`}
        onClick={() => onViewChange('purchased')}
        aria-label="Purchased"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="nav-label">Library</span>
        {purchasedCount > 0 && (
          <span className="nav-badge">{purchasedCount}</span>
        )}
      </button>

      <button
        className={`nav-item ${activeView === 'profile' ? 'active' : ''}`}
        onClick={() => onViewChange('profile')}
        aria-label="Profile"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx="12" cy="7" r="4"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="nav-label">Profile</span>
      </button>
    </nav>
  );
}