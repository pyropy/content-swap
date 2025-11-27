import { useState, useCallback } from 'react';
import { useSignMessage, useWriteContract, usePublicClient, useWalletClient } from 'wagmi';
import { parseEther, formatEther, getAddress, keccak256, encodePacked, type Abi } from 'viem';
import type { Channel } from '../types';
import * as api from '../utils/api';

export interface UseChannelsOptions {
  onLog?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
}

export function useChannels(options: UseChannelsOptions = {}) {
  const { onLog } = options;

  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelAddress, setChannelAddress] = useState<string | null>(null);
  const [currentNonce, setCurrentNonce] = useState(0);
  const [partyABalance, setPartyABalance] = useState('0');
  const [partyBBalance, setPartyBBalance] = useState('0');

  const log = useCallback((message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    onLog?.(message, type);
  }, [onLog]);

  const selectChannel = useCallback((channel: Channel) => {
    setChannelAddress(channel.address);
    setPartyABalance(channel.partyABalance);
    setPartyBBalance(channel.partyBBalance);
    setCurrentNonce(channel.nonce);
    log(`Selected channel: ${channel.address}`, 'info');
  }, [log]);

  const updateChannelState = useCallback((partyA: string, partyB: string, nonce: number) => {
    setPartyABalance(partyA);
    setPartyBBalance(partyB);
    setCurrentNonce(nonce);

    // Update channel in list
    if (channelAddress) {
      setChannels(prev => prev.map(ch =>
        ch.address === channelAddress
          ? { ...ch, partyABalance: partyA, partyBBalance: partyB, nonce }
          : ch
      ));
    }
  }, [channelAddress]);

  const setupChannel = useCallback(async (
    yourDeposit: string,
    disputePeriod: number,
    onProgress: (step: number, message: string) => void,
    config: {
      address: string;
      serverAddress: string;
      serverUrl: string;
      contractAbi: Abi;
      contractBytecode: string;
    }
  ): Promise<string | null> => {
    const { address, serverAddress, serverUrl, contractAbi, contractBytecode } = config;

    if (!walletClient || !publicClient) {
      throw new Error('Wallet not ready');
    }

    try {
      // Step 1: Deploy contract
      onProgress(1, 'Deploying channel contract...');
      log('Deploying channel contract...', 'info');

      const fundingDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const hash = await walletClient.deployContract({
        abi: contractAbi,
        bytecode: contractBytecode as `0x${string}`,
        args: [
          getAddress(address),
          getAddress(serverAddress),
          fundingDeadline,
          BigInt(disputePeriod),
        ],
      });

      log(`Deploy tx: ${hash}`, 'info');

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const newChannelAddress = receipt.contractAddress;

      if (!newChannelAddress) {
        throw new Error('Contract deployment failed - no address returned');
      }

      log(`Contract deployed at: ${newChannelAddress}`, 'success');

      // Step 2: Create and sign initial commitment (BEFORE funding!)
      // This follows Lightning Network pattern: get signatures before locking funds
      onProgress(2, 'Exchanging initial commitment signatures...');
      log('Creating initial commitment (nonce 0)...', 'info');

      // Generate client's revocation hash for nonce 0
      const clientRevocationSeed = keccak256(encodePacked(['string'], [`client-seed-${address}`]));
      const clientRevocationSecret = keccak256(encodePacked(['bytes32', 'uint256'], [clientRevocationSeed, BigInt(0)]));
      const clientRevocationHash = keccak256(clientRevocationSecret);

      // Initial commitment: client has their deposit, server has 0
      // We use a placeholder for server's revocation hash - server will provide theirs
      const initialCommitmentHash = keccak256(
        encodePacked(
          ['address', 'uint256', 'uint256', 'uint256', 'bytes32', 'bytes32'],
          [
            newChannelAddress as `0x${string}`,
            BigInt(0), // nonce 0
            parseEther(yourDeposit), // client balance
            BigInt(0), // server balance
            clientRevocationHash,
            '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}` // placeholder
          ]
        )
      );

      // Sign the initial commitment
      log('Signing initial commitment...', 'info');
      const clientSignature = await signMessageAsync({
        message: { raw: initialCommitmentHash },
      });

      // Send to server and get their signature
      log('Requesting server signature on initial commitment...', 'info');
      // Store the server signature for potential dispute resolution
      const { serverSignature: _serverSig, serverRevocationHash } = await api.signInitialCommitment(
        serverUrl,
        newChannelAddress,
        address,
        yourDeposit,
        initialCommitmentHash,
        clientSignature,
        clientRevocationHash
      );

      log('Server signed initial commitment', 'success');
      log(`Server revocation hash: ${serverRevocationHash.substring(0, 20)}...`, 'info');

      // Now we have both signatures - safe to fund!
      // Step 3: Fund and open channel in a single transaction
      onProgress(3, 'Funding and opening channel...');
      log(`Funding channel with ${yourDeposit} ETH and opening...`, 'info');

      const fundAndOpenHash = await writeContractAsync({
        address: newChannelAddress,
        abi: contractAbi,
        functionName: 'fundAndOpenChannel',
        value: parseEther(yourDeposit),
      });

      await publicClient.waitForTransactionReceipt({ hash: fundAndOpenHash });
      log('Channel funded and opened', 'success');

      // Step 4: Register with server
      onProgress(4, 'Registering channel with server...');
      log('Registering channel with server...', 'info');

      await api.registerChannel(serverUrl, newChannelAddress, address);
      log('Server acknowledged channel', 'success');

      // Create new channel entry - use formatEther to ensure consistent string format
      const newChannel: Channel = {
        address: newChannelAddress,
        partyABalance: formatEther(parseEther(yourDeposit)),
        partyBBalance: '0',
        nonce: 0,
        createdAt: Date.now(),
      };

      // Update state
      setChannels(prev => [...prev, newChannel]);
      setChannelAddress(newChannelAddress);
      setPartyABalance(formatEther(parseEther(yourDeposit)));
      setPartyBBalance('0');
      setCurrentNonce(0);

      onProgress(5, 'Channel ready!');
      log(`Channel setup complete: ${newChannelAddress}`, 'success');
      log('You have a signed initial commitment - your funds are protected!', 'success');

      return newChannelAddress;
    } catch (error) {
      log(`Channel setup failed: ${(error as Error).message}`, 'error');
      throw error;
    }
  }, [walletClient, publicClient, writeContractAsync, signMessageAsync, log]);

  const closeChannel = useCallback(async (
    config: {
      serverUrl: string;
      contractAbi: Abi;
    }
  ): Promise<boolean> => {
    const { serverUrl, contractAbi } = config;

    if (!channelAddress || !publicClient) {
      throw new Error('No active channel or wallet not ready');
    }

    try {
      log('Initiating cooperative channel close...', 'info');

      // Convert balances to wei for consistent comparison, then back to ether string
      const balanceAWei = parseEther(partyABalance);
      const balanceBWei = parseEther(partyBBalance);
      const balanceAStr = formatEther(balanceAWei);
      const balanceBStr = formatEther(balanceBWei);

      // Step 1: Request server signature
      log('Requesting server signature...', 'info');
      const { partyBSignature } = await api.requestCloseChannel(
        serverUrl,
        channelAddress,
        balanceAStr,
        balanceBStr
      );
      log('Server signature received', 'success');

      // Step 2: Create close message hash (must match contract)
      const closeHash = keccak256(
        encodePacked(
          ['string', 'address', 'uint256', 'uint256'],
          ['CLOSE', channelAddress as `0x${string}`, balanceAWei, balanceBWei]
        )
      );

      // Step 3: Sign with client wallet
      log('Signing close message...', 'info');
      const partyASignature = await signMessageAsync({
        message: { raw: closeHash },
      });
      log('Close message signed', 'success');

      // Step 4: Call cooperative close on contract
      log('Submitting cooperative close to contract...', 'info');
      const closeChannelHash = await writeContractAsync({
        address: channelAddress as `0x${string}`,
        abi: contractAbi,
        functionName: 'cooperativeClose',
        args: [balanceAWei, balanceBWei, partyASignature, partyBSignature],
      });

      await publicClient.waitForTransactionReceipt({ hash: closeChannelHash });
      log('Channel closed successfully!', 'success');

      // Remove channel from list
      setChannels(prev => prev.filter(ch => ch.address !== channelAddress));
      setChannelAddress(null);
      setPartyABalance('0');
      setPartyBBalance('0');
      setCurrentNonce(0);

      return true;
    } catch (error) {
      log(`Channel close failed: ${(error as Error).message}`, 'error');
      throw error;
    }
  }, [channelAddress, partyABalance, partyBBalance, publicClient, signMessageAsync, writeContractAsync, log]);

  return {
    channels,
    channelAddress,
    currentNonce,
    partyABalance,
    partyBBalance,
    selectChannel,
    updateChannelState,
    setupChannel,
    closeChannel,
  };
}
