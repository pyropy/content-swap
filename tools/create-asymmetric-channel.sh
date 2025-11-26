#!/bin/bash

# Create safe channel with initial commitment (refund protection)
# Alice gets Bob's signature BEFORE funding the channel
# Requires: anvil running on localhost:8545

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Anvil test accounts
ALICE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ALICE_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
BOB_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
BOB_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

RPC_URL="http://localhost:8545"
CLI="node cli/index.js"

# Data paths for Alice and Bob
ALICE_DATA="/tmp/alice-safe-channel"
BOB_DATA="/tmp/bob-safe-channel"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Safe Channel Creation with Refund Protection         ║${NC}"
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

# Step 1: Alice creates initial commitment (no funding)
echo -e "\n${BLUE}═══ Step 1: Alice Creates Initial Commitment ═══${NC}"
echo -e "${YELLOW}Alice creates channel with initial commitment (1 ETH planned)...${NC}"

# Create initial commitment and capture output
COMMITMENT_OUTPUT=$(alice create-initial-commitment -p $BOB_ADDR -a 1.0 2>&1)
echo "$COMMITMENT_OUTPUT"

# Extract the JSON commitment data
COMMITMENT_JSON=$(echo "$COMMITMENT_OUTPUT" | sed -n '/════ COMMITMENT DATA/,/════════════════/p' | sed '1d;$d')

if [ -z "$COMMITMENT_JSON" ]; then
    echo -e "${RED}Failed to extract commitment data${NC}"
    exit 1
fi

# Extract channel address
CHANNEL_ADDR=$(echo "$COMMITMENT_JSON" | grep -o '"channelAddress":"[^"]*' | cut -d'"' -f4)
echo -e "${GREEN}✓ Channel deployed at: $CHANNEL_ADDR (NOT funded yet)${NC}"

# Save commitment for Bob
echo "$COMMITMENT_JSON" > "$ALICE_DATA/commitment.json"

# Step 2: Bob signs the initial commitment
echo -e "\n${BLUE}═══ Step 2: Bob Signs Initial Commitment ═══${NC}"
echo -e "${YELLOW}Bob signing Alice's initial commitment...${NC}"
echo -e "${CYAN}This gives Alice a refund path before she funds the channel${NC}"

# Bob signs the commitment
BOB_SIGNATURE=$(bob sign-commitment -d "$COMMITMENT_JSON" 2>&1 | tail -n 1)

if [ -z "$BOB_SIGNATURE" ]; then
    echo -e "${RED}Failed to get Bob's signature${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Bob signed the commitment${NC}"
echo -e "${CYAN}Bob's response: ${BOB_SIGNATURE:0:60}...${NC}"

# Step 3: Alice finalizes and funds the channel
echo -e "\n${BLUE}═══ Step 3: Alice Finalizes and Funds Channel ═══${NC}"
echo -e "${YELLOW}Alice verifying Bob's signature...${NC}"
echo -e "${CYAN}Now it's safe to fund the channel - Alice has refund protection!${NC}"

alice finalize-and-fund -c $CHANNEL_ADDR -a 1.0 -d "$BOB_SIGNATURE" --auto-open
echo -e "${GREEN}✓ Channel funded with refund protection and opened${NC}"

# Step 4: Optional - Bob can fund the channel too
echo -e "\n${BLUE}═══ Step 4: Bob Funds Channel (Optional) ═══${NC}"
echo -e "${YELLOW}Bob can optionally add funds to the channel...${NC}"
bob fund-channel -c $CHANNEL_ADDR -a 0.01
echo -e "${GREEN}✓ Bob funded channel with 0.01 ETH${NC}"

# Step 5: Show channel status
echo -e "\n${BLUE}═══ Step 5: Channel Status ═══${NC}"
echo -e "${YELLOW}Alice's view:${NC}"
alice status -c $CHANNEL_ADDR
echo -e "\n${YELLOW}Bob's view:${NC}"
bob status -c $CHANNEL_ADDR

# Summary
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Safe Channel Created Successfully!                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo -e ""
echo -e "${GREEN}✅ Key Security Features:${NC}"
echo -e "  • Alice got Bob's signature BEFORE funding"
echo -e "  • Alice has guaranteed refund path (initial commitment)"
echo -e "  • Channel funded only after signatures exchanged"
echo -e "  • No risk of fund lockup"
echo -e ""
echo -e "Channel Address: ${YELLOW}$CHANNEL_ADDR${NC}"
echo -e "Alice Data Path: ${YELLOW}$ALICE_DATA${NC}"
echo -e "Bob Data Path:   ${YELLOW}$BOB_DATA${NC}"
echo -e ""
echo -e "Deposits:"
echo -e "  Alice (Party A): ${GREEN}1.0 ETH${NC}"
echo -e "  Bob (Party B):   ${GREEN}0.01 ETH${NC}"
echo -e "  Total:           ${GREEN}1.01 ETH${NC}"
echo -e ""
echo -e "${YELLOW}Channel is ready for off-chain payments!${NC}"