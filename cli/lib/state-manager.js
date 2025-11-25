import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class StateManager {
  constructor() {
    this.dataDir = path.join(__dirname, '../data');
    this.channelsFile = path.join(this.dataDir, 'channels.json');
    this.statesFile = path.join(this.dataDir, 'states.json');
    this.commitmentsFile = path.join(this.dataDir, 'commitments.json');
    this.init();
  }

  async init() {
    // Create data directory if it doesn't exist
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Initialize files if they don't exist
    await this.initializeFile(this.channelsFile, []);
    await this.initializeFile(this.statesFile, {});
    await this.initializeFile(this.commitmentsFile, {});
  }

  async initializeFile(filePath, defaultContent) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2));
    }
  }

  /**
   * Save a new channel
   */
  async saveChannel(channelAddress, partnerAddress) {
    const channels = await this.loadJSON(this.channelsFile);

    const channel = {
      address: channelAddress,
      partner: partnerAddress,
      createdAt: Date.now(),
      status: 'FUNDING'
    };

    // Check if channel already exists
    const existingIndex = channels.findIndex(c => c.address === channelAddress);
    if (existingIndex >= 0) {
      channels[existingIndex] = channel;
    } else {
      channels.push(channel);
    }

    await this.saveJSON(this.channelsFile, channels);

    // Initialize state for the channel
    const states = await this.loadJSON(this.statesFile);
    states[channelAddress] = {
      nonce: 0,
      balanceA: '0',
      balanceB: '0',
      commitments: []
    };
    await this.saveJSON(this.statesFile, states);
  }

  /**
   * Get all channels
   */
  async getAllChannels() {
    return await this.loadJSON(this.channelsFile);
  }

  /**
   * Get channel state
   */
  async getChannelState(channelAddress) {
    const states = await this.loadJSON(this.statesFile);
    return states[channelAddress] || null;
  }

  /**
   * Update channel state
   */
  async updateChannelState(channelAddress, newState) {
    const states = await this.loadJSON(this.statesFile);
    states[channelAddress] = {
      ...states[channelAddress],
      ...newState
    };
    await this.saveJSON(this.statesFile, states);
  }

  /**
   * Save a commitment
   */
  async saveCommitment(channelAddress, commitment) {
    const commitments = await this.loadJSON(this.commitmentsFile);

    if (!commitments[channelAddress]) {
      commitments[channelAddress] = [];
    }

    commitments[channelAddress].push(commitment);
    await this.saveJSON(this.commitmentsFile, commitments);

    // Update channel state with latest balances
    await this.updateChannelState(channelAddress, {
      nonce: parseInt(commitment.nonce),
      balanceA: commitment.balanceA,
      balanceB: commitment.balanceB
    });
  }

  /**
   * Get a specific commitment
   */
  async getCommitment(channelAddress, nonce) {
    const commitments = await this.loadJSON(this.commitmentsFile);
    const channelCommitments = commitments[channelAddress] || [];

    return channelCommitments.find(c => c.nonce === nonce.toString());
  }

  /**
   * Get all commitments for a channel
   */
  async getCommitments(channelAddress) {
    const commitments = await this.loadJSON(this.commitmentsFile);
    return commitments[channelAddress] || [];
  }

  /**
   * Mark a commitment as revoked
   */
  async markCommitmentRevoked(channelAddress, nonce, revocationSecret) {
    const commitments = await this.loadJSON(this.commitmentsFile);
    const channelCommitments = commitments[channelAddress] || [];

    const commitment = channelCommitments.find(c => c.nonce === nonce.toString());
    if (commitment) {
      commitment.revoked = true;
      commitment.revocationSecret = revocationSecret;
      commitment.revokedAt = Date.now();
    }

    commitments[channelAddress] = channelCommitments;
    await this.saveJSON(this.commitmentsFile, commitments);
  }

  /**
   * Get revoked commitments for a channel
   */
  async getRevokedCommitments(channelAddress) {
    const commitments = await this.loadJSON(this.commitmentsFile);
    const channelCommitments = commitments[channelAddress] || [];

    return channelCommitments.filter(c => c.revoked);
  }

  /**
   * Load JSON from file
   */
  async loadJSON(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error loading ${filePath}:`, error);
      return filePath.endsWith('.json') && filePath.includes('channels') ? [] : {};
    }
  }

  /**
   * Save JSON to file
   */
  async saveJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll() {
    await this.saveJSON(this.channelsFile, []);
    await this.saveJSON(this.statesFile, {});
    await this.saveJSON(this.commitmentsFile, {});
  }
}