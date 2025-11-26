import { ethers } from 'ethers';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ChannelManager {
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

  async getMyAddress() {
    await this.init();
    return await this.signer.getAddress();
  }

  async getContractABI() {
    try {
      // First try to load from centralized ABI location (created by make update-abis)
      let abiPath = path.join(__dirname, '../abis/BidirectionalChannel.json');

      // Fallback to contract build output if centralized ABI doesn't exist
      if (!await fs.access(abiPath).then(() => true).catch(() => false)) {
        abiPath = path.join(__dirname, '../../contract/out/BidirectionalChannel.sol/BidirectionalChannel.json');
      }

      const contractJson = JSON.parse(await fs.readFile(abiPath, 'utf8'));
      return contractJson.abi;
    } catch (error) {
      console.error('Warning: Could not load ABI from compiled contract, using fallback ABI');
      // Fallback ABI for essential functions
      return [
        "constructor(address _partyA, address _partyB, uint256 _fundingDeadline, uint256 _disputePeriod)",
        "function fundChannel() payable",
        "function openChannel()",
        "function submitRevocation(bytes32 commitmentHash, bytes32 revocationSecret)",
        "function initiateDispute(uint256 nonce, uint256 balanceA, uint256 balanceB, bytes signatureA, bytes signatureB)",
        "function challengeDispute(uint256 nonce, uint256 balanceA, uint256 balanceB, bytes signatureA, bytes signatureB)",
        "function proveRevocationBreach(bytes32 revocationSecret)",
        "function finalizeDispute()",
        "function cooperativeClose(uint256 balanceA, uint256 balanceB, bytes signatureA, bytes signatureB)",
        "function getChannelInfo() view returns (address, address, uint256, uint8, uint256)",
        "function deposits(address) view returns (uint256)",
        "event ChannelFunded(uint256 totalBalance)",
        "event CommitmentRevoked(bytes32 indexed commitmentHash)",
        "event DisputeInitiated(address indexed initiator, uint256 nonce, uint256 deadline)",
        "event ChannelSettled(uint256 balanceA, uint256 balanceB)",
        "event PenaltyApplied(address indexed cheater, uint256 amount)"
      ];
    }
  }

  async getContractBytecode() {
    try {
      // First try to load from centralized ABI location (created by make update-abis)
      let contractPath = path.join(__dirname, '../abis/BidirectionalChannel.json');

      // Fallback to contract build output if centralized ABI doesn't exist
      if (!await fs.access(contractPath).then(() => true).catch(() => false)) {
        contractPath = path.join(__dirname, '../../contract/out/BidirectionalChannel.sol/BidirectionalChannel.json');
      }

      const contractJson = JSON.parse(await fs.readFile(contractPath, 'utf8'));
      // Handle both formats: direct bytecode or nested under .bytecode.object
      return contractJson.bytecode?.object || contractJson.bytecode;
    } catch (error) {
      console.error('Warning: Could not load bytecode from compiled contract');
      return null;
    }
  }

  async createChannel(partnerAddress, amountETH, disputePeriod) {
    await this.init();

    const abi = await this.getContractABI();
    const bytecode = await this.getContractBytecode();

    if (!bytecode) {
      throw new Error('Contract bytecode not found. Please compile the contract first.');
    }

    const factory = new ethers.ContractFactory(abi, bytecode, this.signer);

    const fundingDeadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const disputePeriodSeconds = parseInt(disputePeriod);

    const myAddress = await this.signer.getAddress();
    const value = ethers.parseEther(amountETH);

    // Deploy the contract
    const contract = await factory.deploy(
      myAddress,
      partnerAddress,
      fundingDeadline,
      disputePeriodSeconds
    );

    await contract.waitForDeployment();
    const channelAddress = await contract.getAddress();
    const deployTxHash = contract.deploymentTransaction().hash;

    console.log(`Contract deployed at: ${channelAddress}`);

    // Fund the channel with initial deposit
    // Create fresh provider and signer to avoid nonce caching issues after deployment
    console.log(`Funding channel with ${amountETH} ETH...`);
    const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
    const freshProvider = new ethers.JsonRpcProvider(rpcUrl);
    const freshSigner = new ethers.Wallet(process.env.PRIVATE_KEY, freshProvider);
    const fundContract = new ethers.Contract(channelAddress, abi, freshSigner);
    const fundTx = await fundContract.fundChannel({ value });
    await fundTx.wait();
    console.log(`Channel funded with ${amountETH} ETH`);

    return {
      channelAddress,
      txHash: deployTxHash,
      funded: true
    };
  }

  async fundChannel(channelAddress, amountETH) {
    await this.init();
    const abi = await this.getContractABI();
    const contract = new ethers.Contract(channelAddress, abi, this.signer);

    const value = ethers.parseEther(amountETH);
    const tx = await contract.fundChannel({ value });
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash
    };
  }

  async openChannel(channelAddress) {
    await this.init();
    const abi = await this.getContractABI();
    const contract = new ethers.Contract(channelAddress, abi, this.signer);

    const tx = await contract.openChannel();
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash
    };
  }

  async submitRevocation(channelAddress, commitmentHash, revocationSecret) {
    await this.init();
    const abi = await this.getContractABI();
    const contract = new ethers.Contract(channelAddress, abi, this.signer);

    const tx = await contract.submitRevocation(commitmentHash, revocationSecret);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash
    };
  }

  async initiateDispute(channelAddress, commitment) {
    await this.init();
    const abi = await this.getContractABI();
    const contract = new ethers.Contract(channelAddress, abi, this.signer);

    const tx = await contract.initiateDispute(
      commitment.nonce,
      ethers.parseEther(commitment.balanceA.toString()),
      ethers.parseEther(commitment.balanceB.toString()),
      commitment.signatureA,
      commitment.signatureB
    );

    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      disputeDeadline: new Date(Date.now() + 86400000).toISOString() // 24 hours
    };
  }

  async cooperativeClose(channelAddress, balanceA, balanceB, signatureA, signatureB) {
    await this.init();
    const abi = await this.getContractABI();
    const contract = new ethers.Contract(channelAddress, abi, this.signer);

    const tx = await contract.cooperativeClose(
      ethers.parseEther(balanceA.toString()),
      ethers.parseEther(balanceB.toString()),
      signatureA,
      signatureB
    );

    const receipt = await tx.wait();

    return {
      txHash: receipt.hash
    };
  }

  async getChannelInfo(channelAddress) {
    await this.init();
    const abi = await this.getContractABI();
    const contract = new ethers.Contract(channelAddress, abi, this.provider);

    const info = await contract.getChannelInfo();

    const stateNames = ['FUNDING', 'OPEN', 'DISPUTED', 'CLOSED'];

    return {
      partyA: info[0],
      partyB: info[1],
      balance: ethers.formatEther(info[2]),
      state: stateNames[info[3]],
      latestNonce: info[4].toString()
    };
  }
}