#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ChannelManager } from './lib/channel-manager.js';
import { PaymentManager } from './lib/payment-manager.js';
import { StateManager } from './lib/state-manager.js';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('channel-cli')
  .description('CLI for managing bidirectional payment channels')
  .version('1.0.0');

// Initialize channel manager
const channelManager = new ChannelManager();
const paymentManager = new PaymentManager();
const stateManager = new StateManager();

// Create channel command
program
  .command('create-channel')
  .description('Create a new bidirectional payment channel')
  .option('-p, --partner <address>', 'Partner address')
  .option('-a, --amount <amount>', 'Initial deposit amount in ETH')
  .option('-d, --dispute-period <seconds>', 'Dispute period in seconds', '86400') // 24 hours default
  .action(async (options) => {
    try {
      const { partner, amount, disputePeriod } = options;

      if (!partner || !amount) {
        console.log(chalk.red('Partner address and amount are required'));
        return;
      }

      console.log(chalk.blue('Creating new payment channel...'));
      const result = await channelManager.createChannel(partner, amount, disputePeriod);

      console.log(chalk.green('Channel created successfully!'));
      console.log(chalk.white(`Channel Address: ${result.channelAddress}`));
      console.log(chalk.white(`Transaction Hash: ${result.txHash}`));
      console.log(chalk.white(`Your Deposit: ${amount} ETH`));

      // Save channel to local state
      await stateManager.saveChannel(result.channelAddress, partner);

      // Update state with initial funded amount (creator is always party A)
      await stateManager.updateChannelState(result.channelAddress, {
        nonce: 0,
        balanceA: amount,
        balanceB: '0'
      });
    } catch (error) {
      console.error(chalk.red('Error creating channel:'), error.message);
    }
  });

// Fund channel command
program
  .command('fund-channel')
  .description('Fund an existing payment channel')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-a, --amount <amount>', 'Amount to deposit in ETH')
  .action(async (options) => {
    try {
      const { channel, amount } = options;

      if (!channel || !amount) {
        console.log(chalk.red('Channel address and amount are required'));
        return;
      }

      console.log(chalk.blue('Funding channel...'));
      const result = await channelManager.fundChannel(channel, amount);

      console.log(chalk.green('Channel funded successfully!'));
      console.log(chalk.white(`Transaction Hash: ${result.txHash}`));
      console.log(chalk.white(`Deposited: ${amount} ETH`));

      // Update local state with funded balance
      // Get channel info to determine which party funded
      const channelInfo = await channelManager.getChannelInfo(channel);
      const myAddress = await channelManager.getMyAddress();

      const currentState = await stateManager.getChannelState(channel) || {
        nonce: 0,
        balanceA: '0',
        balanceB: '0'
      };

      // Update balance based on who funded
      if (myAddress.toLowerCase() === channelInfo.partyA.toLowerCase()) {
        const newBalanceA = (parseFloat(currentState.balanceA) + parseFloat(amount)).toString();
        await stateManager.updateChannelState(channel, {
          balanceA: newBalanceA,
          balanceB: currentState.balanceB
        });
        console.log(chalk.gray(`Updated Party A balance: ${newBalanceA} ETH`));
      } else if (myAddress.toLowerCase() === channelInfo.partyB.toLowerCase()) {
        const newBalanceB = (parseFloat(currentState.balanceB) + parseFloat(amount)).toString();
        await stateManager.updateChannelState(channel, {
          balanceA: currentState.balanceA,
          balanceB: newBalanceB
        });
        console.log(chalk.gray(`Updated Party B balance: ${newBalanceB} ETH`));
      }
    } catch (error) {
      console.error(chalk.red('Error funding channel:'), error.message);
    }
  });

// Open channel command
program
  .command('open-channel')
  .description('Open a funded channel for payments')
  .option('-c, --channel <address>', 'Channel contract address')
  .action(async (options) => {
    try {
      const { channel } = options;

      if (!channel) {
        console.log(chalk.red('Channel address is required'));
        return;
      }

      console.log(chalk.blue('Opening channel...'));
      const result = await channelManager.openChannel(channel);

      console.log(chalk.green('Channel opened successfully!'));
      console.log(chalk.white(`Transaction Hash: ${result.txHash}`));
    } catch (error) {
      console.error(chalk.red('Error opening channel:'), error.message);
    }
  });

// Send off-chain payment command
program
  .command('send-payment')
  .description('Send an off-chain payment through the channel')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-a, --amount <amount>', 'Payment amount in ETH')
  .action(async (options) => {
    try {
      const { channel, amount } = options;

      if (!channel || !amount) {
        console.log(chalk.red('Channel address and amount are required'));
        return;
      }

      console.log(chalk.blue('Creating off-chain payment...'));

      // Get current state
      const currentState = await stateManager.getChannelState(channel);

      // Create new commitment
      const commitment = await paymentManager.createCommitment(
        channel,
        currentState.nonce + 1,
        amount,
        currentState.balanceA,
        currentState.balanceB
      );

      console.log(chalk.green('Payment commitment created!'));
      console.log(chalk.white(`Nonce: ${commitment.nonce}`));
      console.log(chalk.white(`New Balance A: ${commitment.balanceA} ETH`));
      console.log(chalk.white(`New Balance B: ${commitment.balanceB} ETH`));
      console.log(chalk.yellow('Share this commitment with your counterparty for signing'));
      console.log(chalk.gray(`Commitment Hash: ${commitment.hash}`));

      // Save commitment locally
      await stateManager.saveCommitment(channel, commitment);

      // Output serialized commitment for sharing
      const serialized = JSON.stringify({
        channelAddress: channel,
        nonce: commitment.nonce,
        balanceA: commitment.balanceA,
        balanceB: commitment.balanceB,
        hash: commitment.hash,
        signature: commitment.signature,
        revocationHash: commitment.revocationHash
      });

      console.log(chalk.cyan('\nSerialized commitment (share with counterparty):'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(serialized);
      console.log(chalk.gray('─'.repeat(60)));
    } catch (error) {
      console.error(chalk.red('Error creating payment:'), error.message);
    }
  });

// View commitments command
program
  .command('list-commitments')
  .description('View all commitments for a channel')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-n, --nonce <nonce>', 'View specific commitment by nonce')
  .action(async (options) => {
    try {
      const { channel, nonce } = options;

      if (!channel) {
        console.log(chalk.red('Channel address is required'));
        return;
      }

      if (nonce) {
        // View specific commitment
        const commitment = await stateManager.getCommitment(channel, nonce);

        if (!commitment) {
          console.log(chalk.yellow(`No commitment found for nonce ${nonce}`));
          return;
        }

        console.log(chalk.blue.bold(`\nCommitment #${nonce}`));
        console.log(chalk.white(`  Nonce: ${commitment.nonce}`));
        console.log(chalk.white(`  Balance A: ${commitment.balanceA} ETH`));
        console.log(chalk.white(`  Balance B: ${commitment.balanceB} ETH`));
        console.log(chalk.white(`  Hash: ${commitment.hash}`));
        console.log(chalk.white(`  My Signature: ${commitment.signature ? commitment.signature.substring(0, 30) + '...' : 'Not signed'}`));
        console.log(chalk.white(`  Counterparty Signature: ${commitment.counterpartySignature ? commitment.counterpartySignature.substring(0, 30) + '...' : 'Not signed'}`));
        console.log(chalk.white(`  Revocation Hash: ${commitment.revocationHash || 'N/A'}`));
        console.log(chalk.white(`  Revoked: ${commitment.revoked ? 'Yes' : 'No'}`));
        console.log(chalk.white(`  Created: ${new Date(commitment.timestamp).toLocaleString()}`));

        // Output serialized for sharing
        console.log(chalk.cyan('\nSerialized (for sharing):'));
        console.log(JSON.stringify({
          channelAddress: channel,
          nonce: commitment.nonce,
          balanceA: commitment.balanceA,
          balanceB: commitment.balanceB,
          hash: commitment.hash,
          signature: commitment.signature,
          counterpartySignature: commitment.counterpartySignature,
          revocationHash: commitment.revocationHash
        }));
      } else {
        // View all commitments
        const commitments = await stateManager.getCommitments(channel);

        if (commitments.length === 0) {
          console.log(chalk.yellow('No commitments found for this channel'));
          return;
        }

        console.log(chalk.blue.bold(`\nCommitments for channel ${channel.substring(0, 10)}...`));
        console.log(chalk.gray('─'.repeat(60)));

        for (const c of commitments) {
          const status = c.revoked ? chalk.red('[REVOKED]') :
                        (c.counterpartySignature ? chalk.green('[COMPLETE]') : chalk.yellow('[PENDING]'));
          console.log(chalk.white(`  Nonce ${c.nonce}: A=${c.balanceA} ETH, B=${c.balanceB} ETH ${status}`));
        }

        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.gray(`Total: ${commitments.length} commitment(s)`));
      }
    } catch (error) {
      console.error(chalk.red('Error viewing commitments:'), error.message);
    }
  });

// Sign commitment from counterparty
program
  .command('sign-commitment')
  .description('Sign a commitment received from counterparty and return signed commitment')
  .option('-d, --data <json>', 'Serialized commitment JSON from counterparty')
  .action(async (options) => {
    try {
      const { data } = options;

      if (!data) {
        console.log(chalk.red('Serialized commitment data is required'));
        console.log(chalk.gray('Usage: sign-commitment -d \'{"channelAddress":"0x...","nonce":"1",...}\''));
        return;
      }

      // Parse the incoming commitment
      const incoming = JSON.parse(data);

      if (!incoming.channelAddress || !incoming.nonce || !incoming.hash) {
        console.log(chalk.red('Invalid commitment data. Required: channelAddress, nonce, hash'));
        return;
      }

      console.log(chalk.blue('Received commitment from counterparty:'));
      console.log(chalk.gray(`  Channel: ${incoming.channelAddress}`));
      console.log(chalk.gray(`  Nonce: ${incoming.nonce}`));
      console.log(chalk.gray(`  Balance A: ${incoming.balanceA} ETH`));
      console.log(chalk.gray(`  Balance B: ${incoming.balanceB} ETH`));
      console.log(chalk.gray(`  Hash: ${incoming.hash.substring(0, 30)}...`));

      // Verify the hash matches the commitment data
      const { ethers } = await import('ethers');
      const expectedHash = ethers.keccak256(
        ethers.solidityPacked(
          ['address', 'uint256', 'uint256', 'uint256'],
          [
            incoming.channelAddress,
            parseInt(incoming.nonce),
            ethers.parseEther(incoming.balanceA),
            ethers.parseEther(incoming.balanceB)
          ]
        )
      );

      if (expectedHash !== incoming.hash) {
        console.log(chalk.red('\nHash verification failed! Commitment data may be tampered.'));
        console.log(chalk.gray(`Expected: ${expectedHash}`));
        console.log(chalk.gray(`Received: ${incoming.hash}`));
        return;
      }

      console.log(chalk.green('\nHash verified successfully'));

      // Sign the commitment
      const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const privateKey = process.env.PRIVATE_KEY;

      if (!privateKey) {
        console.log(chalk.red('PRIVATE_KEY environment variable is required'));
        return;
      }

      const signer = new ethers.Wallet(privateKey, provider);
      const myAddress = await signer.getAddress();
      const mySignature = await signer.signMessage(ethers.getBytes(incoming.hash));

      console.log(chalk.green('\nCommitment signed!'));
      console.log(chalk.gray(`  Signer: ${myAddress}`));

      // Generate my revocation hash for this new commitment
      const crypto = await import('crypto');
      const myRevocationPreimage = '0x' + crypto.randomBytes(32).toString('hex');
      const myRevocationHash = ethers.keccak256(myRevocationPreimage);

      console.log(chalk.yellow('\nGenerated revocation hash for new commitment:'));
      console.log(chalk.gray(`  Hash: ${myRevocationHash.substring(0, 30)}...`));

      // Get previous commitment's revocation secret to share (if nonce > 1)
      const previousNonce = parseInt(incoming.nonce) - 1;
      let previousRevocationSecret = null;

      if (previousNonce >= 1) {
        const previousCommitment = await stateManager.getCommitment(incoming.channelAddress, previousNonce);
        if (previousCommitment && previousCommitment.revocationPreimage) {
          previousRevocationSecret = previousCommitment.revocationPreimage;
          console.log(chalk.yellow(`\nRevealing revocation secret for commitment #${previousNonce}:`));
          console.log(chalk.gray(`  Secret: ${previousRevocationSecret.substring(0, 30)}...`));
        }
      }

      // Create response with signatures and revocation data
      const signedCommitment = {
        channelAddress: incoming.channelAddress,
        nonce: incoming.nonce,
        balanceA: incoming.balanceA,
        balanceB: incoming.balanceB,
        hash: incoming.hash,
        initiatorSignature: incoming.signature,
        counterpartySignature: mySignature,
        initiatorRevocationHash: incoming.revocationHash,
        counterpartyRevocationHash: myRevocationHash,
        // Revocation secret for previous commitment (to revoke old state)
        previousRevocationSecret: previousRevocationSecret
      };

      // Save locally with revocation preimage
      await stateManager.saveCommitment(incoming.channelAddress, {
        nonce: incoming.nonce,
        balanceA: incoming.balanceA,
        balanceB: incoming.balanceB,
        hash: incoming.hash,
        signature: mySignature,
        counterpartySignature: incoming.signature,
        revocationPreimage: myRevocationPreimage,
        revocationHash: myRevocationHash,
        counterpartyRevocationHash: incoming.revocationHash,
        timestamp: Date.now()
      });

      // Mark previous commitment as revoked if we revealed the secret
      if (previousRevocationSecret && previousNonce >= 1) {
        await stateManager.markCommitmentRevoked(incoming.channelAddress, previousNonce, previousRevocationSecret);
        console.log(chalk.green(`\nCommitment #${previousNonce} marked as revoked locally`));
      }

      console.log(chalk.cyan('\nSigned commitment (send back to initiator):'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(JSON.stringify(signedCommitment));
      console.log(chalk.gray('─'.repeat(60)));
    } catch (error) {
      console.error(chalk.red('Error signing commitment:'), error.message);
    }
  });

// Finalize commitment with counterparty signature and revocation exchange
program
  .command('finalize-commitment')
  .description('Finalize commitment by adding counterparty signature and exchanging revocation secrets')
  .option('-d, --data <json>', 'Signed commitment JSON returned from counterparty')
  .action(async (options) => {
    try {
      const { data } = options;

      if (!data) {
        console.log(chalk.red('Signed commitment data is required'));
        return;
      }

      const signed = JSON.parse(data);

      if (!signed.channelAddress || !signed.nonce || !signed.counterpartySignature) {
        console.log(chalk.red('Invalid data. Required: channelAddress, nonce, counterpartySignature'));
        return;
      }

      // Verify counterparty signature
      const { ethers } = await import('ethers');
      const messageHash = ethers.hashMessage(ethers.getBytes(signed.hash));
      const recoveredAddress = ethers.recoverAddress(messageHash, signed.counterpartySignature);

      console.log(chalk.blue('Verifying counterparty signature...'));
      console.log(chalk.gray(`  Recovered signer: ${recoveredAddress}`));

      // Get existing commitment
      const existing = await stateManager.getCommitment(signed.channelAddress, signed.nonce);

      if (!existing) {
        console.log(chalk.red(`Commitment with nonce ${signed.nonce} not found locally`));
        return;
      }

      // Verify counterparty's revocation hash if provided
      if (signed.counterpartyRevocationHash) {
        console.log(chalk.blue('\nCounterparty revocation hash received:'));
        console.log(chalk.gray(`  Hash: ${signed.counterpartyRevocationHash.substring(0, 30)}...`));
      }

      // Verify and process previous revocation secret from counterparty
      const previousNonce = parseInt(signed.nonce) - 1;
      if (signed.previousRevocationSecret && previousNonce >= 1) {
        console.log(chalk.yellow(`\nReceived revocation secret for commitment #${previousNonce}:`));
        console.log(chalk.gray(`  Secret: ${signed.previousRevocationSecret.substring(0, 30)}...`));

        // Verify the secret matches the hash we have stored
        const previousCommitment = await stateManager.getCommitment(signed.channelAddress, previousNonce);
        if (previousCommitment && previousCommitment.counterpartyRevocationHash) {
          const expectedHash = ethers.keccak256(signed.previousRevocationSecret);
          if (expectedHash === previousCommitment.counterpartyRevocationHash) {
            console.log(chalk.green('  ✓ Revocation secret verified!'));
            // Mark previous commitment as revoked with counterparty's secret
            await stateManager.markCommitmentRevoked(
              signed.channelAddress,
              previousNonce,
              signed.previousRevocationSecret
            );
            console.log(chalk.green(`  Commitment #${previousNonce} marked as revoked`));
          } else {
            console.log(chalk.red('  ✗ Revocation secret verification failed!'));
            console.log(chalk.gray(`    Expected hash: ${previousCommitment.counterpartyRevocationHash}`));
            console.log(chalk.gray(`    Got hash: ${expectedHash}`));
          }
        }
      }

      // Update with counterparty signature and revocation data
      existing.counterpartySignature = signed.counterpartySignature;
      existing.counterpartySigner = recoveredAddress;
      if (signed.counterpartyRevocationHash) {
        existing.counterpartyRevocationHash = signed.counterpartyRevocationHash;
      }

      // Update in storage
      const commitments = await stateManager.getCommitments(signed.channelAddress);
      const index = commitments.findIndex(c => c.nonce === signed.nonce.toString());
      if (index >= 0) {
        commitments[index] = existing;
        const allCommitments = await stateManager.loadJSON(stateManager.commitmentsFile);
        allCommitments[signed.channelAddress] = commitments;
        await stateManager.saveJSON(stateManager.commitmentsFile, allCommitments);
      }

      // Now reveal our own previous revocation secret
      let myPreviousSecret = null;
      if (previousNonce >= 1) {
        const myPreviousCommitment = await stateManager.getCommitment(signed.channelAddress, previousNonce);
        if (myPreviousCommitment && myPreviousCommitment.revocationPreimage) {
          myPreviousSecret = myPreviousCommitment.revocationPreimage;
          console.log(chalk.yellow(`\nRevealing my revocation secret for commitment #${previousNonce}:`));
          console.log(chalk.gray(`  Secret: ${myPreviousSecret.substring(0, 30)}...`));
          // Mark our own previous commitment as revoked
          await stateManager.markCommitmentRevoked(signed.channelAddress, previousNonce, myPreviousSecret);
        }
      }

      console.log(chalk.green('\nCommitment finalized with both signatures!'));
      console.log(chalk.white(`  Channel: ${signed.channelAddress}`));
      console.log(chalk.white(`  Nonce: ${signed.nonce}`));
      console.log(chalk.white(`  Balance A: ${existing.balanceA} ETH`));
      console.log(chalk.white(`  Balance B: ${existing.balanceB} ETH`));
      console.log(chalk.white(`  Counterparty: ${recoveredAddress}`));

      // Output response with my revocation secret for counterparty
      if (myPreviousSecret) {
        const response = {
          channelAddress: signed.channelAddress,
          nonce: signed.nonce,
          status: 'finalized',
          previousRevocationSecret: myPreviousSecret
        };
        console.log(chalk.cyan('\nRevocation response (send to counterparty to complete exchange):'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(JSON.stringify(response));
        console.log(chalk.gray('─'.repeat(60)));
      }

      console.log(chalk.green('\nThis commitment can now be used in disputes if needed.'));
    } catch (error) {
      console.error(chalk.red('Error finalizing commitment:'), error.message);
    }
  });

// Receive revocation response from counterparty
program
  .command('receive-revocation')
  .description('Process revocation response from counterparty to complete the exchange')
  .option('-d, --data <json>', 'Revocation response JSON from counterparty')
  .action(async (options) => {
    try {
      const { data } = options;

      if (!data) {
        console.log(chalk.red('Revocation response data is required'));
        return;
      }

      const response = JSON.parse(data);

      if (!response.channelAddress || !response.previousRevocationSecret) {
        console.log(chalk.red('Invalid data. Required: channelAddress, previousRevocationSecret'));
        return;
      }

      const { ethers } = await import('ethers');

      // Find which commitment this revokes (nonce - 1)
      const currentNonce = parseInt(response.nonce);
      const revokedNonce = currentNonce - 1;

      if (revokedNonce < 1) {
        console.log(chalk.yellow('No previous commitment to revoke'));
        return;
      }

      console.log(chalk.blue(`Processing revocation for commitment #${revokedNonce}...`));

      // Verify the secret matches the hash we have stored
      const revokedCommitment = await stateManager.getCommitment(response.channelAddress, revokedNonce);
      if (revokedCommitment && revokedCommitment.counterpartyRevocationHash) {
        const computedHash = ethers.keccak256(response.previousRevocationSecret);
        if (computedHash === revokedCommitment.counterpartyRevocationHash) {
          console.log(chalk.green('✓ Revocation secret verified!'));

          // Mark commitment as revoked
          await stateManager.markCommitmentRevoked(
            response.channelAddress,
            revokedNonce,
            response.previousRevocationSecret
          );

          console.log(chalk.green(`\nCommitment #${revokedNonce} successfully revoked!`));
          console.log(chalk.gray(`  Secret: ${response.previousRevocationSecret.substring(0, 30)}...`));
          console.log(chalk.gray(`  Hash: ${computedHash.substring(0, 30)}...`));
        } else {
          console.log(chalk.red('✗ Revocation secret verification failed!'));
          console.log(chalk.gray(`  Expected hash: ${revokedCommitment.counterpartyRevocationHash}`));
          console.log(chalk.gray(`  Got hash: ${computedHash}`));
        }
      } else {
        console.log(chalk.yellow(`Commitment #${revokedNonce} not found or no revocation hash stored`));
      }
    } catch (error) {
      console.error(chalk.red('Error processing revocation:'), error.message);
    }
  });

// Exchange revocation secret command (manual)
program
  .command('revoke-commitment')
  .description('Manually reveal revocation secret for a commitment')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-n, --nonce <nonce>', 'Commitment nonce to revoke')
  .action(async (options) => {
    try {
      const { channel, nonce } = options;

      if (!channel || !nonce) {
        console.log(chalk.red('Channel address and nonce are required'));
        return;
      }

      // Get commitment and reveal its revocation preimage
      const commitment = await stateManager.getCommitment(channel, nonce);

      if (!commitment) {
        console.log(chalk.red(`Commitment with nonce ${nonce} not found`));
        return;
      }

      if (!commitment.revocationPreimage) {
        console.log(chalk.red('No revocation preimage stored for this commitment'));
        return;
      }

      console.log(chalk.green('Revealing revocation secret!'));
      console.log(chalk.white(`Commitment Nonce: ${nonce}`));
      console.log(chalk.white(`Revocation Secret: ${commitment.revocationPreimage}`));
      console.log(chalk.white(`Revocation Hash: ${commitment.revocationHash}`));
      console.log(chalk.yellow('\nShare this secret with your counterparty to revoke the old state'));

      // Mark commitment as revoked locally
      await stateManager.markCommitmentRevoked(channel, nonce, commitment.revocationPreimage);

      // Output for sharing
      const revocationData = {
        channelAddress: channel,
        nonce: nonce,
        revocationSecret: commitment.revocationPreimage,
        revocationHash: commitment.revocationHash
      };
      console.log(chalk.cyan('\nRevocation data (share with counterparty):'));
      console.log(chalk.gray('─'.repeat(60)));
      console.log(JSON.stringify(revocationData));
      console.log(chalk.gray('─'.repeat(60)));
    } catch (error) {
      console.error(chalk.red('Error revealing revocation:'), error.message);
    }
  });

// Submit revocation to chain command
program
  .command('submit-revocation')
  .description('Submit a revocation secret to the blockchain')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-h, --hash <hash>', 'Commitment hash')
  .option('-s, --secret <secret>', 'Revocation secret')
  .action(async (options) => {
    try {
      const { channel, hash, secret } = options;

      if (!channel || !hash || !secret) {
        console.log(chalk.red('Channel address, commitment hash, and secret are required'));
        return;
      }

      console.log(chalk.blue('Submitting revocation to blockchain...'));
      const result = await channelManager.submitRevocation(channel, hash, secret);

      console.log(chalk.green('Revocation submitted successfully!'));
      console.log(chalk.white(`Transaction Hash: ${result.txHash}`));
    } catch (error) {
      console.error(chalk.red('Error submitting revocation:'), error.message);
    }
  });

// Initiate dispute command
program
  .command('dispute')
  .description('Initiate a dispute with a commitment')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-n, --nonce <nonce>', 'Commitment nonce')
  .action(async (options) => {
    try {
      const { channel, nonce } = options;

      if (!channel || !nonce) {
        console.log(chalk.red('Channel address and nonce are required'));
        return;
      }

      console.log(chalk.blue('Initiating dispute...'));

      // Get commitment from local state
      const commitment = await stateManager.getCommitment(channel, nonce);

      if (!commitment) {
        console.log(chalk.red('Commitment not found in local state'));
        return;
      }

      const result = await channelManager.initiateDispute(channel, commitment);

      console.log(chalk.green('Dispute initiated!'));
      console.log(chalk.white(`Transaction Hash: ${result.txHash}`));
      console.log(chalk.yellow(`Dispute period ends at: ${result.disputeDeadline}`));
    } catch (error) {
      console.error(chalk.red('Error initiating dispute:'), error.message);
    }
  });

// Cooperative close command
program
  .command('close-channel')
  .description('Cooperatively close a channel')
  .option('-c, --channel <address>', 'Channel contract address')
  .action(async (options) => {
    try {
      const { channel } = options;

      if (!channel) {
        console.log(chalk.red('Channel address is required'));
        return;
      }

      // Get latest state
      const currentState = await stateManager.getChannelState(channel);

      const answers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Close channel with final balances - A: ${currentState.balanceA} ETH, B: ${currentState.balanceB} ETH?`
        }
      ]);

      if (!answers.confirm) {
        console.log(chalk.yellow('Channel close cancelled'));
        return;
      }

      console.log(chalk.blue('Closing channel cooperatively...'));

      const closeData = await paymentManager.createCloseMessage(
        channel,
        currentState.balanceA,
        currentState.balanceB
      );

      console.log(chalk.yellow('Share this close message with your counterparty for signing:'));
      console.log(chalk.gray(JSON.stringify(closeData, null, 2)));

      // If both signatures are available, submit to chain
      const bothSigned = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'hasBothSignatures',
          message: 'Do you have both signatures?'
        }
      ]);

      if (bothSigned.hasBothSignatures) {
        const signatures = await inquirer.prompt([
          {
            type: 'input',
            name: 'signatureA',
            message: 'Enter signature from party A:'
          },
          {
            type: 'input',
            name: 'signatureB',
            message: 'Enter signature from party B:'
          }
        ]);

        const result = await channelManager.cooperativeClose(
          channel,
          currentState.balanceA,
          currentState.balanceB,
          signatures.signatureA,
          signatures.signatureB
        );

        console.log(chalk.green('Channel closed successfully!'));
        console.log(chalk.white(`Transaction Hash: ${result.txHash}`));
      }
    } catch (error) {
      console.error(chalk.red('Error closing channel:'), error.message);
    }
  });

// View channel status command
program
  .command('status')
  .description('View channel status and balances')
  .option('-c, --channel <address>', 'Channel contract address')
  .action(async (options) => {
    try {
      const { channel } = options;

      if (!channel) {
        // Show all channels
        const channels = await stateManager.getAllChannels();

        if (channels.length === 0) {
          console.log(chalk.yellow('No channels found'));
          return;
        }

        console.log(chalk.blue('Your Channels:'));
        for (const ch of channels) {
          console.log(chalk.white(`- ${ch.address} (Partner: ${ch.partner})`));
        }
      } else {
        // Show specific channel
        const info = await channelManager.getChannelInfo(channel);
        const localState = await stateManager.getChannelState(channel);

        console.log(chalk.blue('Channel Information:'));
        console.log(chalk.white(`Address: ${channel}`));
        console.log(chalk.white(`Party A: ${info.partyA}`));
        console.log(chalk.white(`Party B: ${info.partyB}`));
        console.log(chalk.white(`Total Balance: ${info.balance} ETH`));
        console.log(chalk.white(`State: ${info.state}`));
        console.log(chalk.white(`Latest Nonce: ${info.latestNonce}`));

        if (localState) {
          console.log(chalk.blue('\nLocal State:'));
          console.log(chalk.white(`Balance A: ${localState.balanceA} ETH`));
          console.log(chalk.white(`Balance B: ${localState.balanceB} ETH`));
          console.log(chalk.white(`Local Nonce: ${localState.nonce}`));
          console.log(chalk.white(`Commitments: ${localState.commitments?.length || 0}`));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error getting status:'), error.message);
    }
  });

// Interactive mode
program
  .command('interactive')
  .description('Start interactive payment channel session')
  .action(async () => {
    console.log(chalk.blue.bold('\nWelcome to Payment Channel CLI - Interactive Mode\n'));

    let running = true;
    while (running) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            'Create new channel',
            'Fund existing channel',
            'Open channel',
            'Send off-chain payment',
            'Exchange revocation secret',
            'View channel status',
            'Close channel',
            'Exit'
          ]
        }
      ]);

      switch(action) {
        case 'Create new channel':
          const createAnswers = await inquirer.prompt([
            {
              type: 'input',
              name: 'partner',
              message: 'Enter partner address:'
            },
            {
              type: 'input',
              name: 'amount',
              message: 'Enter initial deposit (ETH):'
            }
          ]);
          await program.parse(['', '', 'create-channel', '-p', createAnswers.partner, '-a', createAnswers.amount]);
          break;

        case 'Exit':
          running = false;
          console.log(chalk.blue('Goodbye!'));
          break;

        default:
          console.log(chalk.yellow('Feature coming soon!'));
      }
    }
  });

program.parse(process.argv);