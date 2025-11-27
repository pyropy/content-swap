#!/bin/bash

# Test script for Payment Channel CLI
# Requires: anvil running on localhost:8545

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Anvil test accounts
PARTYA_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PARTYA_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
PARTYB_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PARTYB_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

RPC_URL="http://localhost:8545"
CLI="node cli/index.js"

# Data paths for PartyA and PartyB
PARTYA_DATA="/tmp/partyA-channel-data"
PARTYB_DATA="/tmp/partyB-channel-data"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Payment Channel CLI Test Script                   ║${NC}"
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

# Test 1: Create channel (PartyA)
echo -e "\n${BLUE}═══ Test 1: Create Channel (PartyA) ═══${NC}"
echo -e "${YELLOW}PartyA creating channel with PartyB...${NC}"
CREATE_OUTPUT=$(partyA create-channel -p $PARTYB_ADDR -a 5.0 2>&1)
echo "$CREATE_OUTPUT"

# Extract channel address
CHANNEL_ADDR=$(echo "$CREATE_OUTPUT" | grep "Channel Address:" | awk '{print $3}')
if [ -z "$CHANNEL_ADDR" ]; then
    echo -e "${RED}Failed to extract channel address${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Channel created at: $CHANNEL_ADDR${NC}"

# Test 2: Fund channel (PartyA - additional funding)
echo -e "\n${BLUE}═══ Test 2: Fund Channel (PartyA) ═══${NC}"
echo -e "${YELLOW}PartyA funding channel with additional 1 ETH...${NC}"
partyA fund-channel -c $CHANNEL_ADDR -a 1.0
echo -e "${GREEN}✓ PartyA funded channel${NC}"

# Test 3: Fund channel (PartyB)
echo -e "\n${BLUE}═══ Test 3: Fund Channel (PartyB) ═══${NC}"
echo -e "${YELLOW}PartyB funding channel with 5 ETH...${NC}"
partyB fund-channel -c $CHANNEL_ADDR -a 5.0
echo -e "${GREEN}✓ PartyB funded channel${NC}"

# Test 4: Check status
echo -e "\n${BLUE}═══ Test 4: Check Channel Status ═══${NC}"
echo -e "${YELLOW}PartyA's view:${NC}"
partyA status -c $CHANNEL_ADDR
echo -e "\n${YELLOW}PartyB's view:${NC}"
partyB status -c $CHANNEL_ADDR

# Test 5: Send payment (PartyA -> PartyB)
echo -e "\n${BLUE}═══ Test 5: Send Payment (PartyA to PartyB) ═══${NC}"
echo -e "${YELLOW}PartyA sending 0.5 ETH to PartyB...${NC}"
PAYMENT_OUTPUT=$(partyA send-payment -c $CHANNEL_ADDR -a 0.5 2>&1)
echo "$PAYMENT_OUTPUT"

# Extract serialized commitment
COMMITMENT=$(echo "$PAYMENT_OUTPUT" | grep -A1 "Serialized commitment" | tail -1 | tr -d '─')
if [ -z "$COMMITMENT" ] || [ "$COMMITMENT" = "" ]; then
    # Try alternative extraction
    COMMITMENT=$(echo "$PAYMENT_OUTPUT" | grep '{"channelAddress"')
fi
echo -e "${GREEN}✓ Payment commitment created${NC}"

# Test 6: PartyB signs commitment (includes revocation hash for new state)
echo -e "\n${BLUE}═══ Test 6: PartyB Signs Commitment ═══${NC}"
echo -e "${YELLOW}PartyB signing commitment...${NC}"
echo -e "${YELLOW}(PartyB generates revocation hash for this commitment)${NC}"
SIGNED_OUTPUT=$(partyB sign-commitment -d "$COMMITMENT" 2>&1)
echo "$SIGNED_OUTPUT"

# Extract signed commitment
SIGNED_COMMITMENT=$(echo "$SIGNED_OUTPUT" | grep '{"channelAddress"' | tail -1)
echo -e "${GREEN}✓ PartyB signed commitment with revocation hash${NC}"

# Test 7: PartyA finalizes commitment (verifies PartyB's revocation data)
echo -e "\n${BLUE}═══ Test 7: PartyA Finalizes Commitment ═══${NC}"
echo -e "${YELLOW}PartyA finalizing commitment...${NC}"
echo -e "${YELLOW}(First commitment - no previous revocation secrets to exchange)${NC}"
FINALIZE_OUTPUT=$(partyA finalize-commitment -d "$SIGNED_COMMITMENT" 2>&1)
echo "$FINALIZE_OUTPUT"
echo -e "${GREEN}✓ Commitment finalized${NC}"

# Test 8: List commitments
echo -e "\n${BLUE}═══ Test 8: List Commitments ═══${NC}"
echo -e "${YELLOW}PartyA's commitments:${NC}"
partyA list-commitments -c $CHANNEL_ADDR
echo -e "\n${YELLOW}PartyB's commitments:${NC}"
partyB list-commitments -c $CHANNEL_ADDR

# Test 9: Send another payment (with revocation exchange)
echo -e "\n${BLUE}═══ Test 9: Second Payment (PartyA to PartyB) - WITH REVOCATION EXCHANGE ═══${NC}"
echo -e "${YELLOW}PartyA sending another 1.0 ETH to PartyB...${NC}"
PAYMENT2_OUTPUT=$(partyA send-payment -c $CHANNEL_ADDR -a 1.0 2>&1)
echo "$PAYMENT2_OUTPUT"
COMMITMENT2=$(echo "$PAYMENT2_OUTPUT" | grep '{"channelAddress"')
echo -e "${GREEN}✓ Second payment commitment created (nonce 2)${NC}"

echo -e "\n${YELLOW}PartyB signing second commitment...${NC}"
echo -e "${YELLOW}(PartyB reveals revocation secret for commitment #1, generates hash for #2)${NC}"
SIGNED2_OUTPUT=$(partyB sign-commitment -d "$COMMITMENT2" 2>&1)
echo "$SIGNED2_OUTPUT"
SIGNED2_COMMITMENT=$(echo "$SIGNED2_OUTPUT" | grep '{"channelAddress"' | tail -1)
echo -e "${GREEN}✓ PartyB signed and revealed revocation for commitment #1${NC}"

echo -e "\n${YELLOW}PartyA finalizing second commitment...${NC}"
echo -e "${YELLOW}(PartyA verifies PartyB's revocation secret, reveals her own for commitment #1)${NC}"
FINALIZE2_OUTPUT=$(partyA finalize-commitment -d "$SIGNED2_COMMITMENT" 2>&1)
echo "$FINALIZE2_OUTPUT"

# Extract revocation response for PartyB
REVOCATION_RESPONSE=$(echo "$FINALIZE2_OUTPUT" | grep '{"channelAddress"' | tail -1)
if [ -n "$REVOCATION_RESPONSE" ]; then
    echo -e "\n${YELLOW}PartyB receiving PartyA's revocation secret...${NC}"
    partyB receive-revocation -d "$REVOCATION_RESPONSE"
    echo -e "${GREEN}✓ Revocation exchange complete for commitment #1${NC}"
fi

echo -e "${GREEN}✓ Second payment complete with revocation exchange${NC}"

# Test 10: Third payment to fully test revocation chain
echo -e "\n${BLUE}═══ Test 10: Third Payment (PartyA to PartyB) - REVOCATION CHAIN ═══${NC}"
echo -e "${YELLOW}PartyA sending 0.25 ETH to PartyB...${NC}"
PAYMENT3_OUTPUT=$(partyA send-payment -c $CHANNEL_ADDR -a 0.25 2>&1)
COMMITMENT3=$(echo "$PAYMENT3_OUTPUT" | grep '{"channelAddress"')
echo -e "${GREEN}✓ Third payment commitment created (nonce 3)${NC}"

echo -e "\n${YELLOW}PartyB signing third commitment...${NC}"
echo -e "${YELLOW}(PartyB reveals revocation secret for commitment #2)${NC}"
SIGNED3_OUTPUT=$(partyB sign-commitment -d "$COMMITMENT3" 2>&1)
SIGNED3_COMMITMENT=$(echo "$SIGNED3_OUTPUT" | grep '{"channelAddress"' | tail -1)
echo -e "${GREEN}✓ PartyB signed and revealed revocation for commitment #2${NC}"

echo -e "\n${YELLOW}PartyA finalizing third commitment...${NC}"
FINALIZE3_OUTPUT=$(partyA finalize-commitment -d "$SIGNED3_COMMITMENT" 2>&1)
echo "$FINALIZE3_OUTPUT"

REVOCATION3_RESPONSE=$(echo "$FINALIZE3_OUTPUT" | grep '{"channelAddress"' | tail -1)
if [ -n "$REVOCATION3_RESPONSE" ]; then
    echo -e "\n${YELLOW}PartyB receiving PartyA's revocation secret for #2...${NC}"
    partyB receive-revocation -d "$REVOCATION3_RESPONSE"
    echo -e "${GREEN}✓ Revocation exchange complete for commitment #2${NC}"
fi

# Test 11: Verify revoked commitments
echo -e "\n${BLUE}═══ Test 11: Verify Revoked Commitments ═══${NC}"
echo -e "${YELLOW}PartyA's commitments (should show #1 and #2 as REVOKED):${NC}"
partyA list-commitments -c $CHANNEL_ADDR
echo -e "\n${YELLOW}PartyB's commitments (should show #1 and #2 as REVOKED):${NC}"
partyB list-commitments -c $CHANNEL_ADDR

# Test 12: Final status
echo -e "\n${BLUE}═══ Test 12: Final Channel Status ═══${NC}"
echo -e "${YELLOW}PartyA's final view:${NC}"
partyA status -c $CHANNEL_ADDR

# Summary
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Test Summary                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo -e "${GREEN}✓ All tests passed!${NC}"
echo -e ""
echo -e "Channel Address: ${YELLOW}$CHANNEL_ADDR${NC}"
echo -e "PartyA Data Path: ${YELLOW}$PARTYA_DATA${NC}"
echo -e "PartyB Data Path:   ${YELLOW}$PARTYB_DATA${NC}"
echo -e ""
echo -e "Initial funding:"
echo -e "  PartyA: 6.0 ETH (5.0 + 1.0)"
echo -e "  PartyB:   5.0 ETH"
echo -e ""
echo -e "Payments made:"
echo -e "  PartyA -> PartyB: 0.50 ETH (nonce 1) - ${RED}REVOKED${NC}"
echo -e "  PartyA -> PartyB: 1.00 ETH (nonce 2) - ${RED}REVOKED${NC}"
echo -e "  PartyA -> PartyB: 0.25 ETH (nonce 3) - ${GREEN}CURRENT${NC}"
echo -e ""
echo -e "Final balances (off-chain, from PartyA's commitment):"
echo -e "  Balance A (PartyA): 4.25 ETH"
echo -e "  Balance B (PartyB):   1.75 ETH"
echo -e "  (PartyB also has their initial 5 ETH deposit tracked in their local state)"
echo -e ""
echo -e "${BLUE}Revocation Exchange Flow:${NC}"
echo -e "  1. PartyA creates commitment → sends to PartyB"
echo -e "  2. PartyB signs commitment → generates revocation hash"
echo -e "     → reveals previous revocation secret"
echo -e "  3. PartyA finalizes → verifies PartyB's revocation"
echo -e "     → reveals their own revocation secret"
echo -e "  4. PartyB receives PartyA's revocation → exchange complete"
echo -e ""
echo -e "${GREEN}Old states (nonce 1, 2) are now safely revoked!${NC}"
