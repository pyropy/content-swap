#!/usr/bin/env node

import express from 'express';
import { ethers } from 'ethers';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs/promises';
import cors from 'cors';

/**
 * Lightning Network Payment Channel Content Server
 *
 * This server demonstrates how to sell digital content using Lightning Network
 * payment channels. The flow is:
 *
 * 1. Client requests content
 * 2. Server responds with encrypted content + invoice
 * 3. Client creates and signs a new commitment
 * 4. Server verifies and counter-signs
 * 5. Server reveals revocation secret (decryption key)
 * 6. Client can decrypt content
 */

const app = express();
app.use(express.json());
app.use(cors());

const PORT = 3000;

// Server's wallet (Bob - content seller)
const bobPrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const bob = new ethers.Wallet(bobPrivateKey, provider);

console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════════'));
console.log(chalk.blue.bold('     PAYMENT CHANNEL CONTENT DELIVERY SERVER'));
console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════\n'));

console.log(chalk.yellow('Server Configuration:'));
console.log(chalk.white(`  Operator: Bob (Content Seller)`));
console.log(chalk.gray(`  Address: ${bob.address}`));
console.log(chalk.gray(`  Port: ${PORT}\n`));

// Content Encryption utilities
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

// Initialize Bob's revocation key manager
const bobRevocationManager = new RevocationKeyManager(
  ethers.keccak256(ethers.toUtf8Bytes("bob-server-seed"))
);

// In-memory storage for channel states and content
const channels = new Map();
const pendingInvoices = new Map();

// Digital content catalog
const contentCatalog = {
  'content-1': {
    id: 'content-1',
    title: 'Secret Recipe',
    description: 'The perfect chocolate cake recipe',
    content: 'Hello World! This is the secret recipe for the perfect chocolate cake: Mix 2 cups flour, 1 cup sugar, 3/4 cup cocoa powder, 2 eggs, 1 cup milk. Bake at 350°F for 30 minutes.',
    price: '0.1'
  },
  'content-2': {
    id: 'content-2',
    title: 'Trading Algorithm',
    description: 'Professional trading strategy',
    content: 'CONFIDENTIAL ALGORITHM: Buy when RSI < 30 and MACD crosses above signal line. Sell when RSI > 70. Set stop loss at 2% and take profit at 5%. Never risk more than 1% per trade.',
    price: '0.2'
  },
  'content-3': {
    id: 'content-3',
    title: 'API Access Key',
    description: 'Premium API access credentials',
    content: 'API_KEY=sk-proj-abc123xyz789def | Endpoint: https://api.premium-service.com/v1/ | Rate limit: 1000 requests/minute | Includes all premium features.',
    price: '0.15'
  }
};

// Load or initialize channel contract
let channelContract = null;
let channelAddress = null;

async function loadChannelContract() {
  try {
    const contractPath = new URL('../out/BidirectionalChannel.sol/BidirectionalChannel.json', import.meta.url);
    const contractJson = JSON.parse(await fs.readFile(contractPath, 'utf8'));

    // For demo, we'll use environment variable or config file for channel address
    channelAddress = process.env.CHANNEL_ADDRESS;
    if (channelAddress) {
      channelContract = new ethers.Contract(channelAddress, contractJson.abi, bob);
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
 * GET /catalog - List available content
 */
app.get('/catalog', (req, res) => {
  console.log(chalk.cyan('\n📚 Catalog request received'));

  const catalog = Object.values(contentCatalog).map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    price: item.price
  }));

  res.json({
    success: true,
    catalog
  });
});

/**
 * POST /request-content - Request specific content
 * Returns encrypted content, invoice, and unsigned commitment
 */
app.post('/request-content', async (req, res) => {
  const { contentId, channelAddress: clientChannelAddress, currentNonce, aliceAddress, currentAliceBalance, currentBobBalance } = req.body;

  console.log(chalk.cyan(`\n📦 Content request received:`));
  console.log(chalk.gray(`  Content ID: ${contentId}`));
  console.log(chalk.gray(`  Channel: ${clientChannelAddress}`));
  console.log(chalk.gray(`  Current nonce: ${currentNonce}`));
  console.log(chalk.gray(`  Alice address: ${aliceAddress}`));
  console.log(chalk.gray(`  Current balances - Alice: ${currentAliceBalance}, Bob: ${currentBobBalance}`));

  // Validate content exists
  const content = contentCatalog[contentId];
  if (!content) {
    return res.status(404).json({
      success: false,
      error: 'Content not found'
    });
  }

  // Generate new nonce for this payment
  const newNonce = currentNonce + 1;

  // Calculate new balances after payment
  const newAliceBalance = (parseFloat(currentAliceBalance) - parseFloat(content.price)).toString();
  const newBobBalance = (parseFloat(currentBobBalance) + parseFloat(content.price)).toString();

  console.log(chalk.cyan('\n💰 Balance calculation:'));
  console.log(chalk.gray(`  Payment amount: ${content.price} ETH`));
  console.log(chalk.gray(`  New Alice balance: ${newAliceBalance} ETH`));
  console.log(chalk.gray(`  New Bob balance: ${newBobBalance} ETH`));

  // Generate Bob's revocation secret for this nonce
  const bobRevocationSecret = bobRevocationManager.generateSecret(newNonce);
  const bobRevocationHash = ethers.keccak256(bobRevocationSecret);

  console.log(chalk.yellow('\n🔐 Generated revocation secret:'));
  console.log(chalk.gray(`  Nonce: ${newNonce}`));
  console.log(chalk.gray(`  Secret: ${bobRevocationSecret.substring(0, 30)}...`));
  console.log(chalk.gray(`  Hash: ${bobRevocationHash.substring(0, 30)}...`));

  // Encrypt content with the revocation secret
  const encryptedContent = ContentEncryption.encrypt(content.content, bobRevocationSecret);

  console.log(chalk.yellow('\n🔒 Encrypted content:'));
  console.log(chalk.gray(`  Size: ${encryptedContent.combined.length} bytes`));

  // Create the commitment structure
  const commitment = {
    channelAddress: clientChannelAddress,
    nonce: newNonce,
    aliceBalance: newAliceBalance,
    bobBalance: newBobBalance,
    bobRevocationHash: bobRevocationHash
    // Note: aliceRevocationHash will be added by client
  };

  console.log(chalk.yellow('\n📝 Created unsigned commitment:'));
  console.log(chalk.gray(`  Channel: ${commitment.channelAddress}`));
  console.log(chalk.gray(`  Nonce: ${commitment.nonce}`));
  console.log(chalk.gray(`  Alice balance: ${commitment.aliceBalance} ETH`));
  console.log(chalk.gray(`  Bob balance: ${commitment.bobBalance} ETH`));

  // Create invoice ID
  const invoiceId = ethers.keccak256(
    ethers.solidityPacked(
      ['address', 'uint256', 'string'],
      [clientChannelAddress, newNonce, contentId]
    )
  );

  // Store pending invoice with commitment details
  pendingInvoices.set(invoiceId, {
    contentId,
    channelAddress: clientChannelAddress,
    nonce: newNonce,
    price: content.price,
    bobRevocationSecret,
    bobRevocationHash,
    aliceAddress,
    commitment,
    timestamp: Date.now()
  });

  console.log(chalk.green(`\n✓ Invoice created: ${invoiceId.substring(0, 20)}...`));

  res.json({
    success: true,
    invoice: {
      id: invoiceId,
      contentId: content.id,
      title: content.title,
      price: content.price,
      nonce: newNonce,
      bobRevocationHash,
      encryptedContent: encryptedContent.combined,
      contentPreview: content.content.substring(0, 30) + '...',
      commitment: commitment // Include the unsigned commitment
    }
  });
});

/**
 * POST /submit-commitment - Submit signed commitment for payment
 * Client sends their signed commitment, server verifies and counter-signs
 */
app.post('/submit-commitment', async (req, res) => {
  const {
    invoiceId,
    commitment,
    aliceSignature,
    aliceRevocationHash
  } = req.body;

  console.log(chalk.cyan(`\n💳 Commitment received for invoice: ${invoiceId.substring(0, 20)}...`));

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
  console.log(chalk.gray(`  Alice balance: ${commitment.aliceBalance} ETH`));
  console.log(chalk.gray(`  Bob balance: ${commitment.bobBalance} ETH`));

  // Recreate commitment hash
  const commitmentData = ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
    [
      commitment.channelAddress,
      commitment.nonce,
      ethers.parseEther(commitment.aliceBalance),
      ethers.parseEther(commitment.bobBalance),
      aliceRevocationHash,
      invoice.bobRevocationHash
    ]
  );

  const commitmentHash = ethers.keccak256(commitmentData);
  console.log(chalk.gray(`  Commitment hash: ${commitmentHash.substring(0, 30)}...`));

  // Verify Alice's signature
  const recoveredAddress = ethers.verifyMessage(
    ethers.getBytes(commitmentHash),
    aliceSignature
  );

  if (recoveredAddress.toLowerCase() !== invoice.aliceAddress.toLowerCase()) {
    console.log(chalk.red('❌ Invalid signature!'));
    return res.status(400).json({
      success: false,
      error: 'Invalid signature'
    });
  }

  console.log(chalk.green('✓ Alice\'s signature verified'));

  // Bob signs the commitment
  console.log(chalk.yellow('\n✍️ Bob counter-signing commitment...'));
  const bobSignature = await bob.signMessage(ethers.getBytes(commitmentHash));
  console.log(chalk.gray(`  Bob's signature: ${bobSignature.substring(0, 30)}...`));

  // Store the completed commitment
  if (!channels.has(commitment.channelAddress)) {
    channels.set(commitment.channelAddress, {
      commitments: [],
      latestNonce: 0
    });
  }

  const channel = channels.get(commitment.channelAddress);
  channel.commitments.push({
    nonce: commitment.nonce,
    hash: commitmentHash,
    aliceBalance: commitment.aliceBalance,
    bobBalance: commitment.bobBalance,
    aliceSignature,
    bobSignature,
    timestamp: Date.now()
  });
  channel.latestNonce = commitment.nonce;

  console.log(chalk.green('✓ Commitment accepted and stored'));

  // Reveal Bob's revocation secret (which is the decryption key!)
  const revocationSecret = invoice.bobRevocationSecret;

  console.log(chalk.magenta('\n🔓 Revealing revocation secret (decryption key):'));
  console.log(chalk.gray(`  Secret: ${revocationSecret.substring(0, 40)}...`));

  // Mark invoice as paid
  pendingInvoices.delete(invoiceId);

  res.json({
    success: true,
    bobSignature,
    revocationSecret,
    message: 'Payment accepted! Use the revocation secret to decrypt your content.'
  });
});

/**
 * POST /verify-decryption - Verify that client can decrypt content
 * This is optional - just for demonstration
 */
app.post('/verify-decryption', (req, res) => {
  const { encryptedContent, revocationSecret, expectedContentId } = req.body;

  console.log(chalk.cyan('\n🔍 Decryption verification request'));

  try {
    const decrypted = ContentEncryption.decrypt(
      { combined: encryptedContent },
      revocationSecret
    );

    const originalContent = contentCatalog[expectedContentId]?.content;
    const isValid = decrypted === originalContent;

    console.log(chalk.green(`✓ Decryption ${isValid ? 'successful' : 'failed'}`));

    res.json({
      success: isValid,
      decrypted: isValid ? decrypted.substring(0, 50) + '...' : null
    });
  } catch (error) {
    console.log(chalk.red('❌ Decryption failed'));
    res.json({
      success: false,
      error: 'Decryption failed'
    });
  }
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
      totalCommitments: channel.commitments.length,
      latestCommitment: channel.commitments[channel.commitments.length - 1]
    }
  });
});

// Initialize server
async function startServer() {
  const abi = await loadChannelContract();

  app.listen(PORT, () => {
    console.log(chalk.green.bold(`\n✓ Server running on http://localhost:${PORT}\n`));

    console.log(chalk.yellow('Available endpoints:'));
    console.log(chalk.white('  GET  /catalog           - List available content'));
    console.log(chalk.white('  POST /request-content   - Request encrypted content'));
    console.log(chalk.white('  POST /submit-commitment - Submit payment commitment'));
    console.log(chalk.white('  POST /verify-decryption - Verify decryption (optional)'));
    console.log(chalk.white('  GET  /channel/:address  - Get channel state\n'));

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
