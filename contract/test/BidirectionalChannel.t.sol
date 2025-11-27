// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/BidirectionalChannel.sol";

contract BidirectionalChannelTest is Test {
    BidirectionalChannel public channel;

    address public partyA;
    address public partyB;
    uint256 public partyAPrivateKey;
    uint256 public partyBPrivateKey;

    uint256 public fundingDeadline;
    uint256 public disputePeriod;

    event ChannelFunded(uint256 totalBalance);
    event ChannelOpened(address indexed partyA, address indexed partyB, uint256 totalBalance, uint256 depositA, uint256 depositB);
    event CommitmentRevoked(bytes32 indexed commitmentHash);
    event DisputeInitiated(address indexed initiator, uint256 nonce, uint256 deadline);
    event ChannelSettled(uint256 balanceA, uint256 balanceB);
    event PenaltyApplied(address indexed cheater, uint256 amount);

    function setUp() public {
        // Setup test accounts
        partyAPrivateKey = 0xa11ce;
        partyBPrivateKey = 0xb0b;
        partyA = vm.addr(partyAPrivateKey);
        partyB = vm.addr(partyBPrivateKey);

        // Fund test accounts
        vm.deal(partyA, 100 ether);
        vm.deal(partyB, 100 ether);

        // Deploy channel
        fundingDeadline = block.timestamp + 1 hours;
        disputePeriod = 1 days;

        channel = new BidirectionalChannel(
            partyA,
            partyB,
            fundingDeadline,
            disputePeriod
        );
    }

    function test_InitialState() public view {
        assertEq(channel.partyA(), partyA);
        assertEq(channel.partyB(), partyB);
        assertEq(channel.fundingDeadline(), fundingDeadline);
        assertEq(channel.disputePeriod(), disputePeriod);
        assertEq(uint(channel.channelState()), 0); // FUNDING state
    }

    function test_FundingChannel() public {
        // PartyA funds the channel
        vm.prank(partyA);
        vm.expectEmit(true, false, false, true);
        emit ChannelFunded(5 ether);
        channel.fundChannel{value: 5 ether}();

        assertEq(channel.deposits(partyA), 5 ether);
        assertEq(channel.channelBalance(), 5 ether);

        // PartyB funds the channel
        vm.prank(partyB);
        vm.expectEmit(true, false, false, true);
        emit ChannelFunded(10 ether);
        channel.fundChannel{value: 5 ether}();

        assertEq(channel.deposits(partyB), 5 ether);
        assertEq(channel.channelBalance(), 10 ether);
    }

    function test_OpenChannel() public {
        // Fund channel first
        vm.prank(partyA);
        channel.fundChannel{value: 5 ether}();

        vm.prank(partyB);
        channel.fundChannel{value: 5 ether}();

        // Open the channel
        vm.prank(partyA);
        channel.openChannel();

        assertEq(uint(channel.channelState()), 1); // OPEN state
    }

    function test_SinglePartyFunding() public {
        // Only partyA funds
        vm.prank(partyA);
        channel.fundChannel{value: 5 ether}();

        // PartyA can open channel with single-party funding
        vm.prank(partyA);
        vm.expectEmit(true, true, false, true);
        emit ChannelOpened(partyA, partyB, 5 ether, 5 ether, 0);
        channel.openChannel();

        assertEq(uint(channel.channelState()), 1); // OPEN state
        assertEq(channel.deposits(partyA), 5 ether);
        assertEq(channel.deposits(partyB), 0);
    }

    function test_CannotOpenWithoutAnyFunding() public {
        // No one funds - should fail
        vm.prank(partyA);
        vm.expectRevert("Channel must have funds");
        channel.openChannel();
    }

    function test_DualPartyFundingStillWorks() public {
        // Both parties fund (backward compatibility)
        vm.prank(partyA);
        channel.fundChannel{value: 3 ether}();

        vm.prank(partyB);
        channel.fundChannel{value: 7 ether}();

        vm.prank(partyA);
        vm.expectEmit(true, true, false, true);
        emit ChannelOpened(partyA, partyB, 10 ether, 3 ether, 7 ether);
        channel.openChannel();

        assertEq(uint(channel.channelState()), 1); // OPEN state
        assertEq(channel.deposits(partyA), 3 ether);
        assertEq(channel.deposits(partyB), 7 ether);
    }

    function test_FundAndOpenChannel() public {
        // PartyA funds and opens in a single transaction
        vm.prank(partyA);
        vm.expectEmit(true, false, false, true);
        emit ChannelFunded(5 ether);
        vm.expectEmit(true, true, false, true);
        emit ChannelOpened(partyA, partyB, 5 ether, 5 ether, 0);
        channel.fundAndOpenChannel{value: 5 ether}();

        assertEq(channel.deposits(partyA), 5 ether);
        assertEq(channel.channelBalance(), 5 ether);
        assertEq(uint(channel.channelState()), 1); // OPEN state
    }

    function test_FundAndOpenChannelRequiresFunds() public {
        vm.prank(partyA);
        vm.expectRevert("Must send funds");
        channel.fundAndOpenChannel{value: 0}();
    }

    function test_SubmitRevocation() public {
        // Setup: fund and open channel
        _fundAndOpenChannel();

        // Create a commitment hash and revocation secret
        bytes32 revocationSecret = keccak256("secret");
        bytes32 commitmentHash = keccak256(abi.encodePacked(revocationSecret));

        // Submit revocation
        vm.prank(partyA);
        vm.expectEmit(true, false, false, false);
        emit CommitmentRevoked(commitmentHash);
        channel.submitRevocation(commitmentHash, revocationSecret);

        assertTrue(channel.revokedCommitments(commitmentHash));
    }

    function test_InitiateDispute() public {
        // Setup: fund and open channel
        _fundAndOpenChannel();

        // Create commitment
        uint256 nonce = 1;
        uint256 balanceA = 4 ether;
        uint256 balanceB = 6 ether;

        (bytes memory sigA, bytes memory sigB) = _createSignedCommitment(
            nonce,
            balanceA,
            balanceB
        );

        // Initiate dispute
        vm.prank(partyA);
        vm.expectEmit(true, false, false, true);
        emit DisputeInitiated(partyA, nonce, block.timestamp + disputePeriod);
        channel.initiateDispute(nonce, balanceA, balanceB, sigA, sigB);

        assertEq(uint(channel.channelState()), 2); // DISPUTED state
        assertEq(channel.disputeInitiator(), partyA);
        assertEq(channel.disputedBalanceA(), balanceA);
        assertEq(channel.disputedBalanceB(), balanceB);
    }

    function test_ChallengeDisputeWithNewerCommitment() public {
        // Setup and initiate dispute with nonce 1
        _fundAndOpenChannel();

        uint256 nonce1 = 1;
        (bytes memory sigA1, bytes memory sigB1) = _createSignedCommitment(
            nonce1,
            4 ether,
            6 ether
        );

        vm.prank(partyA);
        channel.initiateDispute(nonce1, 4 ether, 6 ether, sigA1, sigB1);

        // Challenge with newer commitment (nonce 2)
        uint256 nonce2 = 2;
        (bytes memory sigA2, bytes memory sigB2) = _createSignedCommitment(
            nonce2,
            3 ether,
            7 ether
        );

        vm.prank(partyB);
        channel.challengeDispute(nonce2, 3 ether, 7 ether, sigA2, sigB2);

        assertEq(channel.disputedNonce(), nonce2);
        assertEq(channel.disputedBalanceA(), 3 ether);
        assertEq(channel.disputedBalanceB(), 7 ether);
    }

    function test_FinalizeDisputeAfterPeriod() public {
        // Setup and initiate dispute
        _fundAndOpenChannel();

        uint256 nonce = 1;
        uint256 balanceA = 4 ether;
        uint256 balanceB = 6 ether;

        (bytes memory sigA, bytes memory sigB) = _createSignedCommitment(
            nonce,
            balanceA,
            balanceB
        );

        vm.prank(partyA);
        channel.initiateDispute(nonce, balanceA, balanceB, sigA, sigB);

        // Advance time past dispute period
        vm.warp(block.timestamp + disputePeriod + 1);

        // Finalize dispute
        uint256 partyABalanceBefore = partyA.balance;
        uint256 partyBBalanceBefore = partyB.balance;

        vm.expectEmit(true, false, false, true);
        emit ChannelSettled(balanceA, balanceB);
        channel.finalizeDispute();

        assertEq(partyA.balance, partyABalanceBefore + balanceA);
        assertEq(partyB.balance, partyBBalanceBefore + balanceB);
        assertEq(uint(channel.channelState()), 3); // CLOSED state
    }

    function test_CooperativeClose() public {
        // Setup: fund and open channel
        _fundAndOpenChannel();

        uint256 balanceA = 4 ether;
        uint256 balanceB = 6 ether;

        // Create close message signatures
        bytes32 closeHash = keccak256(
            abi.encodePacked("CLOSE", address(channel), balanceA, balanceB)
        );

        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(partyAPrivateKey, _toEthSignedMessageHash(closeHash));
        (uint8 vB, bytes32 rB, bytes32 sB) = vm.sign(partyBPrivateKey, _toEthSignedMessageHash(closeHash));

        bytes memory sigA = abi.encodePacked(rA, sA, vA);
        bytes memory sigB = abi.encodePacked(rB, sB, vB);

        // Cooperative close
        uint256 partyABalanceBefore = partyA.balance;
        uint256 partyBBalanceBefore = partyB.balance;

        vm.prank(partyA);
        vm.expectEmit(true, false, false, true);
        emit ChannelSettled(balanceA, balanceB);
        channel.cooperativeClose(balanceA, balanceB, sigA, sigB);

        assertEq(partyA.balance, partyABalanceBefore + balanceA);
        assertEq(partyB.balance, partyBBalanceBefore + balanceB);
        assertEq(uint(channel.channelState()), 3); // CLOSED state
    }

    function test_PenaltyForUsingRevokedCommitment() public {
        // Setup: fund and open channel
        _fundAndOpenChannel();

        // First, create and revoke a commitment
        bytes32 revocationSecret = keccak256("secret");
        bytes32 secretHash = keccak256(abi.encodePacked(revocationSecret));

        // Create commitment that will be revoked
        uint256 nonce = 1;
        uint256 balanceA = 4 ether;
        uint256 balanceB = 6 ether;

        bytes32 commitmentHash = keccak256(
            abi.encodePacked(address(channel), nonce, balanceA, balanceB)
        );

        bytes32 revocationHash = keccak256(abi.encodePacked(commitmentHash));

        // Mark as revoked
        vm.prank(partyA);
        channel.submitRevocation(revocationHash, revocationSecret);

        // Now try to use this revoked commitment in a dispute
        (bytes memory sigA, bytes memory sigB) = _createSignedCommitment(
            nonce,
            balanceA,
            balanceB
        );

        // PartyA tries to cheat by using revoked commitment
        uint256 partyBBalanceBefore = partyB.balance;

        vm.prank(partyA);
        vm.expectEmit(true, false, false, true);
        emit PenaltyApplied(partyA, 10 ether);
        channel.initiateDispute(nonce, balanceA, balanceB, sigA, sigB);

        // PartyB should get all funds as penalty
        assertEq(partyB.balance, partyBBalanceBefore + 10 ether);
        assertEq(uint(channel.channelState()), 3); // CLOSED state
    }

    // Helper functions

    function _fundAndOpenChannel() private {
        vm.prank(partyA);
        channel.fundChannel{value: 5 ether}();

        vm.prank(partyB);
        channel.fundChannel{value: 5 ether}();

        vm.prank(partyA);
        channel.openChannel();
    }

    function _createSignedCommitment(
        uint256 nonce,
        uint256 balanceA,
        uint256 balanceB
    ) private view returns (bytes memory sigA, bytes memory sigB) {
        bytes32 commitmentHash = keccak256(
            abi.encodePacked(address(channel), nonce, balanceA, balanceB)
        );

        bytes32 messageHash = _toEthSignedMessageHash(commitmentHash);

        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(partyAPrivateKey, messageHash);
        (uint8 vB, bytes32 rB, bytes32 sB) = vm.sign(partyBPrivateKey, messageHash);

        sigA = abi.encodePacked(rA, sA, vA);
        sigB = abi.encodePacked(rB, sB, vB);
    }

    function _toEthSignedMessageHash(bytes32 hash) private pure returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
    }
}