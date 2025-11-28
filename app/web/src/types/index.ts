import { ethers } from 'ethers';

// Video content types
export interface VideoContentItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  duration: number; // seconds
  segmentCount: number;
  pricePerSegment: string;
  fullPrice: string;
  hasPreview: boolean;
  segments?: string[]; // Array of segment filenames
  previewSegment?: string; // The segment that serves as preview
}

export interface ContentItem {
  id: string;
  title: string;
  description: string;
  price: string;
}

export interface PurchasedVideo {
  id: string;
  title: string;
  videoId: string;
  purchaseType: 'full' | 'segment';
  segmentName?: string;
  price: string;
  nonce: number;
  timestamp: number;
  accessGranted: string;
}

export interface PurchasedContent {
  id: string;
  title: string;
  content: string;
  price: string;
  nonce: number;
  timestamp: number;
}

export interface LogEntry {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: Date;
}

export interface ChannelState {
  address: string | null;
  nonce: number;
  aliceBalance: string;
  bobBalance: string;
}

export type ChannelStateType = 'FUNDING' | 'OPEN' | 'DISPUTED' | 'CLOSED';

export interface Channel {
  address: string;
  aliceBalance?: string; // Legacy field for backward compatibility
  bobBalance?: string; // Legacy field for backward compatibility
  partyABalance: string;
  partyBBalance: string;
  nonce: number;
  createdAt: number;
  state?: ChannelStateType;
}

export interface WalletState {
  wallet: ethers.Wallet | null;
  provider: ethers.JsonRpcProvider | null;
  address: string | null;
}

export interface VideoInvoice {
  id: string;
  videoId: string;
  title: string;
  purchaseDescription: string;
  purchaseType: 'full' | 'segment';
  segmentName?: string;
  price: string;
  nonce: number;
  partyBRevocationHash: string;
  commitment: Commitment;
}

export interface Invoice {
  id: string;
  contentId: string;
  title: string;
  price: string;
  nonce: number;
  bobRevocationHash: string;
  encryptedContent: string;
  contentPreview: string;
  commitment: Commitment;
}

export interface Commitment {
  channelAddress: string;
  nonce: number;
  partyABalance: string;
  partyBBalance: string;
  partyBRevocationHash: string;
  // Legacy field names for backward compatibility
  aliceBalance?: string;
  bobBalance?: string;
  bobRevocationHash?: string;
}

export interface AppConfig {
  serverUrl: string;
  rpcUrl: string;
  privateKey: string;
  channelAddress: string;
  initialAliceBalance: string;
  initialBobBalance: string;
}
