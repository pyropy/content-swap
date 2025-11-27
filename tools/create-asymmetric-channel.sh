#!/bin/bash

# Create safe channel with initial commitment (refund protection)
# PartyA gets PartyB's signature BEFORE funding the channel
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
PARTYA_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PARTYA_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
PARTYB_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PARTYB_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

RPC_URL="http://localhost:8545"
CLI="node cli/index.js"

# Data paths for PartyA and PartyB
PARTYA_DATA="/tmp/partyA-safe-channel"
PARTYB_DATA="/tmp/partyB-safe-channel"

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
rm -rf "$PARTYA_DATA" "$PARTYB_DATA"
mkdir -p "$PARTYA_DATA" "$PARTYB_DATA"
echo -e "${GREEN}✓ Data directories created${NC}"

# Helper functions
partyA() {
    PRIVATE_KEY=$PARTYA_KEY RPC_URL=$RPC_URL DATA_PATH=$PARTYA_DATA $CLI "$@"
}

partyB() {
    PRIVATE_KEY=$PARTYB_KEY RPC_URL=$RPC_URL DATA_PATH=$PARTYB_DATA $CLI "$@"
}

# Step 1: PartyA creates initial commitment (no funding)
echo -e "\n${BLUE}═══ Step 1: PartyA Creates Initial Commitment ═══${NC}"
echo -e "${YELLOW}PartyA creates channel with initial commitment (1 ETH planned)...${NC}"

# Create initial commitment and capture output
COMMITMENT_OUTPUT=$(partyA create-initial-commitment -p $PARTYB_ADDR -a 1.0 2>&1)
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

# Save commitment for PartyB
echo "$COMMITMENT_JSON" > "$PARTYA_DATA/commitment.json"

# Step 2: PartyB signs the initial commitment
echo -e "\n${BLUE}═══ Step 2: PartyB Signs Initial Commitment ═══${NC}"
echo -e "${YELLOW}PartyB signing PartyA's initial commitment...${NC}"
echo -e "${CYAN}This gives PartyA a refund path before she funds the channel${NC}"

# PartyB signs the commitment
PARTYB_SIGNATURE=$(partyB sign-commitment -d "$COMMITMENT_JSON" 2>&1 | tail -n 1)

if [ -z "$PARTYB_SIGNATURE" ]; then
    echo -e "${RED}Failed to get PartyB's signature${NC}"
    exit 1
fi

echo -e "${GREEN}✓ PartyB signed the commitment${NC}"
echo -e "${CYAN}PartyB's response: ${PARTYB_SIGNATURE:0:60}...${NC}"

# Step 3: PartyA finalizes and funds the channel
echo -e "\n${BLUE}═══ Step 3: PartyA Finalizes and Funds Channel ═══${NC}"
echo -e "${YELLOW}PartyA verifying PartyB's signature...${NC}"
echo -e "${CYAN}Now it's safe to fund the channel - PartyA has refund protection!${NC}"

partyA finalize-and-fund -c $CHANNEL_ADDR -a 1.0 -d "$PARTYB_SIGNATURE" --auto-open
echo -e "${GREEN}✓ Channel funded with refund protection and opened${NC}"

# Step 4: Optional - PartyB can fund the channel too
echo -e "\n${BLUE}═══ Step 4: PartyB Funds Channel (Optional) ═══${NC}"
echo -e "${YELLOW}PartyB can optionally add funds to the channel...${NC}"
partyB fund-channel -c $CHANNEL_ADDR -a 0.01
echo -e "${GREEN}✓ PartyB funded channel with 0.01 ETH${NC}"

# Step 5: Show channel status
echo -e "\n${BLUE}═══ Step 5: Channel Status ═══${NC}"
echo -e "${YELLOW}PartyA's view:${NC}"
partyA status -c $CHANNEL_ADDR
echo -e "\n${YELLOW}PartyB's view:${NC}"
partyB status -c $CHANNEL_ADDR

# Summary
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Safe Channel Created Successfully!                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo -e ""
echo -e "${GREEN}✅ Key Security Features:${NC}"
echo -e "  • PartyA got PartyB's signature BEFORE funding"
echo -e "  • PartyA has guaranteed refund path (initial commitment)"
echo -e "  • Channel funded only after signatures exchanged"
echo -e "  • No risk of fund lockup"
echo -e ""
echo -e "Channel Address: ${YELLOW}$CHANNEL_ADDR${NC}"
echo -e "PartyA Data Path: ${YELLOW}$PARTYA_DATA${NC}"
echo -e "PartyB Data Path:   ${YELLOW}$PARTYB_DATA${NC}"
echo -e ""
echo -e "Deposits:"
echo -e "  PartyA: ${GREEN}1.0 ETH${NC}"
echo -e "  PartyB: ${GREEN}0.01 ETH${NC}"
echo -e "  Total:  ${GREEN}1.01 ETH${NC}"
echo -e ""
echo -e "${YELLOW}Channel is ready for off-chain payments!${NC}"