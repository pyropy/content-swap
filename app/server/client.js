#!/usr/bin/env node

import axios from 'axios';
import { ethers } from 'ethers';
import chalk from 'chalk';
import crypto from 'crypto';
import fs from 'fs/promises';
import readline from 'readline';

/**
 * Lightning Network Payment Channel Content Client
 *
 * This client demonstrates how to purchase digital content from a server
 * using Lightning Network payment channels.
 */

const SERVER_URL = 'http://localhost:3000';

// Client's wallet (Alice - content buyer)
const alicePrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const provider = new ethers.JsonRpcProvider('http://localhost:8545');
const alice = new ethers.Wallet(alicePrivateKey, provider);

console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════════'));
console.log(chalk.blue.bold('     LIGHTNING NETWORK CONTENT DELIVERY CLIENT'));
console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════\n'));

console.log(chalk.yellow('Client Configuration:'));
console.log(chalk.white(`  Operator: Alice (Content Buyer)`));
console.log(chalk.gray(`  Address: ${alice.address}`));
console.log(chalk.gray(`  Server: ${SERVER_URL}\n`));

// Content Decryption
class ContentDecryption {
  static decrypt(encryptedData, revocationSecret) {
    try {
      const parts = encryptedData.split(':');
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
      throw new Error('Decryption failed - invalid key');
    }
  }
}

// Revocation Key Manager for Alice
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

// Initialize Alice's revocation key manager
const aliceRevocationManager = new RevocationKeyManager(
  ethers.keccak256(ethers.toUtf8Bytes("alice-client-seed"))
);

// Channel state management
let channelAddress = null;
let channelContract = null;
let currentNonce = 0;
let aliceBalance = '5'; // Store as ETH string
let bobBalance = '0.01'; // Store as ETH string
const purchasedContent = [];

// Setup readline for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

// Initialize or load channel
async function setupChannel() {
  try {
    // Check for existing channel or deploy new one
    channelAddress = process.env.CHANNEL_ADDRESS;

    if (!channelAddress) {
      console.log(chalk.yellow('\n⚠ No channel address provided.'));
      console.log(chalk.yellow('Please deploy a channel first and set CHANNEL_ADDRESS env variable.'));
      console.log(chalk.yellow('For demo, using mock address...\n'));

      // For demo purposes, we'll use a mock address
      channelAddress = '0x' + '1'.repeat(40);
    }

    console.log(chalk.green(`✓ Using channel: ${channelAddress}\n`));

    // Load contract ABI
    const contractPath = new URL('../../contract/out/BidirectionalChannel.sol/BidirectionalChannel.json', import.meta.url);
    const contractJson = JSON.parse(await fs.readFile(contractPath, 'utf8'));

    if (channelAddress && channelAddress !== '0x' + '1'.repeat(40)) {
      channelContract = new ethers.Contract(channelAddress, contractJson.abi, alice);
    }

    return true;
  } catch (error) {
    console.error(chalk.red('Failed to setup channel:'), error.message);
    return false;
  }
}

// Fetch and display catalog
async function fetchCatalog() {
  try {
    console.log(chalk.cyan('\n📚 Fetching content catalog...\n'));

    const response = await axios.get(`${SERVER_URL}/catalog`);
    const { catalog } = response.data;

    console.log(chalk.yellow('Available Content:'));
    console.log(chalk.gray('─'.repeat(60)));

    catalog.forEach((item, index) => {
      console.log(chalk.white(`\n${index + 1}. ${chalk.bold(item.title)}`));
      console.log(chalk.gray(`   ${item.description}`));
      console.log(chalk.green(`   Price: ${item.price} ETH`));
      console.log(chalk.gray(`   ID: ${item.id}`));
    });

    console.log(chalk.gray('\n' + '─'.repeat(60)));

    return catalog;
  } catch (error) {
    console.error(chalk.red('Failed to fetch catalog:'), error.message);
    return [];
  }
}

// Purchase content
async function purchaseContent(contentId) {
  try {
    console.log(chalk.blue.bold(`\n╔════════════════════════════════════════════╗`));
    console.log(chalk.blue.bold(`║        PURCHASING CONTENT: ${contentId.padEnd(15)}║`));
    console.log(chalk.blue.bold(`╚════════════════════════════════════════════╝\n`));

    // Step 1: Request content from server
    console.log(chalk.yellow('📦 STEP 1: Requesting content from server...\n'));

    const requestResponse = await axios.post(`${SERVER_URL}/request-content`, {
      contentId,
      channelAddress,
      currentNonce,
      aliceAddress: alice.address,
      currentAliceBalance: aliceBalance,
      currentBobBalance: bobBalance
    });

    const { invoice } = requestResponse.data;

    console.log(chalk.cyan('Invoice received with commitment:'));
    console.log(chalk.gray(`  Invoice ID: ${invoice.id.substring(0, 20)}...`));
    console.log(chalk.gray(`  Title: ${invoice.title}`));
    console.log(chalk.gray(`  Price: ${invoice.price} ETH`));
    console.log(chalk.gray(`  Nonce: ${invoice.nonce}`));
    console.log(chalk.gray(`  Bob's revocation hash: ${invoice.bobRevocationHash.substring(0, 20)}...`));
    console.log(chalk.gray(`  Encrypted content size: ${invoice.encryptedContent.length} bytes`));
    console.log(chalk.gray(`  Preview: "${invoice.contentPreview}"`));
    console.log(chalk.cyan('\n📝 Server-created commitment:'));
    console.log(chalk.gray(`  New Alice balance: ${invoice.commitment.aliceBalance} ETH`));
    console.log(chalk.gray(`  New Bob balance: ${invoice.commitment.bobBalance} ETH`));

    // Step 2: Try to decrypt without payment (will fail)
    console.log(chalk.yellow('\n🔒 STEP 2: Attempting decryption without payment...\n'));

    try {
      ContentDecryption.decrypt(invoice.encryptedContent, 'wrong-key');
      console.log(chalk.green('Decrypted content (this should not happen!)'));
    } catch (error) {
      console.log(chalk.red(`❌ ${error.message} - Content is locked!\n`));
    }

    // Step 3: Sign the server-provided commitment
    console.log(chalk.yellow('💳 STEP 3: Signing server-provided commitment...\n'));

    // Use the commitment from the invoice
    const commitment = invoice.commitment;

    console.log(chalk.cyan('Verifying commitment from server:'));
    console.log(chalk.gray(`  Channel: ${commitment.channelAddress}`));
    console.log(chalk.gray(`  Nonce: ${commitment.nonce}`));
    console.log(chalk.gray(`  New Alice balance: ${commitment.aliceBalance} ETH`));
    console.log(chalk.gray(`  New Bob balance: ${commitment.bobBalance} ETH`));
    console.log(chalk.gray(`  Bob's revocation hash: ${commitment.bobRevocationHash.substring(0, 20)}...`));

    // Generate Alice's revocation hash for this nonce
    const aliceRevocationHash = aliceRevocationManager.generateRevocationHash(invoice.nonce);
    console.log(chalk.gray(`\n  Alice's revocation hash: ${aliceRevocationHash.substring(0, 20)}...`));

    // Sign the server-provided commitment
    const commitmentData = ethers.solidityPacked(
      ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
      [
        commitment.channelAddress,
        commitment.nonce,
        ethers.parseEther(commitment.aliceBalance),
        ethers.parseEther(commitment.bobBalance),
        aliceRevocationHash,
        commitment.bobRevocationHash
      ]
    );

    const commitmentHash = ethers.keccak256(commitmentData);
    console.log(chalk.gray(`  Commitment hash: ${commitmentHash.substring(0, 20)}...`));

    const aliceSignature = await alice.signMessage(ethers.getBytes(commitmentHash));
    console.log(chalk.gray(`  Alice's signature: ${aliceSignature.substring(0, 20)}...`));

    // Step 4: Submit signed commitment to server
    console.log(chalk.yellow('\n📤 STEP 4: Submitting signed commitment to server...\n'));

    const paymentResponse = await axios.post(`${SERVER_URL}/submit-commitment`, {
      invoiceId: invoice.id,
      commitment,
      aliceSignature,
      aliceRevocationHash
    });

    const { bobSignature, revocationSecret } = paymentResponse.data;

    console.log(chalk.green('✓ Payment accepted!'));
    console.log(chalk.gray(`  Bob's signature: ${bobSignature.substring(0, 20)}...`));
    console.log(chalk.magenta(`  Revocation secret received: ${revocationSecret.substring(0, 30)}...`));

    // Step 5: Decrypt content with revocation secret
    console.log(chalk.yellow('\n🔓 STEP 5: Decrypting content with revocation secret...\n'));

    try {
      const decryptedContent = ContentDecryption.decrypt(invoice.encryptedContent, revocationSecret);

      console.log(chalk.green('✅ DECRYPTION SUCCESSFUL!\n'));
      console.log(chalk.cyan('Decrypted Content:'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(chalk.white(decryptedContent));
      console.log(chalk.gray('─'.repeat(60)));

      // Update local state with the commitment balances (use formatEther for consistent format)
      aliceBalance = ethers.formatEther(ethers.parseEther(commitment.aliceBalance));
      bobBalance = ethers.formatEther(ethers.parseEther(commitment.bobBalance));
      currentNonce = invoice.nonce;

      // Store purchased content
      purchasedContent.push({
        contentId: invoice.contentId,
        title: invoice.title,
        content: decryptedContent,
        price: invoice.price,
        nonce: invoice.nonce,
        timestamp: Date.now()
      });

      console.log(chalk.green(`\n✓ Content successfully purchased and decrypted!`));
      console.log(chalk.cyan(`Updated channel state:`));
      console.log(chalk.gray(`  Nonce: ${currentNonce}`));
      console.log(chalk.gray(`  Alice balance: ${parseFloat(aliceBalance).toFixed(4)} ETH`));
      console.log(chalk.gray(`  Bob balance: ${parseFloat(bobBalance).toFixed(4)} ETH`));

      // Step 6: Reveal Alice's old revocation secret (if applicable)
      if (currentNonce > 1) {
        console.log(chalk.yellow('\n🔐 STEP 6: Revealing old revocation secret...\n'));
        const oldSecret = aliceRevocationManager.revealSecret(currentNonce - 1);
        console.log(chalk.gray(`  Alice reveals secret for nonce ${currentNonce - 1}: ${oldSecret.substring(0, 30)}...`));
        console.log(chalk.gray(`  This revokes the previous commitment\n`));
      }

      return true;

    } catch (error) {
      console.error(chalk.red(`\n❌ Decryption failed: ${error.message}`));
      return false;
    }

  } catch (error) {
    console.error(chalk.red(`\nPurchase failed: ${error.message}`));
    return false;
  }
}

// Show purchased content
function showPurchasedContent() {
  if (purchasedContent.length === 0) {
    console.log(chalk.yellow('\nNo content purchased yet.\n'));
    return;
  }

  console.log(chalk.cyan('\n📚 Your Purchased Content:\n'));
  console.log(chalk.gray('─'.repeat(60)));

  purchasedContent.forEach((item, index) => {
    console.log(chalk.white(`\n${index + 1}. ${chalk.bold(item.title)}`));
    console.log(chalk.gray(`   Price paid: ${item.price} ETH`));
    console.log(chalk.gray(`   Nonce: ${item.nonce}`));
    console.log(chalk.gray(`   Content: "${item.content.substring(0, 50)}..."`));
  });

  console.log(chalk.gray('\n' + '─'.repeat(60)));
}

// Main interactive menu
async function mainMenu() {
  console.log(chalk.yellow('\n━━━ MAIN MENU ━━━'));
  console.log(chalk.white('1. Browse catalog'));
  console.log(chalk.white('2. Purchase content'));
  console.log(chalk.white('3. View purchased content'));
  console.log(chalk.white('4. Show channel state'));
  console.log(chalk.white('5. Exit'));
  console.log();

  const choice = await question(chalk.cyan('Select option (1-5): '));

  switch (choice.trim()) {
    case '1':
      await fetchCatalog();
      break;

    case '2':
      const catalog = await fetchCatalog();
      if (catalog.length > 0) {
        const contentChoice = await question(chalk.cyan('\nEnter content number to purchase (or 0 to cancel): '));
        const index = parseInt(contentChoice) - 1;

        if (index >= 0 && index < catalog.length) {
          await purchaseContent(catalog[index].id);
        } else if (contentChoice !== '0') {
          console.log(chalk.red('Invalid selection'));
        }
      }
      break;

    case '3':
      showPurchasedContent();
      break;

    case '4':
      console.log(chalk.cyan('\n📊 Channel State:\n'));
      console.log(chalk.gray(`  Channel: ${channelAddress}`));
      console.log(chalk.gray(`  Current nonce: ${currentNonce}`));
      console.log(chalk.gray(`  Alice balance: ${parseFloat(aliceBalance).toFixed(4)} ETH`));
      console.log(chalk.gray(`  Bob balance: ${parseFloat(bobBalance).toFixed(4)} ETH`));
      console.log(chalk.gray(`  Total purchased: ${purchasedContent.length} items\n`));
      break;

    case '5':
      console.log(chalk.yellow('\nGoodbye!\n'));
      rl.close();
      process.exit(0);

    default:
      console.log(chalk.red('Invalid option'));
  }

  // Continue menu loop
  await mainMenu();
}

// Main entry point
async function main() {
  console.log(chalk.cyan('Initializing client...\n'));

  const ready = await setupChannel();
  if (!ready) {
    console.error(chalk.red('Failed to initialize. Exiting.'));
    process.exit(1);
  }

  console.log(chalk.green('✓ Client ready!\n'));
  console.log(chalk.yellow('Make sure the server is running on', SERVER_URL));

  await mainMenu();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\nShutting down client...'));
  rl.close();
  process.exit(0);
});

// Start the client
main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
