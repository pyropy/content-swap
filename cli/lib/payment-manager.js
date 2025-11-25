import { ethers } from 'ethers';
import crypto from 'crypto';

export class PaymentManager {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    // Initialize provider and signer
    const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // Use private key from env or create a random wallet for demo
    const privateKey = process.env.PRIVATE_KEY || ethers.Wallet.createRandom().privateKey;
    this.signer = new ethers.Wallet(privateKey, this.provider);

    this.initialized = true;
  }

  /**
   * Create a new commitment for an off-chain payment
   */
  async createCommitment(channelAddress, nonce, paymentAmount, currentBalanceA, currentBalanceB) {
    await this.init();
    const signerAddress = await this.signer.getAddress();

    // Calculate new balances after payment
    // Assume signer is party A for this example
    const newBalanceA = parseFloat(currentBalanceA) - parseFloat(paymentAmount);
    const newBalanceB = parseFloat(currentBalanceB) + parseFloat(paymentAmount);

    if (newBalanceA < 0) {
      throw new Error(`Insufficient balance for payment. Current balance A: ${currentBalanceA}, Payment amount: ${paymentAmount}`);
    }

    // Create commitment hash
    const commitmentData = ethers.solidityPacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [
        channelAddress,
        nonce,
        ethers.parseEther(newBalanceA.toString()),
        ethers.parseEther(newBalanceB.toString())
      ]
    );

    const commitmentHash = ethers.keccak256(commitmentData);

    // Sign the commitment
    const signature = await this.signer.signMessage(ethers.getBytes(commitmentHash));

    // Generate revocation hash for this commitment (will be revealed when revoking)
    const revocationPreimage = crypto.randomBytes(32);
    const revocationHash = ethers.keccak256(revocationPreimage);

    return {
      nonce: nonce.toString(),
      balanceA: newBalanceA.toString(),
      balanceB: newBalanceB.toString(),
      hash: commitmentHash,
      signature,
      revocationPreimage: '0x' + revocationPreimage.toString('hex'),
      revocationHash,
      timestamp: Date.now()
    };
  }

  /**
   * Generate a revocation secret for an old commitment
   */
  async generateRevocationSecret(channelAddress, nonce) {
    await this.init();
    // In a real implementation, this would retrieve the stored preimage
    // For demo purposes, we generate a deterministic secret based on channel and nonce
    const secretData = ethers.solidityPacked(
      ['address', 'uint256', 'bytes32'],
      [
        channelAddress,
        nonce,
        ethers.keccak256(ethers.toUtf8Bytes('revocation'))
      ]
    );

    const secret = ethers.keccak256(secretData);

    return {
      secret,
      nonce: nonce.toString()
    };
  }

  /**
   * Create a cooperative close message
   */
  async createCloseMessage(channelAddress, balanceA, balanceB) {
    await this.init();
    const closeData = ethers.solidityPacked(
      ['string', 'address', 'uint256', 'uint256'],
      [
        'CLOSE',
        channelAddress,
        ethers.parseEther(balanceA.toString()),
        ethers.parseEther(balanceB.toString())
      ]
    );

    const closeHash = ethers.keccak256(closeData);

    // Sign the close message
    const signature = await this.signer.signMessage(ethers.getBytes(closeHash));

    return {
      hash: closeHash,
      balanceA: balanceA.toString(),
      balanceB: balanceB.toString(),
      signature,
      signerAddress: await this.signer.getAddress()
    };
  }

  /**
   * Verify a commitment signature
   */
  async verifyCommitment(channelAddress, nonce, balanceA, balanceB, signature, expectedSigner) {
    const commitmentData = ethers.solidityPacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [
        channelAddress,
        nonce,
        ethers.parseEther(balanceA.toString()),
        ethers.parseEther(balanceB.toString())
      ]
    );

    const commitmentHash = ethers.keccak256(commitmentData);
    const messageHash = ethers.hashMessage(ethers.getBytes(commitmentHash));

    const recoveredAddress = ethers.recoverAddress(messageHash, signature);

    return recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();
  }

  /**
   * Create a signed commitment transaction for dispute
   */
  async createDisputeCommitment(channelAddress, nonce, balanceA, balanceB) {
    const commitmentData = ethers.solidityPacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [
        channelAddress,
        nonce,
        ethers.parseEther(balanceA.toString()),
        ethers.parseEther(balanceB.toString())
      ]
    );

    const commitmentHash = ethers.keccak256(commitmentData);

    // Sign the commitment
    const signature = await this.signer.signMessage(ethers.getBytes(commitmentHash));

    return {
      nonce,
      balanceA,
      balanceB,
      hash: commitmentHash,
      signature
    };
  }
}