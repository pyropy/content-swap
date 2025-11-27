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

// Server's wallet (PartyB - content seller)
const partyBPrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const partyB = new ethers.Wallet(partyBPrivateKey, provider);

console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════════'));
console.log(chalk.blue.bold('     PAYMENT CHANNEL CONTENT DELIVERY SERVER'));
console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════\n'));

console.log(chalk.yellow('Server Configuration:'));
console.log(chalk.white(`  Operator: PartyB (Content Seller)`));
console.log(chalk.gray(`  Address: ${partyB.address}`));
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

// Initialize PartyB's revocation key manager
const partyBRevocationManager = new RevocationKeyManager(
  ethers.keccak256(ethers.toUtf8Bytes("partyB-server-seed"))
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
      channelContract = new ethers.Contract(channelAddress, contractJson.abi, partyB);
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
  const { contentId, channelAddress: clientChannelAddress, partyAAddress } = req.body;

  console.log(chalk.cyan(`\n📦 Content request received:`));
  console.log(chalk.gray(`  Content ID: ${contentId}`));
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

  // Validate content exists
  const content = contentCatalog[contentId];
  if (!content) {
    return res.status(404).json({
      success: false,
      error: 'Content not found'
    });
  }

  // Check if client has sufficient funds
  const clientBalance = parseFloat(currentPartyABalance);
  const price = parseFloat(content.price);
  if (clientBalance < price) {
    console.log(chalk.red(`\n❌ Insufficient funds:`));
    console.log(chalk.gray(`  Client balance: ${clientBalance} ETH`));
    console.log(chalk.gray(`  Required: ${price} ETH`));
    return res.status(400).json({
      success: false,
      error: 'Insufficient funds',
      required: content.price,
      available: currentPartyABalance
    });
  }

  // Generate new nonce for this payment
  const newNonce = currentNonce + 1;

  // Calculate new balances after payment
  const newPartyABalance = (parseFloat(currentPartyABalance) - parseFloat(content.price)).toString();
  const newPartyBBalance = (parseFloat(currentPartyBBalance) + parseFloat(content.price)).toString();

  console.log(chalk.cyan('\n💰 Balance calculation:'));
  console.log(chalk.gray(`  Payment amount: ${content.price} ETH`));
  console.log(chalk.gray(`  New PartyA balance: ${newPartyABalance} ETH`));
  console.log(chalk.gray(`  New PartyB balance: ${newPartyBBalance} ETH`));

  // Generate PartyB's revocation secret for this nonce
  const partyBRevocationSecret = partyBRevocationManager.generateSecret(newNonce);
  const partyBRevocationHash = ethers.keccak256(partyBRevocationSecret);

  console.log(chalk.yellow('\n🔐 Generated revocation secret:'));
  console.log(chalk.gray(`  Nonce: ${newNonce}`));
  console.log(chalk.gray(`  Secret: ${partyBRevocationSecret.substring(0, 30)}...`));
  console.log(chalk.gray(`  Hash: ${partyBRevocationHash.substring(0, 30)}...`));

  // Encrypt content with the revocation secret
  const encryptedContent = ContentEncryption.encrypt(content.content, partyBRevocationSecret);

  console.log(chalk.yellow('\n🔒 Encrypted content:'));
  console.log(chalk.gray(`  Size: ${encryptedContent.combined.length} bytes`));

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
      [clientChannelAddress, newNonce, contentId]
    )
  );

  // Store pending invoice with commitment details
  pendingInvoices.set(invoiceId, {
    contentId,
    channelAddress: clientChannelAddress,
    nonce: newNonce,
    price: content.price,
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
      contentId: content.id,
      title: content.title,
      price: content.price,
      nonce: newNonce,
      partyBRevocationHash,
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
    partyASignature,
    partyARevocationHash
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
  const partyBSignature = await partyB.signMessage(ethers.getBytes(commitmentHash));
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

  // Reveal PartyB's revocation secret (which is the decryption key!)
  const revocationSecret = invoice.partyBRevocationSecret;

  console.log(chalk.magenta('\n🔓 Revealing revocation secret (decryption key):'));
  console.log(chalk.gray(`  Secret: ${revocationSecret.substring(0, 40)}...`));

  // Mark invoice as paid
  pendingInvoices.delete(invoiceId);

  res.json({
    success: true,
    partyBSignature,
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
    address: partyB.address,
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

    // Verify server is partyB
    if (partyB.toLowerCase() !== partyB.address.toLowerCase()) {
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

    // Verify channel is in FUNDING state
    if (stateIndex !== 0) {
      throw new Error('Channel is not in FUNDING state');
    }

    // Verify server is partyB
    if (partyB.toLowerCase() !== partyB.address.toLowerCase()) {
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
    const serverSignature = await partyB.signMessage(ethers.getBytes(commitmentHash));

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
    const partyBSignature = await partyB.signMessage(ethers.getBytes(closeHash));

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

// Initialize server
async function startServer() {
  const abi = await loadChannelContract();

  app.listen(PORT, () => {
    console.log(chalk.green.bold(`\n✓ Server running on http://localhost:${PORT}\n`));

    console.log(chalk.yellow('Available endpoints:'));
    console.log(chalk.white('  GET  /catalog                  - List available content'));
    console.log(chalk.white('  POST /request-content          - Request encrypted content'));
    console.log(chalk.white('  POST /submit-commitment        - Submit payment commitment'));
    console.log(chalk.white('  POST /verify-decryption        - Verify decryption (optional)'));
    console.log(chalk.white('  GET  /channel/:address         - Get channel state'));
    console.log(chalk.white('  GET  /contract                 - Get contract ABI/bytecode'));
    console.log(chalk.white('  GET  /server-info              - Get server address'));
    console.log(chalk.white('  POST /sign-initial-commitment  - Sign initial commitment (before funding)'));
    console.log(chalk.white('  POST /register-channel         - Register client-created channel'));
    console.log(chalk.white('  POST /close-channel            - Request cooperative close'));
    console.log(chalk.white('  GET  /channel-status/:addr     - On-chain channel status\n'));

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
