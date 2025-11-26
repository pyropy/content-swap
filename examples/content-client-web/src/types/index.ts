import { ethers } from 'ethers';

export interface ContentItem {
  id: string;
  title: string;
  description: string;
  price: string;
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
  aliceBalance: string;
  bobBalance: string;
  nonce: number;
  createdAt: number;
  state?: ChannelStateType;
}

export interface WalletState {
  wallet: ethers.Wallet | null;
  provider: ethers.JsonRpcProvider | null;
  address: string | null;
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
  aliceBalance: string;
  bobBalance: string;
  bobRevocationHash: string;
}

export interface AppConfig {
  serverUrl: string;
  rpcUrl: string;
  privateKey: string;
  channelAddress: string;
  initialAliceBalance: string;
  initialBobBalance: string;
}
