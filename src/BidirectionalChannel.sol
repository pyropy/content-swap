// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title BidirectionalChannel
 * @dev Bidirectional payment channel with revocation mechanism similar to Lightning Network
 */
contract BidirectionalChannel is ReentrancyGuard {

    // Channel participants
    address public immutable partyA;
    address public immutable partyB;

    // Channel parameters
    uint256 public immutable fundingDeadline;
    uint256 public immutable disputePeriod;
    uint256 public channelBalance;

    // Channel state
    enum State { FUNDING, OPEN, DISPUTED, CLOSED }
    State public channelState;

    // Funding tracking
    mapping(address => uint256) public deposits;

    // Commitment tracking
    uint256 public latestNonce;
    mapping(bytes32 => bool) public revokedCommitments;

    // Dispute state
    uint256 public disputeDeadline;
    address public disputeInitiator;
    uint256 public disputedBalanceA;
    uint256 public disputedBalanceB;
    uint256 public disputedNonce;

    // Events
    event ChannelFunded(uint256 totalBalance);
    event CommitmentRevoked(bytes32 indexed commitmentHash);
    event DisputeInitiated(address indexed initiator, uint256 nonce, uint256 deadline);
    event ChannelSettled(uint256 balanceA, uint256 balanceB);
    event PenaltyApplied(address indexed cheater, uint256 amount);

    modifier onlyParticipants() {
        require(msg.sender == partyA || msg.sender == partyB, "Not a participant");
        _;
    }

    modifier inState(State _state) {
        require(channelState == _state, "Invalid state");
        _;
    }

    constructor(
        address _partyA,
        address _partyB,
        uint256 _fundingDeadline,
        uint256 _disputePeriod
    ) {
        require(_partyA != address(0) && _partyB != address(0), "Invalid addresses");
        require(_partyA != _partyB, "Parties must be different");
        require(_fundingDeadline > block.timestamp, "Invalid funding deadline");
        require(_disputePeriod > 0, "Invalid dispute period");

        partyA = _partyA;
        partyB = _partyB;
        fundingDeadline = _fundingDeadline;
        disputePeriod = _disputePeriod;
        channelState = State.FUNDING;
    }

    /**
     * @dev Fund the channel during the funding phase
     */
    function fundChannel() external payable onlyParticipants inState(State.FUNDING) {
        require(block.timestamp <= fundingDeadline, "Funding deadline passed");
        require(msg.value > 0, "Must send funds");

        deposits[msg.sender] += msg.value;
        channelBalance += msg.value;

        emit ChannelFunded(channelBalance);
    }

    /**
     * @dev Open the channel once both parties have funded
     */
    function openChannel() external onlyParticipants inState(State.FUNDING) {
        require(deposits[partyA] > 0 && deposits[partyB] > 0, "Both parties must fund");
        channelState = State.OPEN;
    }

    /**
     * @dev Refund deposits if channel opening fails
     */
    function refundDeposits() external nonReentrant inState(State.FUNDING) {
        require(block.timestamp > fundingDeadline, "Funding period not over");

        uint256 refundA = deposits[partyA];
        uint256 refundB = deposits[partyB];

        deposits[partyA] = 0;
        deposits[partyB] = 0;
        channelBalance = 0;
        channelState = State.CLOSED;

        if (refundA > 0) {
            (bool successA, ) = partyA.call{value: refundA}("");
            require(successA, "Refund to A failed");
        }

        if (refundB > 0) {
            (bool successB, ) = partyB.call{value: refundB}("");
            require(successB, "Refund to B failed");
        }
    }

    /**
     * @dev Submit a revocation secret to revoke an old commitment
     * @param commitmentHash Hash of the commitment being revoked
     * @param revocationSecret The secret that proves revocation
     */
    function submitRevocation(
        bytes32 commitmentHash,
        bytes32 revocationSecret
    ) external onlyParticipants inState(State.OPEN) {
        // Verify the revocation secret matches the commitment
        bytes32 secretHash = keccak256(abi.encodePacked(revocationSecret));
        require(secretHash == commitmentHash, "Invalid revocation secret");

        // Mark commitment as revoked
        revokedCommitments[commitmentHash] = true;

        emit CommitmentRevoked(commitmentHash);
    }

    /**
     * @dev Initiate dispute with a signed commitment transaction
     * @param nonce The sequence number of the commitment
     * @param balanceA Balance for party A in this commitment
     * @param balanceB Balance for party B in this commitment
     * @param signatureA Party A's signature
     * @param signatureB Party B's signature
     */
    function initiateDispute(
        uint256 nonce,
        uint256 balanceA,
        uint256 balanceB,
        bytes memory signatureA,
        bytes memory signatureB
    ) external onlyParticipants inState(State.OPEN) {
        require(balanceA + balanceB == channelBalance, "Invalid balances");

        // Create commitment hash
        bytes32 commitmentHash = keccak256(
            abi.encodePacked(address(this), nonce, balanceA, balanceB)
        );

        // Verify signatures
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(commitmentHash);
        address signerA = ECDSA.recover(ethSignedMessageHash, signatureA);
        address signerB = ECDSA.recover(ethSignedMessageHash, signatureB);

        require(signerA == partyA, "Invalid signature from A");
        require(signerB == partyB, "Invalid signature from B");

        // Check if this commitment has been revoked
        bytes32 revocationHash = keccak256(abi.encodePacked(commitmentHash));
        if (revokedCommitments[revocationHash]) {
            // Penalize the cheater - they tried to use a revoked commitment
            _applyPenalty(msg.sender);
            return;
        }

        // Set dispute state
        channelState = State.DISPUTED;
        disputeDeadline = block.timestamp + disputePeriod;
        disputeInitiator = msg.sender;
        disputedBalanceA = balanceA;
        disputedBalanceB = balanceB;
        disputedNonce = nonce;

        emit DisputeInitiated(msg.sender, nonce, disputeDeadline);
    }

    /**
     * @dev Challenge a dispute with a newer commitment
     * @param nonce The sequence number of the newer commitment
     * @param balanceA Balance for party A in this commitment
     * @param balanceB Balance for party B in this commitment
     * @param signatureA Party A's signature
     * @param signatureB Party B's signature
     */
    function challengeDispute(
        uint256 nonce,
        uint256 balanceA,
        uint256 balanceB,
        bytes memory signatureA,
        bytes memory signatureB
    ) external onlyParticipants inState(State.DISPUTED) {
        require(nonce > disputedNonce, "Must provide newer commitment");
        require(balanceA + balanceB == channelBalance, "Invalid balances");

        // Create commitment hash
        bytes32 commitmentHash = keccak256(
            abi.encodePacked(address(this), nonce, balanceA, balanceB)
        );

        // Verify signatures
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(commitmentHash);
        address signerA = ECDSA.recover(ethSignedMessageHash, signatureA);
        address signerB = ECDSA.recover(ethSignedMessageHash, signatureB);

        require(signerA == partyA, "Invalid signature from A");
        require(signerB == partyB, "Invalid signature from B");

        // Update disputed state with newer commitment
        disputedBalanceA = balanceA;
        disputedBalanceB = balanceB;
        disputedNonce = nonce;
        disputeInitiator = msg.sender;
        disputeDeadline = block.timestamp + disputePeriod; // Reset timer
    }

    /**
     * @dev Prove that the counterparty used a revoked commitment
     * @param revocationSecret The secret that proves the commitment was revoked
     */
    function proveRevocationBreach(
        bytes32 revocationSecret
    ) external onlyParticipants inState(State.DISPUTED) {
        // Calculate the commitment hash from disputed state
        bytes32 commitmentHash = keccak256(
            abi.encodePacked(address(this), disputedNonce, disputedBalanceA, disputedBalanceB)
        );

        // Verify the revocation secret matches
        bytes32 secretHash = keccak256(abi.encodePacked(revocationSecret));
        bytes32 revocationHash = keccak256(abi.encodePacked(commitmentHash));

        require(secretHash == revocationHash, "Invalid revocation proof");

        // The dispute initiator tried to use a revoked state - penalize them
        _applyPenalty(disputeInitiator);
    }

    /**
     * @dev Finalize the dispute after the dispute period
     */
    function finalizeDispute() external nonReentrant inState(State.DISPUTED) {
        require(block.timestamp >= disputeDeadline, "Dispute period not over");

        channelState = State.CLOSED;

        // Distribute funds according to the disputed commitment
        if (disputedBalanceA > 0) {
            (bool successA, ) = partyA.call{value: disputedBalanceA}("");
            require(successA, "Transfer to A failed");
        }

        if (disputedBalanceB > 0) {
            (bool successB, ) = partyB.call{value: disputedBalanceB}("");
            require(successB, "Transfer to B failed");
        }

        emit ChannelSettled(disputedBalanceA, disputedBalanceB);
    }

    /**
     * @dev Cooperative close with mutual agreement
     * @param balanceA Final balance for party A
     * @param balanceB Final balance for party B
     * @param signatureA Party A's signature
     * @param signatureB Party B's signature
     */
    function cooperativeClose(
        uint256 balanceA,
        uint256 balanceB,
        bytes memory signatureA,
        bytes memory signatureB
    ) external nonReentrant onlyParticipants inState(State.OPEN) {
        require(balanceA + balanceB == channelBalance, "Invalid balances");

        // Create close message hash
        bytes32 closeHash = keccak256(
            abi.encodePacked("CLOSE", address(this), balanceA, balanceB)
        );

        // Verify signatures
        bytes32 ethSignedCloseHash = MessageHashUtils.toEthSignedMessageHash(closeHash);
        address signerA = ECDSA.recover(ethSignedCloseHash, signatureA);
        address signerB = ECDSA.recover(ethSignedCloseHash, signatureB);

        require(signerA == partyA, "Invalid signature from A");
        require(signerB == partyB, "Invalid signature from B");

        channelState = State.CLOSED;

        // Distribute funds
        if (balanceA > 0) {
            (bool successA, ) = partyA.call{value: balanceA}("");
            require(successA, "Transfer to A failed");
        }

        if (balanceB > 0) {
            (bool successB, ) = partyB.call{value: balanceB}("");
            require(successB, "Transfer to B failed");
        }

        emit ChannelSettled(balanceA, balanceB);
    }

    /**
     * @dev Apply penalty to a cheater (gives all funds to honest party)
     * @param cheater The address that tried to cheat
     */
    function _applyPenalty(address cheater) private nonReentrant {
        channelState = State.CLOSED;

        address honestParty = (cheater == partyA) ? partyB : partyA;

        // Transfer all funds to the honest party
        (bool success, ) = honestParty.call{value: channelBalance}("");
        require(success, "Penalty transfer failed");

        emit PenaltyApplied(cheater, channelBalance);
        emit ChannelSettled(
            honestParty == partyA ? channelBalance : 0,
            honestParty == partyB ? channelBalance : 0
        );
    }

    /**
     * @dev Get channel info
     */
    function getChannelInfo() external view returns (
        address _partyA,
        address _partyB,
        uint256 _balance,
        State _state,
        uint256 _latestNonce
    ) {
        return (partyA, partyB, channelBalance, channelState, latestNonce);
    }
}