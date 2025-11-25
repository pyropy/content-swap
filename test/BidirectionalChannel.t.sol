// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/BidirectionalChannel.sol";

contract BidirectionalChannelTest is Test {
    BidirectionalChannel public channel;

    address public alice;
    address public bob;
    uint256 public alicePrivateKey;
    uint256 public bobPrivateKey;

    uint256 public fundingDeadline;
    uint256 public disputePeriod;

    event ChannelFunded(uint256 totalBalance);
    event CommitmentRevoked(bytes32 indexed commitmentHash);
    event DisputeInitiated(address indexed initiator, uint256 nonce, uint256 deadline);
    event ChannelSettled(uint256 balanceA, uint256 balanceB);
    event PenaltyApplied(address indexed cheater, uint256 amount);

    function setUp() public {
        // Setup test accounts
        alicePrivateKey = 0xa11ce;
        bobPrivateKey = 0xb0b;
        alice = vm.addr(alicePrivateKey);
        bob = vm.addr(bobPrivateKey);

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        // Deploy channel
        fundingDeadline = block.timestamp + 1 hours;
        disputePeriod = 1 days;

        channel = new BidirectionalChannel(
            alice,
            bob,
            fundingDeadline,
            disputePeriod
        );
    }

    function test_InitialState() public view {
        assertEq(channel.partyA(), alice);
        assertEq(channel.partyB(), bob);
        assertEq(channel.fundingDeadline(), fundingDeadline);
        assertEq(channel.disputePeriod(), disputePeriod);
        assertEq(uint(channel.channelState()), 0); // FUNDING state
    }

    function test_FundingChannel() public {
        // Alice funds the channel
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit ChannelFunded(5 ether);
        channel.fundChannel{value: 5 ether}();

        assertEq(channel.deposits(alice), 5 ether);
        assertEq(channel.channelBalance(), 5 ether);

        // Bob funds the channel
        vm.prank(bob);
        vm.expectEmit(true, false, false, true);
        emit ChannelFunded(10 ether);
        channel.fundChannel{value: 5 ether}();

        assertEq(channel.deposits(bob), 5 ether);
        assertEq(channel.channelBalance(), 10 ether);
    }

    function test_OpenChannel() public {
        // Fund channel first
        vm.prank(alice);
        channel.fundChannel{value: 5 ether}();

        vm.prank(bob);
        channel.fundChannel{value: 5 ether}();

        // Open the channel
        vm.prank(alice);
        channel.openChannel();

        assertEq(uint(channel.channelState()), 1); // OPEN state
    }

    function test_CannotOpenWithoutBothFunding() public {
        // Only Alice funds
        vm.prank(alice);
        channel.fundChannel{value: 5 ether}();

        // Try to open - should fail
        vm.prank(alice);
        vm.expectRevert("Both parties must fund");
        channel.openChannel();
    }

    function test_RefundAfterDeadline() public {
        // Alice funds
        vm.prank(alice);
        channel.fundChannel{value: 5 ether}();

        // Advance time past deadline
        vm.warp(fundingDeadline + 1);

        // Request refund
        uint256 aliceBalanceBefore = alice.balance;
        channel.refundDeposits();

        assertEq(alice.balance, aliceBalanceBefore + 5 ether);
        assertEq(uint(channel.channelState()), 3); // CLOSED state
    }

    function test_SubmitRevocation() public {
        // Setup: fund and open channel
        _fundAndOpenChannel();

        // Create a commitment hash and revocation secret
        bytes32 revocationSecret = keccak256("secret");
        bytes32 commitmentHash = keccak256(abi.encodePacked(revocationSecret));

        // Submit revocation
        vm.prank(alice);
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
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit DisputeInitiated(alice, nonce, block.timestamp + disputePeriod);
        channel.initiateDispute(nonce, balanceA, balanceB, sigA, sigB);

        assertEq(uint(channel.channelState()), 2); // DISPUTED state
        assertEq(channel.disputeInitiator(), alice);
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

        vm.prank(alice);
        channel.initiateDispute(nonce1, 4 ether, 6 ether, sigA1, sigB1);

        // Challenge with newer commitment (nonce 2)
        uint256 nonce2 = 2;
        (bytes memory sigA2, bytes memory sigB2) = _createSignedCommitment(
            nonce2,
            3 ether,
            7 ether
        );

        vm.prank(bob);
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

        vm.prank(alice);
        channel.initiateDispute(nonce, balanceA, balanceB, sigA, sigB);

        // Advance time past dispute period
        vm.warp(block.timestamp + disputePeriod + 1);

        // Finalize dispute
        uint256 aliceBalanceBefore = alice.balance;
        uint256 bobBalanceBefore = bob.balance;

        vm.expectEmit(true, false, false, true);
        emit ChannelSettled(balanceA, balanceB);
        channel.finalizeDispute();

        assertEq(alice.balance, aliceBalanceBefore + balanceA);
        assertEq(bob.balance, bobBalanceBefore + balanceB);
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

        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(alicePrivateKey, _toEthSignedMessageHash(closeHash));
        (uint8 vB, bytes32 rB, bytes32 sB) = vm.sign(bobPrivateKey, _toEthSignedMessageHash(closeHash));

        bytes memory sigA = abi.encodePacked(rA, sA, vA);
        bytes memory sigB = abi.encodePacked(rB, sB, vB);

        // Cooperative close
        uint256 aliceBalanceBefore = alice.balance;
        uint256 bobBalanceBefore = bob.balance;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit ChannelSettled(balanceA, balanceB);
        channel.cooperativeClose(balanceA, balanceB, sigA, sigB);

        assertEq(alice.balance, aliceBalanceBefore + balanceA);
        assertEq(bob.balance, bobBalanceBefore + balanceB);
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
        vm.prank(alice);
        channel.submitRevocation(revocationHash, revocationSecret);

        // Now try to use this revoked commitment in a dispute
        (bytes memory sigA, bytes memory sigB) = _createSignedCommitment(
            nonce,
            balanceA,
            balanceB
        );

        // Alice tries to cheat by using revoked commitment
        uint256 bobBalanceBefore = bob.balance;

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit PenaltyApplied(alice, 10 ether);
        channel.initiateDispute(nonce, balanceA, balanceB, sigA, sigB);

        // Bob should get all funds as penalty
        assertEq(bob.balance, bobBalanceBefore + 10 ether);
        assertEq(uint(channel.channelState()), 3); // CLOSED state
    }

    // Helper functions

    function _fundAndOpenChannel() private {
        vm.prank(alice);
        channel.fundChannel{value: 5 ether}();

        vm.prank(bob);
        channel.fundChannel{value: 5 ether}();

        vm.prank(alice);
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

        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(alicePrivateKey, messageHash);
        (uint8 vB, bytes32 rB, bytes32 sB) = vm.sign(bobPrivateKey, messageHash);

        sigA = abi.encodePacked(rA, sA, vA);
        sigB = abi.encodePacked(rB, sB, vB);
    }

    function _toEthSignedMessageHash(bytes32 hash) private pure returns (bytes32) {
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
    }
}