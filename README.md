# Bidirectional Payment Channels with Revocation Secrets

Implementation of bidirectional payment channels with revocation mechanism similar to Lightning Network channels on Ethereum, featuring a complete CLI tool for channel management and off-chain payments.

## Overview

This project implements a secure bidirectional payment channel system that allows two parties to exchange payments off-chain while maintaining the security guarantees of on-chain settlement. The system uses revocation secrets to prevent cheating by penalizing any party that tries to broadcast an old channel state.

### Core Components

1. **BidirectionalChannel.sol** - Smart contract implementing Lightning-style payment channels
3. **CLI Tool** - Complete command-line interface for channel management
4. **Example Implementation** - Demonstration of the full payment channel flow

## Key Features

- **Bidirectional Payments**: Both parties can send payments to each other
- **Revocation Mechanism**: Old states are invalidated through revocation secrets
- **Penalty System**: Cheaters lose all channel funds if they broadcast revoked states
- **Dispute Resolution**: Time-locked dispute period for challenging incorrect states
- **Cooperative Close**: Instant channel closure with mutual agreement
- **CLI Tool**: Command-line interface for managing channels and payments
- **Reentrancy Protection**: Uses OpenZeppelin's ReentrancyGuard
- **Comprehensive Testing**: Full test suite with Foundry

## Architecture

### Smart Contract (`BidirectionalChannel.sol`)

The core contract manages the channel lifecycle:

1. **Funding Phase**: Both parties deposit funds into the channel
2. **Open State**: Channel is active for off-chain payments
3. **Dispute State**: One party initiates on-chain settlement
4. **Closed State**: Channel is settled and funds distributed

Key mechanisms:
- Commitment transactions with sequential nonces
- Revocation secrets to invalidate old states
- Dispute period for challenging submissions
- Penalty for broadcasting revoked commitments

### Project Structure

```
payment-channels/
├── src/                          # Smart contracts
│   ├── BidirectionalChannel.sol    # Lightning-style payment channel
│   └── Channel.sol                 # Simple payment channel reference
├── cli/                          # Command-line interface
│   ├── index.js                    # Main CLI entry point
│   ├── lib/
│   │   ├── channel-manager.js      # On-chain channel operations
│   │   ├── payment-manager.js      # Off-chain payment creation
│   │   └── state-manager.js        # Local state persistence
│   └── data/                       # Local channel state storage
├── examples/                     # Example implementations
│   ├── encrypted-content-example.js # Lightning channel with encrypted content
│   ├── content-server.js           # HTTP server for content delivery
│   ├── content-client.js           # Interactive client for purchasing
│   └── test-content-delivery.js    # Automated test of client-server flow
├── script/                       # Deployment scripts
│   └── DeployBidirectionalChannel.s.sol
├── test/                         # Smart contract tests
│   └── BidirectionalChannel.t.sol
└── package.json                  # Node.js dependencies
```

## How It Works

### 1. Channel Creation and Funding
```bash
# Alice creates channel with Bob
channel-cli create-channel -p 0xBob... -a 5.0

# Bob funds the same channel
channel-cli fund-channel -c 0xChannel... -a 5.0

# Open the channel for payments
channel-cli open-channel -c 0xChannel...
```

### 2. Off-Chain Payments

Parties exchange signed commitments off-chain:
- Each commitment has an incrementing nonce
- Contains updated balances for both parties
- Includes revocation hash for future invalidation
- Requires signatures from both parties

```bash
# Send payment
channel-cli send-payment -c 0xChannel... -a 1.0

# Exchange revocation secret for old state
channel-cli revoke-commitment -c 0xChannel... -n 1
```

### 3. Channel Closure

#### Cooperative Close (Preferred)
Both parties agree on final balances and close immediately:
```bash
channel-cli close-channel -c 0xChannel...
```

#### Dispute Resolution
If one party is unresponsive:
1. Submit latest commitment to initiate dispute
2. Dispute period begins (default: 24 hours)
3. Other party can challenge with newer commitment
4. After dispute period, channel finalizes

### 4. Fraud Protection

If a party tries to cheat by broadcasting an old state:
1. Counterparty reveals the revocation secret
2. Proves the commitment was revoked
3. Receives entire channel balance as penalty

## Installation

### Prerequisites
- Node.js v18+
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Ethereum node (local or remote)

### Setup

1. Clone the repository:
```bash
git clone <repository>
cd payment-channels
```

2. Install Foundry dependencies:
```bash
forge install
```

3. Compile smart contracts:
```bash
forge build
```

4. Install Node.js dependencies:
```bash
npm install
```

5. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

## Usage

### Deploy a Channel

Using Foundry script:
```bash
forge script script/DeployBidirectionalChannel.s.sol --rpc-url $RPC_URL --broadcast
```

Using CLI:
```bash
node cli/index.js create-channel -p <partner_address> -a <amount_in_eth>
# or
npm run cli create-channel -p <partner_address> -a <amount_in_eth>
```

### CLI Commands

```bash
# Create a new channel
channel-cli create-channel -p 0x... -a 5.0

# Fund an existing channel
channel-cli fund-channel -c 0x... -a 5.0

# Open a funded channel
channel-cli open-channel -c 0x...

# Send an off-chain payment
channel-cli send-payment -c 0x... -a 1.0

# Generate revocation secret for old commitment
channel-cli revoke-commitment -c 0x... -n 1

# Submit revocation to blockchain
channel-cli submit-revocation -c 0x... -h 0x... -s 0x...

# Initiate dispute with a commitment
channel-cli dispute -c 0x... -n 2

# Cooperatively close channel
channel-cli close-channel -c 0x...

# View channel status
channel-cli status -c 0x...

# Interactive mode
channel-cli interactive
```

### Running Examples

1. **Encrypted Content Delivery Example**:
```bash
npm run example:encrypted
# or
node examples/encrypted-content-example.js
```

2. **Content Delivery Server**:
```bash
# Start server
npm run example:server

# In another terminal, run client
npm run example:client

# Or run automated test
npm run example:test
```

These examples demonstrate:
- Channel creation and funding by both parties
- Multiple off-chain payments in both directions
- Revocation secret exchange
- Cooperative channel closure
- Using revocation secrets as encryption keys for content delivery
- HTTP-based Lightning Network protocol for digital commerce

## Testing

Run the test suite:
```bash
forge test
```

Run with verbosity:
```bash
forge test -vvv
```

Run specific test:
```bash
forge test --match-test test_CooperativeClose
```

## Security Considerations

1. **Private Key Management**: Never expose private keys in production
2. **Revocation Secrets**: Must be securely stored and exchanged
3. **Monitoring**: Parties must monitor the blockchain for dispute initiation
4. **Time Sensitivity**: Disputes must be responded to within the dispute period
5. **Network Reliability**: Ensure reliable connection during critical operations
6. **Reentrancy Protection**: Uses OpenZeppelin's ReentrancyGuard
7. **Signature Verification**: All commitments require valid signatures from both parties

## Protocol Details

### Commitment Structure

Each commitment contains:
- Channel address
- Sequential nonce
- Balance for party A
- Balance for party B
- Signatures from both parties

### Revocation Process

1. When updating state, parties exchange new commitments
2. After confirming new state, parties exchange revocation secrets for old state
3. Revocation secret proves that a commitment has been superseded

### Dispute Resolution

1. Either party can initiate dispute with their latest commitment
2. Other party has dispute period to challenge with newer commitment
3. If revoked commitment is used, cheater loses all funds
4. After dispute period, funds are distributed per latest commitment

## Gas Costs (Approximate)

- Channel deployment: ~800,000 gas
- Fund channel: ~50,000 gas
- Open channel: ~30,000 gas
- Submit revocation: ~40,000 gas
- Initiate dispute: ~100,000 gas
- Cooperative close: ~80,000 gas

## Limitations

- Requires both parties to be online for payments
- Parties must monitor blockchain during dispute period
- No routing (direct channels only)
- No HTLC support (could be added)

## Future Improvements

- Add HTLC support for conditional payments
- Implement watchtower service for monitoring
- Add multi-hop payment routing
- Support for ERC20 tokens
- Integration with state channel networks

## License

MIT
