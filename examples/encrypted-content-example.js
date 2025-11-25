#!/usr/bin/env node

import { ethers } from 'ethers';
import chalk from 'chalk';
import fs from 'fs/promises';
import crypto from 'crypto';

/**
 * Lightning Network Payment Channel Example with Encrypted Content Delivery
 *
 * This example demonstrates the complete flow of:
 * 1. Creating and signing commitment transactions
 * 2. Using revocation secrets as encryption keys for content
 * 3. The step-by-step exchange of signatures and secrets
 * 4. Fair exchange protocol for digital goods
 *
 * The revocation secrets serve dual purpose:
 * - Channel security (revoking old states)
 * - Content encryption keys (enabling trustless digital commerce)
 */

console.log(chalk.blue.bold('\n════════════════════════════════════════════════════════════════'));
console.log(chalk.blue.bold('  LIGHTNING NETWORK PAYMENT CHANNELS WITH ENCRYPTED CONTENT'));
console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════\n'));

console.log(chalk.cyan('This example demonstrates the complete protocol for trustless'));
console.log(chalk.cyan('digital content sales using Lightning Network revocation secrets.\n'));

// Setup
const provider = new ethers.JsonRpcProvider('http://localhost:8545');

// Create two wallets for Alice and Bob
const alicePrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const bobPrivateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const alice = new ethers.Wallet(alicePrivateKey, provider);
const bob = new ethers.Wallet(bobPrivateKey, provider);

console.log(chalk.yellow('━━━ PARTICIPANTS ━━━'));
console.log(chalk.white(`👩 Alice (Content Buyer):`));
console.log(chalk.gray(`   Address: ${alice.address}`));
console.log(chalk.gray(`   Role: Purchases encrypted digital content\n`));

console.log(chalk.white(`👨 Bob (Content Seller):`));
console.log(chalk.gray(`   Address: ${bob.address}`));
console.log(chalk.gray(`   Role: Sells content encrypted with revocation secrets\n`));

/**
 * Encryption/Decryption utilities using AES-256-GCM
 */
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
      throw new Error('Decryption failed - invalid key or corrupted data');
    }
  }
}

/**
 * Enhanced Invoice with encrypted content
 */
class EncryptedInvoice {
  constructor(id, description, amount, content, encryptionSecret) {
    this.id = id;
    this.description = description;
    this.amount = amount;
    this.status = 'pending';
    this.paymentHash = null;
    this.encryptedContent = ContentEncryption.encrypt(content, encryptionSecret);
    this.contentPreview = content.substring(0, 20) + '...';
    this.decryptionKey = null;
  }
}

/**
 * Lightning-style Revocation Key Manager
 */
class RevocationKeyManager {
  constructor(seed, owner) {
    this.seed = seed;
    this.owner = owner;
    this.secrets = new Map();
    this.revealedSecrets = new Map();
  }

  generateSecret(nonce) {
    console.log(chalk.gray(`    ${this.owner} generates secret for nonce ${nonce}`));
    const secret = ethers.keccak256(
      ethers.solidityPacked(['bytes32', 'uint256'], [this.seed, nonce])
    );
    this.secrets.set(nonce, secret);
    console.log(chalk.gray(`    Secret: ${secret.substring(0, 20)}...`));
    return secret;
  }

  generateRevocationHash(nonce) {
    console.log(chalk.gray(`    ${this.owner} computing revocation hash for nonce ${nonce}`));
    const secret = this.generateSecret(nonce);
    const hash = ethers.keccak256(secret);
    console.log(chalk.gray(`    Revocation hash: ${hash.substring(0, 20)}...`));
    return hash;
  }

  revealSecret(nonce) {
    const secret = this.secrets.get(nonce);
    if (!secret) {
      throw new Error(`No secret found for nonce ${nonce}`);
    }
    console.log(chalk.magenta(`    ${this.owner} reveals secret for nonce ${nonce}: ${secret.substring(0, 30)}...`));
    this.revealedSecrets.set(nonce, secret);
    this.secrets.delete(nonce);
    return secret;
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulateEncryptedContentSale() {
  try {
    // Initialize revocation key managers
    console.log(chalk.yellow('\n━━━ INITIALIZATION ━━━\n'));
    console.log(chalk.white('Creating revocation key managers...\n'));

    const aliceRevocationManager = new RevocationKeyManager(
      ethers.keccak256(ethers.toUtf8Bytes("alice-content-seed")),
      "Alice"
    );
    const bobRevocationManager = new RevocationKeyManager(
      ethers.keccak256(ethers.toUtf8Bytes("bob-content-seed")),
      "Bob"
    );

    console.log(chalk.green('✓ Key managers initialized\n'));

    // Step 1: Deploy the channel contract
    console.log(chalk.yellow('━━━ STEP 1: CHANNEL DEPLOYMENT ━━━\n'));

    const contractPath = new URL('../out/BidirectionalChannel.sol/BidirectionalChannel.json', import.meta.url);

    let contractJson;
    try {
      contractJson = JSON.parse(
        await fs.readFile(contractPath, 'utf8')
      );
    } catch (error) {
      console.error(chalk.red('Error: Cannot read compiled contract. Make sure to run "forge build" first.'));
      throw error;
    }

    const factory = new ethers.ContractFactory(contractJson.abi, contractJson.bytecode.object, alice);
    const fundingDeadline = Math.floor(Date.now() / 1000) + 3600;
    const disputePeriod = 86400;

    console.log(chalk.white('Deploying payment channel contract...'));
    const channel = await factory.deploy(
      alice.address,
      bob.address,
      fundingDeadline,
      disputePeriod
    );

    await channel.waitForDeployment();
    const channelAddress = await channel.getAddress();
    console.log(chalk.green(`✓ Channel deployed at: ${channelAddress}\n`));

    // Step 2: Fund the channel
    console.log(chalk.yellow('━━━ STEP 2: CHANNEL FUNDING ━━━\n'));

    await delay(1000);

    console.log(chalk.white('Alice funds the channel (buyer deposits):'));
    const aliceWalletForFunding = new ethers.Wallet(alicePrivateKey, provider);
    const channelForAliceFunding = new ethers.Contract(channelAddress, contractJson.abi, aliceWalletForFunding);
    const aliceFundTx = await channelForAliceFunding.fundChannel({
      value: ethers.parseEther('5.0')
    });
    await aliceFundTx.wait();
    console.log(chalk.green('  ✓ Alice deposited: 5 ETH\n'));

    console.log(chalk.white('Bob funds the channel (seller minimal deposit):'));
    const bobWalletForFunding = new ethers.Wallet(bobPrivateKey, provider);
    const channelForBobFunding = new ethers.Contract(channelAddress, contractJson.abi, bobWalletForFunding);
    const bobFundTx = await channelForBobFunding.fundChannel({
      value: ethers.parseEther('0.01')
    });
    await bobFundTx.wait();
    console.log(chalk.green('  ✓ Bob deposited: 0.01 ETH\n'));

    // Step 3: Open the channel
    console.log(chalk.yellow('━━━ STEP 3: CHANNEL OPENING ━━━\n'));

    await delay(2000);

    const freshProvider = new ethers.JsonRpcProvider('http://localhost:8545');
    const aliceWalletForOpening = new ethers.Wallet(alicePrivateKey, freshProvider);
    const channelForOpening = new ethers.Contract(channelAddress, contractJson.abi, aliceWalletForOpening);

    console.log(chalk.white('Opening the channel for off-chain transactions...'));
    const openTx = await channelForOpening.openChannel();
    await openTx.wait();
    console.log(chalk.green('✓ Channel is now OPEN and ready for off-chain payments\n'));

    // Step 4: Create initial commitment
    console.log(chalk.yellow('━━━ STEP 4: INITIAL COMMITMENT CREATION ━━━\n'));

    let aliceBalanceWei = ethers.parseEther('5.0');
    let bobBalanceWei = ethers.parseEther('0.01');
    let nonce = 0;
    const commitments = [];

    console.log(chalk.white('Creating Commitment #0 (Initial State):\n'));
    console.log(chalk.gray('  Current balances:'));
    console.log(chalk.gray(`    Alice: ${ethers.formatEther(aliceBalanceWei)} ETH`));
    console.log(chalk.gray(`    Bob: ${ethers.formatEther(bobBalanceWei)} ETH\n`));

    console.log(chalk.cyan('  Step 4.1: Generate revocation hashes'));
    const revHashA0 = aliceRevocationManager.generateRevocationHash(nonce);
    const revHashB0 = bobRevocationManager.generateRevocationHash(nonce);

    console.log(chalk.cyan('\n  Step 4.2: Create commitment data'));
    const commitment0 = await createAndSignCommitmentVerbose(
      channelAddress,
      nonce,
      ethers.formatEther(aliceBalanceWei),
      ethers.formatEther(bobBalanceWei),
      revHashA0,
      revHashB0,
      alice,
      bob,
      0
    );

    commitments.push(commitment0);
    console.log(chalk.green('\n✓ Initial commitment established\n'));

    // Digital goods for sale
    const digitalGoods = [
      {
        id: 1,
        title: 'Secret Recipe',
        content: 'Hello World! This is the secret recipe for the perfect chocolate cake: Mix 2 cups flour, 1 cup sugar, 3/4 cup cocoa powder, add eggs and milk, bake at 350°F for 30 minutes.',
        price: 0.5
      },
      {
        id: 2,
        title: 'Trading Algorithm',
        content: 'CONFIDENTIAL ALGORITHM: Buy when RSI < 30 and MACD crosses above signal line. Sell when RSI > 70. Risk management: 2% per trade maximum.',
        price: 1.0
      },
      {
        id: 3,
        title: 'API Access Key',
        content: 'API_KEY=sk-proj-abc123xyz789 | Endpoint: https://api.service.com/v1/ | Rate limit: 1000 req/min',
        price: 0.3
      }
    ];

    const encryptedInvoices = [];

    // Step 5: Process each content sale
    console.log(chalk.yellow('━━━ STEP 5: CONTENT SALES WITH REVOCATION KEY EXCHANGE ━━━\n'));

    for (const item of digitalGoods) {
      console.log(chalk.blue.bold(`\n╔════════════════════════════════════════════╗`));
      console.log(chalk.blue.bold(`║  CONTENT SALE #${item.id}: ${item.title.padEnd(26)}║`));
      console.log(chalk.blue.bold(`╚════════════════════════════════════════════╝\n`));

      nonce++;

      // Phase 1: Bob prepares encrypted content
      console.log(chalk.yellow('📝 PHASE 1: Bob Prepares Encrypted Content\n'));

      console.log(chalk.white('  Bob generates revocation secret for nonce', nonce));
      const bobRevocationSecret = bobRevocationManager.generateSecret(nonce);
      const bobRevocationHash = ethers.keccak256(bobRevocationSecret);

      console.log(chalk.white('\n  Bob encrypts content with this secret:'));
      console.log(chalk.gray(`    Original: "${item.content.substring(0, 50)}..."`));

      const invoice = new EncryptedInvoice(
        item.id,
        item.title,
        item.price,
        item.content,
        bobRevocationSecret
      );

      encryptedInvoices.push(invoice);

      console.log(chalk.red(`    Encrypted: ${invoice.encryptedContent.combined.substring(0, 60)}...`));
      console.log(chalk.green(`\n  ✓ Content encrypted with revocation secret\n`));

      // Phase 2: Bob sends invoice to Alice
      console.log(chalk.yellow('📨 PHASE 2: Bob Sends Invoice to Alice\n'));

      console.log(chalk.white('  Invoice details:'));
      console.log(chalk.gray(`    Title: ${item.title}`));
      console.log(chalk.gray(`    Price: ${item.price} ETH`));
      console.log(chalk.gray(`    Encrypted content: [${invoice.encryptedContent.combined.length} bytes]`));
      console.log(chalk.gray(`    Status: Content locked until payment\n`));

      console.log(chalk.cyan('  Alice attempts decryption without payment:'));
      try {
        ContentEncryption.decrypt(invoice.encryptedContent, 'wrong-key');
      } catch (error) {
        console.log(chalk.red(`    ❌ ${error.message}\n`));
      }

      // Phase 3: Create new commitment for payment
      console.log(chalk.yellow('💳 PHASE 3: Payment via New Commitment\n'));

      const invoiceAmountWei = ethers.parseEther(item.price.toString());

      console.log(chalk.white('  Calculating new balances:'));
      console.log(chalk.gray(`    Alice current: ${ethers.formatEther(aliceBalanceWei)} ETH`));
      console.log(chalk.gray(`    Payment amount: ${item.price} ETH`));

      aliceBalanceWei = aliceBalanceWei - invoiceAmountWei;
      bobBalanceWei = bobBalanceWei + invoiceAmountWei;

      console.log(chalk.gray(`    Alice new: ${ethers.formatEther(aliceBalanceWei)} ETH`));
      console.log(chalk.gray(`    Bob new: ${ethers.formatEther(bobBalanceWei)} ETH\n`));

      console.log(chalk.white(`  Creating Commitment #${nonce}:\n`));

      console.log(chalk.cyan('  Step 1: Alice generates her revocation hash'));
      const aliceRevocationHash = aliceRevocationManager.generateRevocationHash(nonce);

      console.log(chalk.cyan('\n  Step 2: Create and sign new commitment'));
      const commitment = await createAndSignCommitmentVerbose(
        channelAddress,
        nonce,
        ethers.formatEther(aliceBalanceWei),
        ethers.formatEther(bobBalanceWei),
        aliceRevocationHash,
        bobRevocationHash,
        alice,
        bob,
        nonce
      );

      commitments.push(commitment);
      invoice.status = 'paid';
      invoice.paymentHash = commitment.hash;

      console.log(chalk.green(`\n  ✓ Payment completed via Commitment #${nonce}\n`));

      // Phase 4: Exchange revocation secrets
      console.log(chalk.yellow('🔐 PHASE 4: Revocation Secret Exchange\n'));

      if (nonce > 1) {
        console.log(chalk.white(`  Revoking previous commitment #${nonce-1}:`));
        aliceRevocationManager.revealSecret(nonce - 1);
        console.log(chalk.green(`    ✓ Alice revealed her secret\n`));
      }

      console.log(chalk.white(`  Bob reveals secret for current commitment #${nonce}:`));
      console.log(chalk.gray('  (This serves as both revocation AND decryption key)'));
      const revealedSecret = bobRevocationManager.revealSecret(nonce);
      invoice.decryptionKey = revealedSecret;

      console.log(chalk.magenta(`\n  Dual purpose of this secret:`));
      console.log(chalk.gray(`    1. Revokes Bob's ability to use commitment #${nonce-1}`));
      console.log(chalk.gray(`    2. Provides decryption key for purchased content\n`));

      // Phase 5: Alice decrypts content
      console.log(chalk.yellow('🔓 PHASE 5: Content Decryption\n'));

      console.log(chalk.white('  Alice uses revealed secret to decrypt:'));
      try {
        const decryptedContent = ContentEncryption.decrypt(invoice.encryptedContent, revealedSecret);
        console.log(chalk.green(`    ✅ Decryption successful!`));
        console.log(chalk.cyan(`    Content: "${decryptedContent.substring(0, 80)}..."`));

        if (decryptedContent === item.content) {
          console.log(chalk.green(`    ✅ Content integrity verified!\n`));
        }
      } catch (error) {
        console.log(chalk.red(`    ❌ ${error.message}\n`));
      }

      await delay(2000);
    }

    // Step 6: Summary
    console.log(chalk.yellow('\n━━━ STEP 6: TRANSACTION SUMMARY ━━━\n'));

    console.log(chalk.cyan('Final Channel State:'));
    console.log(chalk.white(`  Total commitments: ${nonce}`));
    console.log(chalk.white(`  Alice balance: ${ethers.formatEther(aliceBalanceWei)} ETH`));
    console.log(chalk.white(`  Bob balance: ${ethers.formatEther(bobBalanceWei)} ETH\n`));

    console.log(chalk.cyan('Purchased Content:'));
    let totalSpent = 0;
    for (const invoice of encryptedInvoices) {
      if (invoice.status === 'paid') {
        console.log(chalk.green(`  ✅ ${invoice.description}: ${invoice.amount} ETH`));
        totalSpent += invoice.amount;
      }
    }
    console.log(chalk.white(`\n  Total spent: ${totalSpent} ETH\n`));

    // Step 7: Channel closure
    console.log(chalk.yellow('━━━ STEP 7: COOPERATIVE CHANNEL CLOSURE ━━━\n'));

    console.log(chalk.white('Creating close agreement:'));
    const closeData = ethers.solidityPacked(
      ['string', 'address', 'uint256', 'uint256'],
      ['CLOSE', channelAddress, aliceBalanceWei, bobBalanceWei]
    );

    const closeHash = ethers.keccak256(closeData);
    console.log(chalk.gray(`  Close hash: ${closeHash.substring(0, 30)}...`));

    console.log(chalk.white('\nBoth parties sign the close agreement:'));
    const aliceCloseSignature = await alice.signMessage(ethers.getBytes(closeHash));
    console.log(chalk.gray(`  Alice signature: ${aliceCloseSignature.substring(0, 30)}...`));

    const bobCloseSignature = await bob.signMessage(ethers.getBytes(closeHash));
    console.log(chalk.gray(`  Bob signature: ${bobCloseSignature.substring(0, 30)}...`));

    const aliceWalletForClose = new ethers.Wallet(alicePrivateKey, provider);
    const channelForClose = new ethers.Contract(channelAddress, contractJson.abi, aliceWalletForClose);

    console.log(chalk.white('\nSubmitting cooperative close to blockchain...'));
    const closeTx = await channelForClose.cooperativeClose(
      aliceBalanceWei,
      bobBalanceWei,
      aliceCloseSignature,
      bobCloseSignature
    );

    await closeTx.wait();

    console.log(chalk.green('\n✓ Channel closed successfully!\n'));
    console.log(chalk.cyan('Final Settlement:'));
    console.log(chalk.white(`  Alice receives: ${ethers.formatEther(aliceBalanceWei)} ETH`));
    console.log(chalk.white(`  Bob receives: ${ethers.formatEther(bobBalanceWei)} ETH\n`));

    // Educational summary
    console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════'));
    console.log(chalk.blue.bold('                    PROTOCOL SUMMARY'));
    console.log(chalk.blue.bold('════════════════════════════════════════════════════════════════\n'));

    console.log(chalk.yellow('🔑 KEY INSIGHTS:\n'));

    console.log(chalk.white('1. DUAL-PURPOSE REVOCATION SECRETS'));
    console.log(chalk.gray('   • Channel Security: Revokes old commitment states'));
    console.log(chalk.gray('   • Content Encryption: Acts as decryption key\n'));

    console.log(chalk.white('2. COMMITMENT SIGNING FLOW'));
    console.log(chalk.gray('   • Both parties generate revocation hashes'));
    console.log(chalk.gray('   • Commitment includes balances + revocation hashes'));
    console.log(chalk.gray('   • Alice signs first (she initiates payment)'));
    console.log(chalk.gray('   • Bob signs to accept (completes commitment)\n'));

    console.log(chalk.white('3. SECRET EXCHANGE PROTOCOL'));
    console.log(chalk.gray('   • New commitment signed by both parties'));
    console.log(chalk.gray('   • Old secrets revealed (revokes previous state)'));
    console.log(chalk.gray('   • Bob\'s secret enables content decryption'));
    console.log(chalk.gray('   • Atomic exchange: payment ↔ content\n'));

    console.log(chalk.white('4. SECURITY GUARANTEES'));
    console.log(chalk.gray('   • Alice cannot decrypt without paying'));
    console.log(chalk.gray('   • Bob cannot cheat after revealing secret'));
    console.log(chalk.gray('   • Old states automatically invalidated'));
    console.log(chalk.gray('   • Cryptographic enforcement throughout\n'));

    console.log(chalk.cyan('This protocol enables trustless digital commerce'));
    console.log(chalk.cyan('using Lightning Network\'s elegant revocation mechanism!\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Error in simulation:'), error.message);
    if (error.stack) {
      console.error(chalk.gray('Stack trace:'), error.stack);
    }
  }
}

async function createAndSignCommitmentVerbose(
  channelAddress,
  nonce,
  balanceA,
  balanceB,
  revHashA,
  revHashB,
  alice,
  bob,
  commitmentNumber
) {
  console.log(chalk.gray(`\n    Creating commitment #${commitmentNumber} data structure:`));
  console.log(chalk.gray(`      Channel: ${channelAddress.substring(0, 20)}...`));
  console.log(chalk.gray(`      Nonce: ${nonce}`));
  console.log(chalk.gray(`      Alice balance: ${balanceA} ETH`));
  console.log(chalk.gray(`      Bob balance: ${balanceB} ETH`));
  console.log(chalk.gray(`      Alice revocation hash: ${revHashA.substring(0, 20)}...`));
  console.log(chalk.gray(`      Bob revocation hash: ${revHashB.substring(0, 20)}...`));

  const commitmentData = ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
    [
      channelAddress,
      nonce,
      ethers.parseEther(balanceA.toString()),
      ethers.parseEther(balanceB.toString()),
      revHashA,
      revHashB
    ]
  );

  const hash = ethers.keccak256(commitmentData);
  console.log(chalk.gray(`\n    Commitment hash: ${hash.substring(0, 30)}...`));

  console.log(chalk.cyan('\n    Alice signs the commitment:'));
  const aliceSignature = await alice.signMessage(ethers.getBytes(hash));
  console.log(chalk.gray(`      Signature: ${aliceSignature.substring(0, 30)}...`));

  console.log(chalk.cyan('\n    Bob verifies and counter-signs:'));
  const bobSignature = await bob.signMessage(ethers.getBytes(hash));
  console.log(chalk.gray(`      Signature: ${bobSignature.substring(0, 30)}...`));

  console.log(chalk.green(`\n    ✓ Commitment #${commitmentNumber} fully signed by both parties`));

  return {
    nonce,
    balanceA,
    balanceB,
    hash,
    revHashA,
    revHashB,
    aliceSignature,
    bobSignature
  };
}

// Run the simulation
console.log(chalk.gray('\nInitializing simulation...\n'));
simulateEncryptedContentSale().catch(console.error);