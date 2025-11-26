#!/bin/bash

# Create asymmetric channel: Party A deposits 1 ETH, Party B deposits 0.001 ETH
# Requires: anvil running on localhost:8545

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Anvil test accounts
ALICE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ALICE_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
BOB_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
BOB_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

RPC_URL="http://localhost:8545"
CLI="node cli/index.js"

# Data paths for Alice and Bob
ALICE_DATA="/tmp/alice-asymmetric-channel"
BOB_DATA="/tmp/bob-asymmetric-channel"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Create Asymmetric Channel (1 ETH / 0.001 ETH)         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

# Check if anvil is running
echo -e "\n${YELLOW}Checking if Anvil is running...${NC}"
if ! curl -s -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
    $RPC_URL > /dev/null 2>&1; then
    echo -e "${RED}Error: Anvil is not running on $RPC_URL${NC}"
    echo -e "${YELLOW}Start anvil with: anvil --chain-id 31337${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Anvil is running${NC}"

# Clean up old data
echo -e "\n${YELLOW}Cleaning up old test data...${NC}"
rm -rf "$ALICE_DATA" "$BOB_DATA"
mkdir -p "$ALICE_DATA" "$BOB_DATA"
echo -e "${GREEN}✓ Data directories created${NC}"

# Helper functions
alice() {
    PRIVATE_KEY=$ALICE_KEY RPC_URL=$RPC_URL DATA_PATH=$ALICE_DATA $CLI "$@"
}

bob() {
    PRIVATE_KEY=$BOB_KEY RPC_URL=$RPC_URL DATA_PATH=$BOB_DATA $CLI "$@"
}

# Step 1: Alice creates channel with 1 ETH
echo -e "\n${BLUE}═══ Step 1: Alice Creates Channel ═══${NC}"
echo -e "${YELLOW}Alice creating channel with Bob (depositing 1 ETH)...${NC}"
CREATE_OUTPUT=$(alice create-channel -p $BOB_ADDR -a 1.0 2>&1)
echo "$CREATE_OUTPUT"

# Extract channel address
CHANNEL_ADDR=$(echo "$CREATE_OUTPUT" | grep "Channel Address:" | awk '{print $3}')
if [ -z "$CHANNEL_ADDR" ]; then
    echo -e "${RED}Failed to extract channel address${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Channel created at: $CHANNEL_ADDR${NC}"

# Step 2: Bob funds channel with 0.001 ETH
echo -e "\n${BLUE}═══ Step 2: Bob Funds Channel ═══${NC}"
echo -e "${YELLOW}Bob funding channel with 0.001 ETH...${NC}"
bob fund-channel -c $CHANNEL_ADDR -a 0.001
echo -e "${GREEN}✓ Bob funded channel${NC}"

# Step 3: Open the channel
echo -e "\n${BLUE}═══ Step 3: Open Channel ═══${NC}"
echo -e "${YELLOW}Alice opening channel...${NC}"
alice open-channel -c $CHANNEL_ADDR
echo -e "${GREEN}✓ Channel opened${NC}"

# Step 4: Show channel status
echo -e "\n${BLUE}═══ Step 4: Channel Status ═══${NC}"
echo -e "${YELLOW}Alice's view:${NC}"
alice status -c $CHANNEL_ADDR
echo -e "\n${YELLOW}Bob's view:${NC}"
bob status -c $CHANNEL_ADDR

# Summary
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Channel Created                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo -e ""
echo -e "Channel Address: ${YELLOW}$CHANNEL_ADDR${NC}"
echo -e "Alice Data Path: ${YELLOW}$ALICE_DATA${NC}"
echo -e "Bob Data Path:   ${YELLOW}$BOB_DATA${NC}"
echo -e ""
echo -e "Deposits:"
echo -e "  Alice (Party A): ${GREEN}1.0 ETH${NC}"
echo -e "  Bob (Party B):   ${GREEN}0.001 ETH${NC}"
echo -e "  Total:           ${GREEN}1.001 ETH${NC}"
echo -e ""
echo -e "${YELLOW}Channel is ready for off-chain payments!${NC}"
