#!/usr/bin/env node

import express from 'express';
import { ethers } from 'ethers';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs/promises';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Lightning Network Payment Channel Video Streaming Server
 *
 * This server demonstrates how to stream video content using Lightning Network
 * payment channels. The flow is:
 *
 * 1. Client requests video catalog
 * 2. Client can preview first segment for free
 * 3. Client can purchase full video or pay per segment
 * 4. Server verifies payment via signed commitments
 * 5. Server streams HLS video segments to authorized clients
 */

const app = express();
app.use(express.json());
app.use(cors({
  exposedHeaders: ['X-Encrypted', 'X-Encryption-Format', 'X-Channel-Address']
}));

const PORT = 3000;

// Get the directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server's wallet (PartyB - content seller)
const partyBPrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const serverWallet = new ethers.Wallet(partyBPrivateKey, provider);

console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════════'));
console.log(chalk.blue.bold('     PAYMENT CHANNEL VIDEO STREAMING SERVER'));
console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════\n'));

console.log(chalk.yellow('Server Configuration:'));
console.log(chalk.white(`  Operator: PartyB (Video Content Provider)`));
console.log(chalk.gray(`  Address: ${serverWallet.address}`));
console.log(chalk.gray(`  Port: ${PORT}\n`));

// Content Encryption utilities (keeping for potential future use with encrypted segments)
class ContentEncryption {
  static encrypt(plaintext, revocationSecret) {
    const key = crypto.createHash('sha256').update(revocationSecret).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      combined: iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted
    };
  }

  static decrypt(encryptedData, revocationSecret) {
    try {
      const parts = encryptedData.combined.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const key = crypto.createHash('sha256').update(revocationSecret).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error('Decryption failed');
    }
  }
}

// Revocation Key Manager
class RevocationKeyManager {
  constructor(seed) {
    this.seed = seed;
    this.secrets = new Map();
    this.revealedSecrets = new Map();
  }

  generateSecret(nonce) {
    const secret = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [this.seed, nonce])
    );
    this.secrets.set(nonce, secret);
    return secret;
  }

  generateRevocationHash(nonce) {
    const secret = this.generateSecret(nonce);
    return ethers.keccak256(secret);
  }

  revealSecret(nonce) {
    const secret = this.secrets.get(nonce);
    if (!secret) {
      throw new Error(`No secret found for nonce ${nonce}`);
    }
    this.revealedSecrets.set(nonce, secret);
    this.secrets.delete(nonce);
    return secret;
  }
}

// Initialize PartyB's revocation key manager
const partyBRevocationManager = new RevocationKeyManager(
  ethers.keccak256(ethers.toUtf8Bytes("partyB-server-seed"))
);

// In-memory storage for channel states and content
const channels = new Map();
const pendingInvoices = new Map();
const videoPurchases = new Map(); // Track full video purchases
const segmentPurchases = new Map(); // Track per-segment purchases

// Video content catalog with metadata
const videoCatalog = {
  'video-1': {
    id: 'video-1',
    title: 'Amazing Nature Documentary',
    description: 'Explore the wonders of nature in stunning 4K',
    thumbnail: '/content/video1-thumb.jpg', // We'll serve a placeholder
    duration: 54, // seconds
    playlist: 'video1.m3u8',
    segments: ['video10.ts', 'video11.ts', 'video12.ts', 'video13.ts', 'video14.ts', 'video15.ts', 'video16.ts'],
    segmentCount: 7,
    previewSegment: 'video10.ts', // First segment is free preview
    pricePerSegment: '0.01', // ETH per segment
    fullPrice: '0.05' // ETH for full video (discounted)
  },
  'video-2': {
    id: 'video-2',
    title: 'Coding Tutorial: Build a DApp',
    description: 'Learn to build decentralized applications step by step',
    thumbnail: '/content/video2-thumb.jpg',
    duration: 13, // seconds
    playlist: 'video2.m3u8',
    segments: ['video20.ts', 'video21.ts', 'video22.ts'],
    segmentCount: 3,
    previewSegment: 'video20.ts',
    pricePerSegment: '0.015',
    fullPrice: '0.035'
  },
  'video-3': {
    id: 'video-3',
    title: 'Blockchain Explained',
    description: 'Understanding blockchain technology in simple terms',
    thumbnail: '/content/video3-thumb.jpg',
    duration: 20, // seconds
    playlist: 'video3.m3u8',
    segments: ['video30.ts', 'video31.ts', 'video32.ts'],
    segmentCount: 3,
    previewSegment: 'video30.ts',
    pricePerSegment: '0.012',
    fullPrice: '0.03'
  }
};

// Track segment access per user/channel
function getUserVideoKey(channelAddress, videoId) {
  return `${channelAddress}_${videoId}`;
}

function getUserSegmentKey(channelAddress, videoId, segmentName) {
  return `${channelAddress}_${videoId}_${segmentName}`;
}

// Load or initialize channel contract
let channelContract = null;
let channelAddress = null;
let contractAbi = null;
let contractBytecode = null;

async function loadChannelContract() {
  try {
    // First try to load from centralized ABI location (created by make update-abis)
    let contractPath = new URL('../shared/BidirectionalChannel.json', import.meta.url);

    // Check if centralized ABI exists, otherwise fallback to contract build output
    try {
      await fs.access(contractPath);
    } catch {
      contractPath = new URL('../../contract/out/BidirectionalChannel.sol/BidirectionalChannel.json', import.meta.url);
    }

    const contractJson = JSON.parse(await fs.readFile(contractPath, 'utf8'));
    contractAbi = contractJson.abi;
    // Handle both formats: direct bytecode or nested under .bytecode.object
    contractBytecode = contractJson.bytecode?.object || contractJson.bytecode;

    // For demo, we'll use environment variable or config file for channel address
    channelAddress = process.env.CHANNEL_ADDRESS;
    if (channelAddress) {
      channelContract = new ethers.Contract(channelAddress, contractJson.abi, serverWallet);
      console.log(chalk.green(`✓ Using existing channel: ${channelAddress}\n`));
    } else {
      console.log(chalk.yellow('⚠ No channel address provided. Use CHANNEL_ADDRESS env variable.\n'));
    }

    return contractJson.abi;
  } catch (error) {
    console.error(chalk.red('Failed to load contract:'), error.message);
    return null;
  }
}

// API Endpoints

/**
 * GET /catalog - List available video content
 */
app.get('/catalog', (req, res) => {
  console.log(chalk.cyan('\n📹 Video catalog request received'));

  const catalog = Object.values(videoCatalog).map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    thumbnail: item.thumbnail,
    duration: item.duration,
    segmentCount: item.segmentCount,
    pricePerSegment: item.pricePerSegment,
    fullPrice: item.fullPrice,
    hasPreview: true,
    segments: item.segments, // Include segments array
    previewSegment: item.previewSegment // Include preview segment identifier
  }));

  res.json({
    success: true,
    catalog
  });
});

/**
 * GET /video/:videoId/preview - Get free preview playlist
 */
app.get('/video/:videoId/preview', async (req, res) => {
  const { videoId } = req.params;

  console.log(chalk.cyan(`\n🎬 Preview request for video: ${videoId}`));

  const video = videoCatalog[videoId];
  if (!video) {
    return res.status(404).json({
      success: false,
      error: 'Video not found'
    });
  }

  // Read the original playlist and modify it to only include the first segment
  const playlistPath = path.join(__dirname, '..', 'content', video.playlist);

  try {
    const originalPlaylist = await fs.readFile(playlistPath, 'utf8');
    const lines = originalPlaylist.split('\n');
    const modifiedLines = [];
    let segmentCount = 0;
    let includeNext = false;

    for (const line of lines) {
      if (line.startsWith('#EXTM3U') || line.startsWith('#EXT-X-VERSION') ||
          line.startsWith('#EXT-X-TARGETDURATION') || line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        modifiedLines.push(line);
      } else if (line.startsWith('#EXTINF')) {
        if (segmentCount === 0) {
          modifiedLines.push(line);
          includeNext = true;
        }
        segmentCount++;
      } else if (includeNext && line.trim() && !line.startsWith('#')) {
        // This is the segment filename - make it absolute
        modifiedLines.push(`http://localhost:3000/video/${videoId}/preview-segment`);
        includeNext = false;
        break; // Stop after first segment
      }
    }

    modifiedLines.push('#EXT-X-ENDLIST');
    const previewPlaylist = modifiedLines.join('\n');

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Disposition': 'inline'
    });
    res.type('application/vnd.apple.mpegurl');
    res.send(previewPlaylist);
    console.log(chalk.green(`✓ Preview playlist served for video: ${videoId}`));
  } catch (error) {
    console.error(chalk.red('Failed to read playlist:'), error.message);
    // Fallback to simple playlist
    const segmentUrl = `http://localhost:3000/video/${videoId}/preview-segment`;
    const previewPlaylist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
${segmentUrl}
#EXT-X-ENDLIST`;

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Disposition': 'inline'
    });
    res.type('application/vnd.apple.mpegurl');
    res.send(previewPlaylist);
  }
});

/**
 * GET /video/:videoId/preview-segment - Get the actual preview segment file
 */
app.get('/video/:videoId/preview-segment', async (req, res) => {
  const { videoId } = req.params;

  const video = videoCatalog[videoId];
  if (!video) {
    return res.status(404).json({
      success: false,
      error: 'Video not found'
    });
  }

  // Serve the preview segment
  const segmentPath = path.join(__dirname, '..', 'content', video.previewSegment);

  try {
    const segmentData = await fs.readFile(segmentPath);
    res.set({
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'Content-Length': segmentData.length
    });
    res.send(segmentData);
    console.log(chalk.green(`✓ Preview segment served: ${video.previewSegment}`));
  } catch (error) {
    console.error(chalk.red('Failed to serve preview:'), error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to load preview'
    });
  }
});

/**
 * GET /video/:videoId/playlist.m3u8 - Get HLS playlist (requires purchase)
 */
app.get('/video/:videoId/playlist.m3u8', async (req, res) => {
  const { videoId } = req.params;
  const { channel } = req.query; // Channel address for authorization

  console.log(chalk.cyan(`\n📺 Playlist request for video: ${videoId}`));
  console.log(chalk.gray(`  Channel: ${channel}`));

  const video = videoCatalog[videoId];
  if (!video) {
    return res.status(404).json({
      success: false,
      error: 'Video not found'
    });
  }

  // Check if user has purchased full video OR is in segment purchase mode
  const userVideoKey = getUserVideoKey(channel, videoId);
  const hasFullAccess = videoPurchases.has(userVideoKey);

  // In segment purchase mode, we allow playlist access
  // Individual segments will be authorized when requested
  if (!hasFullAccess) {
    console.log(chalk.yellow(`⚠ Playlist access for segment purchase mode: ${videoId}`));
    // Don't block access - allow playlist for segment-by-segment purchases
  } else {
    console.log(chalk.green(`✓ Full video access verified for: ${videoId}`));
  }

  // Read and serve the playlist
  const playlistPath = path.join(__dirname, '..', 'content', video.playlist);

  try {
    let playlistContent = await fs.readFile(playlistPath, 'utf8');

    // Modify playlist URLs to include authorization
    playlistContent = playlistContent.replace(
      /^(video\d+\.ts)$/gm,
      `/video/${videoId}/segment/$1?channel=${channel}`
    );

    res.set({
      'Content-Type': 'application/x-mpegURL',
      'Cache-Control': 'no-cache'
    });
    res.send(playlistContent);
    console.log(chalk.green(`✓ Playlist served for purchased video`));
  } catch (error) {
    console.error(chalk.red('Failed to serve playlist:'), error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to load playlist'
    });
  }
});

/**
 * GET /video/:videoId/segment/:segmentName - Get video segment
 */
app.get('/video/:videoId/segment/:segmentName', async (req, res) => {
  const { videoId, segmentName } = req.params;
  const { channel } = req.query;

  console.log(chalk.cyan(`\n🎞 Segment request: ${segmentName} for video: ${videoId}`));

  const video = videoCatalog[videoId];
  if (!video) {
    return res.status(404).json({
      success: false,
      error: 'Video not found'
    });
  }

  // Check if this is the preview segment (always free)
  if (segmentName === video.previewSegment) {
    const segmentPath = path.join(__dirname, '..', 'content', segmentName);
    try {
      const segmentData = await fs.readFile(segmentPath);
      res.set({
        'Content-Type': 'video/mp2t',
        'Cache-Control': 'public, max-age=3600'
      });
      res.send(segmentData);
      console.log(chalk.green(`✓ Preview segment served: ${segmentName}`));
      return;
    } catch (error) {
      console.error(chalk.red('Failed to serve preview:'), error.message);
      return res.status(500).json({
        success: false,
        error: 'Failed to load segment'
      });
    }
  }

  // Check authorization - either full video purchase or per-segment purchase
  const userVideoKey = getUserVideoKey(channel, videoId);
  const userSegmentKey = getUserSegmentKey(channel, videoId, segmentName);

  const hasFullAccess = videoPurchases.has(userVideoKey);
  const hasSegmentAccess = segmentPurchases.has(userSegmentKey);

  if (!hasFullAccess && !hasSegmentAccess) {
    console.log(chalk.red(`❌ Unauthorized segment access: ${segmentName}`));
    return res.status(403).json({
      success: false,
      error: 'Segment not purchased. Purchase full video or this segment.'
    });
  }

  // Serve the segment
  const segmentPath = path.join(__dirname, '..', 'content', segmentName);

  try {
    const segmentData = await fs.readFile(segmentPath);

    // Determine which revocation secret to use for encryption
    let revocationSecret = null;
    let accessType = '';

    if (hasFullAccess) {
      // For full video access, use the revocation secret from the full purchase
      const purchase = videoPurchases.get(userVideoKey);
      if (purchase && purchase.revocationSecret) {
        revocationSecret = purchase.revocationSecret;
        accessType = 'full access';
      }
    } else if (hasSegmentAccess) {
      // For segment purchase, use the segment-specific revocation secret
      const segmentPurchase = segmentPurchases.get(userSegmentKey);
      if (segmentPurchase && segmentPurchase.revocationSecret) {
        revocationSecret = segmentPurchase.revocationSecret;
        accessType = 'segment purchase';
      }
    }

    // If we have a revocation secret, encrypt the segment
    if (revocationSecret) {
      const encryptedData = ContentEncryption.encrypt(segmentData.toString('base64'), revocationSecret);

      res.set({
        'Content-Type': 'application/octet-stream',
        'X-Encrypted': 'true',
        'X-Encryption-Format': 'aes-256-gcm',
        'Cache-Control': 'private, max-age=3600'
      });
      res.send(encryptedData.combined);
      console.log(chalk.green(`✓ Encrypted segment served: ${segmentName} (${accessType})`));
      return;
    }

    // Fallback: serve unencrypted (shouldn't happen in normal flow)
    console.log(chalk.yellow(`⚠ Serving unencrypted segment: ${segmentName} (no revocation secret)`));
    res.set({
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'private, max-age=3600'
    });
    res.send(segmentData);
    console.log(chalk.green(`✓ Segment served: ${segmentName} (unencrypted fallback)`));
  } catch (error) {
    console.error(chalk.red('Failed to serve segment:'), error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to load segment'
    });
  }
});

/**
 * POST /purchase-video - Purchase full video or specific segment
 */
app.post('/purchase-video', async (req, res) => {
  const {
    videoId,
    purchaseType, // 'full' or 'segment'
    segmentName, // if purchaseType === 'segment'
    channelAddress: clientChannelAddress,
    partyAAddress
  } = req.body;

  console.log(chalk.cyan(`\n🎬 Video purchase request:`));
  console.log(chalk.gray(`  Video ID: ${videoId}`));
  console.log(chalk.gray(`  Purchase type: ${purchaseType}`));
  if (segmentName) {
    console.log(chalk.gray(`  Segment: ${segmentName}`));
  }
  console.log(chalk.gray(`  Channel: ${clientChannelAddress}`));
  console.log(chalk.gray(`  PartyA address: ${partyAAddress}`));

  // Validate channel is registered
  const channel = channels.get(clientChannelAddress);
  if (!channel) {
    console.log(chalk.red(`\n❌ Channel not registered: ${clientChannelAddress}`));
    return res.status(400).json({
      success: false,
      error: 'Channel not registered'
    });
  }

  // Validate caller is partyA
  if (channel.partyA.toLowerCase() !== partyAAddress.toLowerCase()) {
    console.log(chalk.red(`\n❌ Invalid caller: ${partyAAddress} is not partyA`));
    return res.status(400).json({
      success: false,
      error: 'Invalid caller - not partyA'
    });
  }

  // Use server's tracked balances
  const currentPartyABalance = channel.currentPartyABalance;
  const currentPartyBBalance = channel.currentPartyBBalance;
  const currentNonce = channel.latestNonce;

  console.log(chalk.gray(`  Server-tracked nonce: ${currentNonce}`));
  console.log(chalk.gray(`  Server-tracked balances - PartyA: ${currentPartyABalance}, PartyB: ${currentPartyBBalance}`));

  // Validate video exists
  const video = videoCatalog[videoId];
  if (!video) {
    return res.status(404).json({
      success: false,
      error: 'Video not found'
    });
  }

  // Determine price based on purchase type
  let price;
  let purchaseDescription;
  if (purchaseType === 'full') {
    price = parseFloat(video.fullPrice);
    purchaseDescription = `Full video: ${video.title}`;
  } else if (purchaseType === 'segment') {
    if (!segmentName || !video.segments.includes(segmentName)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid segment'
      });
    }
    // Don't charge for preview segment
    if (segmentName === video.previewSegment) {
      return res.status(400).json({
        success: false,
        error: 'Preview segment is free'
      });
    }
    price = parseFloat(video.pricePerSegment);
    purchaseDescription = `Segment ${segmentName} of ${video.title}`;
  } else {
    return res.status(400).json({
      success: false,
      error: 'Invalid purchase type. Use "full" or "segment"'
    });
  }

  // Check if client has sufficient funds
  const clientBalance = parseFloat(currentPartyABalance);
  if (clientBalance < price) {
    console.log(chalk.red(`\n❌ Insufficient funds:`));
    console.log(chalk.gray(`  Client balance: ${clientBalance} ETH`));
    console.log(chalk.gray(`  Required: ${price} ETH`));
    return res.status(400).json({
      success: false,
      error: 'Insufficient funds',
      required: price.toString(),
      available: currentPartyABalance
    });
  }

  // Generate new nonce for this payment
  const newNonce = currentNonce + 1;

  // Calculate new balances after payment
  const newPartyABalance = (parseFloat(currentPartyABalance) - price).toString();
  const newPartyBBalance = (parseFloat(currentPartyBBalance) + price).toString();

  console.log(chalk.cyan('\n💰 Balance calculation:'));
  console.log(chalk.gray(`  Payment amount: ${price} ETH`));
  console.log(chalk.gray(`  New PartyA balance: ${newPartyABalance} ETH`));
  console.log(chalk.gray(`  New PartyB balance: ${newPartyBBalance} ETH`));

  // Generate PartyB's revocation secret for this nonce
  const partyBRevocationSecret = partyBRevocationManager.generateSecret(newNonce);
  const partyBRevocationHash = ethers.keccak256(partyBRevocationSecret);

  console.log(chalk.yellow('\n🔐 Generated revocation secret:'));
  console.log(chalk.gray(`  Nonce: ${newNonce}`));
  console.log(chalk.gray(`  Secret: ${partyBRevocationSecret.substring(0, 30)}...`));
  console.log(chalk.gray(`  Hash: ${partyBRevocationHash.substring(0, 30)}...`));

  // Create the commitment structure
  const commitment = {
    channelAddress: clientChannelAddress,
    nonce: newNonce,
    partyABalance: newPartyABalance,
    partyBBalance: newPartyBBalance,
    partyBRevocationHash: partyBRevocationHash
    // Note: partyARevocationHash will be added by client
  };

  console.log(chalk.yellow('\n📝 Created unsigned commitment:'));
  console.log(chalk.gray(`  Channel: ${commitment.channelAddress}`));
  console.log(chalk.gray(`  Nonce: ${commitment.nonce}`));
  console.log(chalk.gray(`  PartyA balance: ${commitment.partyABalance} ETH`));
  console.log(chalk.gray(`  PartyB balance: ${commitment.partyBBalance} ETH`));

  // Create invoice ID
  const invoiceId = ethers.keccak256(
    ethers.solidityPacked(
      ['address', 'uint256', 'string'],
      [clientChannelAddress, newNonce, `${videoId}_${purchaseType}_${segmentName || 'full'}`]
    )
  );

  // Store pending invoice with commitment details
  pendingInvoices.set(invoiceId, {
    videoId,
    purchaseType,
    segmentName,
    channelAddress: clientChannelAddress,
    nonce: newNonce,
    price: price.toString(),
    partyBRevocationSecret,
    partyBRevocationHash,
    partyAAddress,
    commitment,
    timestamp: Date.now()
  });

  console.log(chalk.green(`\n✓ Invoice created: ${invoiceId.substring(0, 20)}...`));

  res.json({
    success: true,
    invoice: {
      id: invoiceId,
      videoId: video.id,
      title: video.title,
      purchaseDescription,
      purchaseType,
      segmentName,
      price: price.toString(),
      nonce: newNonce,
      partyBRevocationHash,
      commitment: commitment // Include the unsigned commitment
    }
  });
});

/**
 * POST /submit-video-payment - Submit signed commitment for video payment
 */
app.post('/submit-video-payment', async (req, res) => {
  const {
    invoiceId,
    commitment,
    partyASignature,
    partyARevocationHash
  } = req.body;

  console.log(chalk.cyan(`\n💳 Video payment commitment received for invoice: ${invoiceId.substring(0, 20)}...`));

  // Retrieve pending invoice
  const invoice = pendingInvoices.get(invoiceId);
  if (!invoice) {
    return res.status(404).json({
      success: false,
      error: 'Invoice not found or expired'
    });
  }

  // Verify commitment structure
  console.log(chalk.yellow('\n🔍 Verifying commitment:'));
  console.log(chalk.gray(`  Channel: ${commitment.channelAddress}`));
  console.log(chalk.gray(`  Nonce: ${commitment.nonce}`));
  console.log(chalk.gray(`  PartyA balance: ${commitment.partyABalance} ETH`));
  console.log(chalk.gray(`  PartyB balance: ${commitment.partyBBalance} ETH`));

  // Recreate commitment hash
  const commitmentData = ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
    [
      commitment.channelAddress,
      commitment.nonce,
      ethers.parseEther(commitment.partyABalance),
      ethers.parseEther(commitment.partyBBalance),
      partyARevocationHash,
      invoice.partyBRevocationHash
    ]
  );

  const commitmentHash = ethers.keccak256(commitmentData);
  console.log(chalk.gray(`  Commitment hash: ${commitmentHash.substring(0, 30)}...`));

  // Verify PartyA's signature
  const recoveredAddress = ethers.verifyMessage(
    ethers.getBytes(commitmentHash),
    partyASignature
  );

  if (recoveredAddress.toLowerCase() !== invoice.partyAAddress.toLowerCase()) {
    console.log(chalk.red('❌ Invalid signature!'));
    return res.status(400).json({
      success: false,
      error: 'Invalid signature'
    });
  }

  console.log(chalk.green('✓ PartyA\'s signature verified'));

  // Validate commitment matches invoice expectations
  const channel = channels.get(commitment.channelAddress);
  if (!channel) {
    return res.status(400).json({
      success: false,
      error: 'Channel not registered'
    });
  }

  // Verify nonce is exactly invoice nonce (prevents replay)
  if (commitment.nonce !== invoice.nonce) {
    console.log(chalk.red(`❌ Nonce mismatch: expected ${invoice.nonce}, got ${commitment.nonce}`));
    return res.status(400).json({
      success: false,
      error: 'Invalid nonce'
    });
  }

  // Verify balances match expected values from invoice
  const expectedPartyABalance = invoice.commitment.partyABalance;
  const expectedPartyBBalance = invoice.commitment.partyBBalance;
  if (commitment.partyABalance !== expectedPartyABalance || commitment.partyBBalance !== expectedPartyBBalance) {
    console.log(chalk.red(`❌ Balance mismatch:`));
    console.log(chalk.gray(`  Expected PartyA: ${expectedPartyABalance}, got: ${commitment.partyABalance}`));
    console.log(chalk.gray(`  Expected PartyB: ${expectedPartyBBalance}, got: ${commitment.partyBBalance}`));
    return res.status(400).json({
      success: false,
      error: 'Invalid balances'
    });
  }

  // PartyB signs the commitment
  console.log(chalk.yellow('\n✍️ PartyB counter-signing commitment...'));
  const partyBSignature = await serverWallet.signMessage(ethers.getBytes(commitmentHash));
  console.log(chalk.gray(`  PartyB's signature: ${partyBSignature.substring(0, 30)}...`));

  // Store the completed commitment and update balances
  channel.commitments.push({
    nonce: commitment.nonce,
    hash: commitmentHash,
    partyABalance: commitment.partyABalance,
    partyBBalance: commitment.partyBBalance,
    partyASignature,
    partyBSignature,
    timestamp: Date.now()
  });
  channel.latestNonce = commitment.nonce;
  channel.currentPartyABalance = commitment.partyABalance;
  channel.currentPartyBBalance = commitment.partyBBalance;

  console.log(chalk.green('✓ Commitment accepted and stored'));
  console.log(chalk.cyan(`  Updated balances - PartyA: ${channel.currentPartyABalance}, PartyB: ${channel.currentPartyBBalance}`));

  // Grant access based on purchase type
  const video = videoCatalog[invoice.videoId];
  if (invoice.purchaseType === 'full') {
    const userVideoKey = getUserVideoKey(commitment.channelAddress, invoice.videoId);
    videoPurchases.set(userVideoKey, {
      timestamp: Date.now(),
      price: invoice.price,
      nonce: commitment.nonce,
      revocationSecret: invoice.partyBRevocationSecret // Store the revocation secret for encryption
    });
    console.log(chalk.magenta(`\n🎬 Full video access granted: ${video.title}`));
  } else if (invoice.purchaseType === 'segment') {
    const userSegmentKey = getUserSegmentKey(commitment.channelAddress, invoice.videoId, invoice.segmentName);
    segmentPurchases.set(userSegmentKey, {
      timestamp: Date.now(),
      price: invoice.price,
      nonce: commitment.nonce,
      revocationSecret: invoice.partyBRevocationSecret // Store unique revocation secret for this segment
    });
    console.log(chalk.magenta(`\n🎞 Segment access granted: ${invoice.segmentName}`));
  }

  // Mark invoice as paid
  pendingInvoices.delete(invoiceId);

  res.json({
    success: true,
    partyBSignature,
    accessGranted: invoice.purchaseType === 'full' ? 'full_video' : `segment_${invoice.segmentName}`,
    message: `Payment accepted! You now have access to ${invoice.purchaseType === 'full' ? 'the full video' : `segment ${invoice.segmentName}`}.`,
    // Include revocation secret for both full video and segment purchases so client can decrypt
    revocationSecret: invoice.partyBRevocationSecret
  });
});

/**
 * GET /channel/:address - Get channel state
 */
app.get('/channel/:address', (req, res) => {
  const { address } = req.params;
  const channel = channels.get(address);

  if (!channel) {
    return res.status(404).json({
      success: false,
      error: 'Channel not found'
    });
  }

  res.json({
    success: true,
    channel: {
      address,
      latestNonce: channel.latestNonce,
      currentPartyABalance: channel.currentPartyABalance,
      currentPartyBBalance: channel.currentPartyBBalance,
      totalCommitments: channel.commitments.length,
      latestCommitment: channel.commitments[channel.commitments.length - 1]
    }
  });
});

/**
 * GET /contract - Get contract ABI and bytecode for channel deployment
 */
app.get('/contract', (req, res) => {
  if (!contractAbi || !contractBytecode) {
    return res.status(500).json({
      success: false,
      error: 'Contract not loaded'
    });
  }

  res.json({
    success: true,
    abi: contractAbi,
    bytecode: contractBytecode
  });
});

/**
 * GET /server-info - Get server's address for channel setup
 */
app.get('/server-info', (req, res) => {
  res.json({
    success: true,
    address: serverWallet.address,
    defaultDeposit: '0.001'
  });
});

/**
 * POST /register-channel - Client notifies server about a new channel
 * Server verifies on-chain state before accepting
 */
app.post('/register-channel', async (req, res) => {
  const { channelAddress: addr, clientAddress } = req.body;

  console.log(chalk.cyan(`\n📢 Channel registration request:`));
  console.log(chalk.gray(`  Channel: ${addr}`));
  console.log(chalk.gray(`  Client: ${clientAddress}`));

  try {
    if (!contractAbi) {
      throw new Error('Contract ABI not loaded');
    }

    // Verify contract exists
    const code = await provider.getCode(addr);
    if (code === '0x') {
      throw new Error('No contract at address');
    }

    const contract = new ethers.Contract(addr, contractAbi, provider);

    // Get channel info from contract
    const info = await contract.getChannelInfo();
    const partyA = info[0];
    const partyB = info[1];
    const balance = info[2];
    const stateIndex = Number(info[3]);

    console.log(chalk.yellow('\n🔍 Verifying channel on-chain:'));
    console.log(chalk.gray(`  PartyA: ${partyA}`));
    console.log(chalk.gray(`  PartyB: ${partyB}`));
    console.log(chalk.gray(`  Balance: ${ethers.formatEther(balance)} ETH`));
    console.log(chalk.gray(`  State: ${stateIndex}`));

    // Verify server is partyB (info[1] is the partyB address from contract)
    if (info[1].toLowerCase() !== serverWallet.address.toLowerCase()) {
      throw new Error('Server is not partyB in this channel');
    }

    // Verify channel is OPEN (state = 1)
    if (stateIndex !== 1) {
      throw new Error('Channel is not open');
    }

    // Verify client is partyA
    if (partyA.toLowerCase() !== clientAddress.toLowerCase()) {
      throw new Error('Client is not partyA in this channel');
    }

    // Verify channel has funds
    if (balance === 0n) {
      throw new Error('Channel has no funds');
    }

    // Read individual deposits
    const depositA = await contract.deposits(partyA);
    const depositB = await contract.deposits(partyB);

    console.log(chalk.gray(`  Deposit A: ${ethers.formatEther(depositA)} ETH`));
    console.log(chalk.gray(`  Deposit B: ${ethers.formatEther(depositB)} ETH`));

    // Store channel reference
    channelAddress = addr;

    // Get existing channel data (may have been created during initial commitment signing)
    const existingChannel = channels.get(addr);
    const initialPartyABalance = ethers.formatEther(depositA);
    const initialPartyBBalance = ethers.formatEther(depositB);

    // Initialize or update channel tracking with current balances
    channels.set(addr, {
      commitments: existingChannel?.commitments || [],
      latestNonce: existingChannel?.latestNonce || 0,
      partyA,
      partyB,
      initialBalanceA: initialPartyABalance,
      initialBalanceB: initialPartyBBalance,
      currentPartyABalance: existingChannel?.currentPartyABalance || initialPartyABalance,
      currentPartyBBalance: existingChannel?.currentPartyBBalance || initialPartyBBalance,
      pendingFunding: false
    });

    console.log(chalk.green(`\n✓ Channel registered: ${addr}`));
    console.log(chalk.cyan(`  Initial balances - PartyA: ${initialPartyABalance}, PartyB: ${initialPartyBBalance}`));

    res.json({
      success: true,
      totalBalance: ethers.formatEther(balance),
      depositA: ethers.formatEther(depositA),
      depositB: ethers.formatEther(depositB)
    });
  } catch (error) {
    console.error(chalk.red('Registration failed:'), error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /sign-initial-commitment - Sign initial commitment before client funds
 * This follows Lightning Network pattern: get signatures BEFORE funding
 */
app.post('/sign-initial-commitment', async (req, res) => {
  const {
    channelAddress: addr,
    clientAddress,
    clientDeposit,
    commitmentHash,
    clientSignature,
    clientRevocationHash
  } = req.body;

  console.log(chalk.cyan(`\n📝 Initial commitment signing request:`));
  console.log(chalk.gray(`  Channel: ${addr}`));
  console.log(chalk.gray(`  Client: ${clientAddress}`));
  console.log(chalk.gray(`  Client deposit: ${clientDeposit} ETH`));
  console.log(chalk.gray(`  Commitment hash: ${commitmentHash.substring(0, 30)}...`));

  try {
    // Verify contract exists and is in FUNDING state
    if (!contractAbi) {
      throw new Error('Contract ABI not loaded');
    }

    const code = await provider.getCode(addr);
    if (code === '0x') {
      throw new Error('No contract at address');
    }

    const contract = new ethers.Contract(addr, contractAbi, provider);
    const info = await contract.getChannelInfo();
    const partyA = info[0];
    const partyB = info[1];
    const stateIndex = Number(info[3]);

    console.log(info)

    // Verify channel is in FUNDING state
    if (stateIndex !== 0) {
      throw new Error('Channel is not in FUNDING state');
    }

    // Verify server is partyB
    if (partyB.toLowerCase() !== serverWallet.address.toLowerCase()) {
      throw new Error('Server is not partyB in this channel');
    }

    // Verify client is partyA
    if (partyA.toLowerCase() !== clientAddress.toLowerCase()) {
      throw new Error('Client is not partyA in this channel');
    }

    // Verify client's signature on the commitment hash
    const recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(commitmentHash),
      clientSignature
    );

    if (recoveredAddress.toLowerCase() !== clientAddress.toLowerCase()) {
      throw new Error('Invalid client signature');
    }

    console.log(chalk.green('✓ Client signature verified'));

    // Generate server's revocation hash for this commitment (nonce 0)
    const serverRevocationSecret = partyBRevocationManager.generateSecret(0);
    const serverRevocationHash = ethers.keccak256(serverRevocationSecret);

    console.log(chalk.yellow('\n🔐 Generated server revocation hash:'));
    console.log(chalk.gray(`  Hash: ${serverRevocationHash.substring(0, 30)}...`));

    // Sign the commitment hash
    const serverSignature = await serverWallet.signMessage(ethers.getBytes(commitmentHash));

    console.log(chalk.green('✓ Commitment signed by server'));
    console.log(chalk.gray(`  Signature: ${serverSignature.substring(0, 30)}...`));

    // Store pending channel info for when it gets funded
    channels.set(addr, {
      commitments: [{
        nonce: 0,
        hash: commitmentHash,
        partyABalance: clientDeposit,
        partyBBalance: '0',
        partyASignature: clientSignature,
        partyBSignature: serverSignature,
        partyARevocationHash: clientRevocationHash,
        partyBRevocationHash: serverRevocationHash,
        timestamp: Date.now()
      }],
      latestNonce: 0,
      partyA,
      partyB,
      initialBalanceA: clientDeposit,
      initialBalanceB: '0',
      currentPartyABalance: clientDeposit,
      currentPartyBBalance: '0',
      pendingFunding: true
    });

    res.json({
      success: true,
      serverSignature,
      serverRevocationHash
    });
  } catch (error) {
    console.error(chalk.red('Initial commitment signing failed:'), error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /close-channel - Request cooperative channel close
 * Server signs the close message and returns signature
 */
app.post('/close-channel', async (req, res) => {
  const { channelAddress: addr, balanceA, balanceB } = req.body;

  console.log(chalk.cyan(`\n🔒 Channel close request:`));
  console.log(chalk.gray(`  Channel: ${addr}`));
  console.log(chalk.gray(`  Requested Balance A: ${balanceA} ETH`));
  console.log(chalk.gray(`  Requested Balance B: ${balanceB} ETH`));

  try {
    if (!contractAbi) {
      throw new Error('Contract ABI not loaded');
    }

    // Validate channel is registered
    const channel = channels.get(addr);
    if (!channel) {
      throw new Error('Channel not registered');
    }

    // Validate requested balances match server's tracked state (compare as wei to avoid floating-point issues)
    console.log(chalk.yellow('\n🔍 Validating balances against server state:'));
    console.log(chalk.gray(`  Server-tracked PartyA: ${channel.currentPartyABalance} ETH`));
    console.log(chalk.gray(`  Server-tracked PartyB: ${channel.currentPartyBBalance} ETH`));

    const requestedPartyAWei = ethers.parseEther(balanceA);
    const requestedPartyBWei = ethers.parseEther(balanceB);
    const trackedPartyAWei = ethers.parseEther(channel.currentPartyABalance);
    const trackedPartyBWei = ethers.parseEther(channel.currentPartyBBalance);

    if (requestedPartyAWei !== trackedPartyAWei || requestedPartyBWei !== trackedPartyBWei) {
      console.log(chalk.red(`\n❌ Balance mismatch with server state`));
      throw new Error(`Balance mismatch: expected PartyA=${channel.currentPartyABalance}, PartyB=${channel.currentPartyBBalance}`);
    }

    console.log(chalk.green('✓ Balances match server state'));

    // Verify channel exists and is open on-chain
    const contract = new ethers.Contract(addr, contractAbi, provider);
    const info = await contract.getChannelInfo();
    const stateIndex = Number(info[3]);

    if (stateIndex !== 1) {
      throw new Error('Channel is not open');
    }

    // Verify balances match channel balance
    const channelBalance = info[2];
    const totalBalance = ethers.parseEther(balanceA) + ethers.parseEther(balanceB);
    if (totalBalance !== channelBalance) {
      throw new Error(`On-chain balance mismatch: ${ethers.formatEther(totalBalance)} != ${ethers.formatEther(channelBalance)}`);
    }

    // Create close message hash (must match contract)
    const closeHash = ethers.keccak256(
      ethers.solidityPacked(
        ['string', 'address', 'uint256', 'uint256'],
        ['CLOSE', addr, ethers.parseEther(balanceA), ethers.parseEther(balanceB)]
      )
    );

    // Sign with PartyB's key
    const partyBSignature = await serverWallet.signMessage(ethers.getBytes(closeHash));

    console.log(chalk.green(`\n✓ Close message signed`));
    console.log(chalk.gray(`  Close hash: ${closeHash.substring(0, 30)}...`));

    res.json({
      success: true,
      partyBSignature,
      closeHash
    });
  } catch (error) {
    console.error(chalk.red('Close request failed:'), error.message);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /channel-status/:address - Get on-chain channel status
 */
app.get('/channel-status/:address', async (req, res) => {
  const { address: addr } = req.params;

  try {
    if (!contractAbi) {
      throw new Error('Contract ABI not loaded');
    }

    const contract = new ethers.Contract(addr, contractAbi, provider);
    const info = await contract.getChannelInfo();

    const stateNames = ['FUNDING', 'OPEN', 'DISPUTED', 'CLOSED'];

    res.json({
      success: true,
      partyA: info[0],
      partyB: info[1],
      balance: ethers.formatEther(info[2]),
      state: stateNames[info[3]],
      stateIndex: Number(info[3]),
      latestNonce: info[4].toString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve static content files (for direct access during development)
app.use('/content', express.static(path.join(__dirname, '..', 'content')));

// Initialize server
async function startServer() {
  const abi = await loadChannelContract();

  app.listen(PORT, () => {
    console.log(chalk.green.bold(`\n✓ Video streaming server running on http://localhost:${PORT}\n`));

    console.log(chalk.yellow('Available endpoints:'));
    console.log(chalk.white('  GET  /catalog                        - List available videos'));
    console.log(chalk.white('  GET  /video/:videoId/preview         - Get free preview segment'));
    console.log(chalk.white('  GET  /video/:videoId/playlist.m3u8   - Get HLS playlist (requires purchase)'));
    console.log(chalk.white('  GET  /video/:videoId/segment/:name   - Get video segment'));
    console.log(chalk.white('  POST /purchase-video                 - Purchase full video or segment'));
    console.log(chalk.white('  POST /submit-video-payment           - Submit payment commitment'));
    console.log(chalk.white('  GET  /channel/:address               - Get channel state'));
    console.log(chalk.white('  GET  /contract                       - Get contract ABI/bytecode'));
    console.log(chalk.white('  GET  /server-info                    - Get server address'));
    console.log(chalk.white('  POST /sign-initial-commitment        - Sign initial commitment'));
    console.log(chalk.white('  POST /register-channel               - Register client-created channel'));
    console.log(chalk.white('  POST /close-channel                  - Request cooperative close'));
    console.log(chalk.white('  GET  /channel-status/:addr           - On-chain channel status\n'));

    console.log(chalk.cyan('🎬 Serving video content with HLS streaming'));
    console.log(chalk.cyan('📹 ' + Object.keys(videoCatalog).length + ' videos available in catalog'));
    console.log(chalk.cyan('Waiting for client requests...\n'));
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nShutting down server...'));
  process.exit(0);
});

// Start the server
startServer().catch(console.error);
