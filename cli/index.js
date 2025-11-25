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
    } catch (error) {
      console.error(chalk.red('Error creating payment:'), error.message);
    }
  });

// Exchange revocation secret command
program
  .command('revoke-commitment')
  .description('Generate and share revocation secret for old commitment')
  .option('-c, --channel <address>', 'Channel contract address')
  .option('-n, --nonce <nonce>', 'Commitment nonce to revoke')
  .action(async (options) => {
    try {
      const { channel, nonce } = options;

      if (!channel || !nonce) {
        console.log(chalk.red('Channel address and nonce are required'));
        return;
      }

      console.log(chalk.blue('Generating revocation secret...'));

      // Generate revocation secret for the commitment
      const revocation = await paymentManager.generateRevocationSecret(channel, nonce);

      console.log(chalk.green('Revocation secret generated!'));
      console.log(chalk.white(`Commitment Nonce: ${nonce}`));
      console.log(chalk.white(`Revocation Secret: ${revocation.secret}`));
      console.log(chalk.yellow('Share this secret with your counterparty to revoke the old state'));

      // Mark commitment as revoked locally
      await stateManager.markCommitmentRevoked(channel, nonce, revocation.secret);
    } catch (error) {
      console.error(chalk.red('Error generating revocation:'), error.message);
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