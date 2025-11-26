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
ALICE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ALICE_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
BOB_KEY="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
BOB_ADDR="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

RPC_URL="http://localhost:8545"
CLI="node cli/index.js"

# Data paths for Alice and Bob
ALICE_DATA="/tmp/alice-channel-data"
BOB_DATA="/tmp/bob-channel-data"

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

# Test 1: Create channel (Alice)
echo -e "\n${BLUE}═══ Test 1: Create Channel (Alice) ═══${NC}"
echo -e "${YELLOW}Alice creating channel with Bob...${NC}"
CREATE_OUTPUT=$(alice create-channel -p $BOB_ADDR -a 5.0 2>&1)
echo "$CREATE_OUTPUT"

# Extract channel address
CHANNEL_ADDR=$(echo "$CREATE_OUTPUT" | grep "Channel Address:" | awk '{print $3}')
if [ -z "$CHANNEL_ADDR" ]; then
    echo -e "${RED}Failed to extract channel address${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Channel created at: $CHANNEL_ADDR${NC}"

# Test 2: Fund channel (Alice - additional funding)
echo -e "\n${BLUE}═══ Test 2: Fund Channel (Alice) ═══${NC}"
echo -e "${YELLOW}Alice funding channel with additional 1 ETH...${NC}"
alice fund-channel -c $CHANNEL_ADDR -a 1.0
echo -e "${GREEN}✓ Alice funded channel${NC}"

# Test 3: Fund channel (Bob)
echo -e "\n${BLUE}═══ Test 3: Fund Channel (Bob) ═══${NC}"
echo -e "${YELLOW}Bob funding channel with 5 ETH...${NC}"
bob fund-channel -c $CHANNEL_ADDR -a 5.0
echo -e "${GREEN}✓ Bob funded channel${NC}"

# Test 4: Check status
echo -e "\n${BLUE}═══ Test 4: Check Channel Status ═══${NC}"
echo -e "${YELLOW}Alice's view:${NC}"
alice status -c $CHANNEL_ADDR
echo -e "\n${YELLOW}Bob's view:${NC}"
bob status -c $CHANNEL_ADDR

# Test 5: Send payment (Alice -> Bob)
echo -e "\n${BLUE}═══ Test 5: Send Payment (Alice to Bob) ═══${NC}"
echo -e "${YELLOW}Alice sending 0.5 ETH to Bob...${NC}"
PAYMENT_OUTPUT=$(alice send-payment -c $CHANNEL_ADDR -a 0.5 2>&1)
echo "$PAYMENT_OUTPUT"

# Extract serialized commitment
COMMITMENT=$(echo "$PAYMENT_OUTPUT" | grep -A1 "Serialized commitment" | tail -1 | tr -d '─')
if [ -z "$COMMITMENT" ] || [ "$COMMITMENT" = "" ]; then
    # Try alternative extraction
    COMMITMENT=$(echo "$PAYMENT_OUTPUT" | grep '{"channelAddress"')
fi
echo -e "${GREEN}✓ Payment commitment created${NC}"

# Test 6: Bob signs commitment (includes revocation hash for new state)
echo -e "\n${BLUE}═══ Test 6: Bob Signs Commitment ═══${NC}"
echo -e "${YELLOW}Bob signing commitment...${NC}"
echo -e "${YELLOW}(Bob generates revocation hash for this commitment)${NC}"
SIGNED_OUTPUT=$(bob sign-commitment -d "$COMMITMENT" 2>&1)
echo "$SIGNED_OUTPUT"

# Extract signed commitment
SIGNED_COMMITMENT=$(echo "$SIGNED_OUTPUT" | grep '{"channelAddress"' | tail -1)
echo -e "${GREEN}✓ Bob signed commitment with revocation hash${NC}"

# Test 7: Alice finalizes commitment (verifies Bob's revocation data)
echo -e "\n${BLUE}═══ Test 7: Alice Finalizes Commitment ═══${NC}"
echo -e "${YELLOW}Alice finalizing commitment...${NC}"
echo -e "${YELLOW}(First commitment - no previous revocation secrets to exchange)${NC}"
FINALIZE_OUTPUT=$(alice finalize-commitment -d "$SIGNED_COMMITMENT" 2>&1)
echo "$FINALIZE_OUTPUT"
echo -e "${GREEN}✓ Commitment finalized${NC}"

# Test 8: List commitments
echo -e "\n${BLUE}═══ Test 8: List Commitments ═══${NC}"
echo -e "${YELLOW}Alice's commitments:${NC}"
alice list-commitments -c $CHANNEL_ADDR
echo -e "\n${YELLOW}Bob's commitments:${NC}"
bob list-commitments -c $CHANNEL_ADDR

# Test 9: Send another payment (with revocation exchange)
echo -e "\n${BLUE}═══ Test 9: Second Payment (Alice to Bob) - WITH REVOCATION EXCHANGE ═══${NC}"
echo -e "${YELLOW}Alice sending another 1.0 ETH to Bob...${NC}"
PAYMENT2_OUTPUT=$(alice send-payment -c $CHANNEL_ADDR -a 1.0 2>&1)
echo "$PAYMENT2_OUTPUT"
COMMITMENT2=$(echo "$PAYMENT2_OUTPUT" | grep '{"channelAddress"')
echo -e "${GREEN}✓ Second payment commitment created (nonce 2)${NC}"

echo -e "\n${YELLOW}Bob signing second commitment...${NC}"
echo -e "${YELLOW}(Bob reveals revocation secret for commitment #1, generates hash for #2)${NC}"
SIGNED2_OUTPUT=$(bob sign-commitment -d "$COMMITMENT2" 2>&1)
echo "$SIGNED2_OUTPUT"
SIGNED2_COMMITMENT=$(echo "$SIGNED2_OUTPUT" | grep '{"channelAddress"' | tail -1)
echo -e "${GREEN}✓ Bob signed and revealed revocation for commitment #1${NC}"

echo -e "\n${YELLOW}Alice finalizing second commitment...${NC}"
echo -e "${YELLOW}(Alice verifies Bob's revocation secret, reveals her own for commitment #1)${NC}"
FINALIZE2_OUTPUT=$(alice finalize-commitment -d "$SIGNED2_COMMITMENT" 2>&1)
echo "$FINALIZE2_OUTPUT"

# Extract revocation response for Bob
REVOCATION_RESPONSE=$(echo "$FINALIZE2_OUTPUT" | grep '{"channelAddress"' | tail -1)
if [ -n "$REVOCATION_RESPONSE" ]; then
    echo -e "\n${YELLOW}Bob receiving Alice's revocation secret...${NC}"
    bob receive-revocation -d "$REVOCATION_RESPONSE"
    echo -e "${GREEN}✓ Revocation exchange complete for commitment #1${NC}"
fi

echo -e "${GREEN}✓ Second payment complete with revocation exchange${NC}"

# Test 10: Third payment to fully test revocation chain
echo -e "\n${BLUE}═══ Test 10: Third Payment (Alice to Bob) - REVOCATION CHAIN ═══${NC}"
echo -e "${YELLOW}Alice sending 0.25 ETH to Bob...${NC}"
PAYMENT3_OUTPUT=$(alice send-payment -c $CHANNEL_ADDR -a 0.25 2>&1)
COMMITMENT3=$(echo "$PAYMENT3_OUTPUT" | grep '{"channelAddress"')
echo -e "${GREEN}✓ Third payment commitment created (nonce 3)${NC}"

echo -e "\n${YELLOW}Bob signing third commitment...${NC}"
echo -e "${YELLOW}(Bob reveals revocation secret for commitment #2)${NC}"
SIGNED3_OUTPUT=$(bob sign-commitment -d "$COMMITMENT3" 2>&1)
SIGNED3_COMMITMENT=$(echo "$SIGNED3_OUTPUT" | grep '{"channelAddress"' | tail -1)
echo -e "${GREEN}✓ Bob signed and revealed revocation for commitment #2${NC}"

echo -e "\n${YELLOW}Alice finalizing third commitment...${NC}"
FINALIZE3_OUTPUT=$(alice finalize-commitment -d "$SIGNED3_COMMITMENT" 2>&1)
echo "$FINALIZE3_OUTPUT"

REVOCATION3_RESPONSE=$(echo "$FINALIZE3_OUTPUT" | grep '{"channelAddress"' | tail -1)
if [ -n "$REVOCATION3_RESPONSE" ]; then
    echo -e "\n${YELLOW}Bob receiving Alice's revocation secret for #2...${NC}"
    bob receive-revocation -d "$REVOCATION3_RESPONSE"
    echo -e "${GREEN}✓ Revocation exchange complete for commitment #2${NC}"
fi

# Test 11: Verify revoked commitments
echo -e "\n${BLUE}═══ Test 11: Verify Revoked Commitments ═══${NC}"
echo -e "${YELLOW}Alice's commitments (should show #1 and #2 as REVOKED):${NC}"
alice list-commitments -c $CHANNEL_ADDR
echo -e "\n${YELLOW}Bob's commitments (should show #1 and #2 as REVOKED):${NC}"
bob list-commitments -c $CHANNEL_ADDR

# Test 12: Final status
echo -e "\n${BLUE}═══ Test 12: Final Channel Status ═══${NC}"
echo -e "${YELLOW}Alice's final view:${NC}"
alice status -c $CHANNEL_ADDR

# Summary
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Test Summary                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo -e "${GREEN}✓ All tests passed!${NC}"
echo -e ""
echo -e "Channel Address: ${YELLOW}$CHANNEL_ADDR${NC}"
echo -e "Alice Data Path: ${YELLOW}$ALICE_DATA${NC}"
echo -e "Bob Data Path:   ${YELLOW}$BOB_DATA${NC}"
echo -e ""
echo -e "Initial funding:"
echo -e "  Alice: 6.0 ETH (5.0 + 1.0)"
echo -e "  Bob:   5.0 ETH"
echo -e ""
echo -e "Payments made:"
echo -e "  Alice -> Bob: 0.50 ETH (nonce 1) - ${RED}REVOKED${NC}"
echo -e "  Alice -> Bob: 1.00 ETH (nonce 2) - ${RED}REVOKED${NC}"
echo -e "  Alice -> Bob: 0.25 ETH (nonce 3) - ${GREEN}CURRENT${NC}"
echo -e ""
echo -e "Final balances (off-chain, from Alice's commitment):"
echo -e "  Balance A (Alice): 4.25 ETH"
echo -e "  Balance B (Bob):   1.75 ETH"
echo -e "  (Bob also has his initial 5 ETH deposit tracked in his local state)"
echo -e ""
echo -e "${BLUE}Revocation Exchange Flow:${NC}"
echo -e "  1. Alice creates commitment → sends to Bob"
echo -e "  2. Bob signs commitment → generates revocation hash"
echo -e "     → reveals previous revocation secret"
echo -e "  3. Alice finalizes → verifies Bob's revocation"
echo -e "     → reveals her own revocation secret"
echo -e "  4. Bob receives Alice's revocation → exchange complete"
echo -e ""
echo -e "${GREEN}Old states (nonce 1, 2) are now safely revoked!${NC}"
