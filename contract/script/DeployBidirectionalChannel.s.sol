// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/BidirectionalChannel.sol";

contract DeployBidirectionalChannel is Script {
    function run() external returns (BidirectionalChannel) {
        // Get deployment parameters from environment variables
        address partyA = vm.envAddress("PARTY_A");
        address partyB = vm.envAddress("PARTY_B");
        uint256 fundingDeadline = block.timestamp + vm.envOr("FUNDING_DEADLINE", uint256(3600)); // Default 1 hour
        uint256 disputePeriod = vm.envOr("DISPUTE_PERIOD", uint256(86400)); // Default 24 hours

        // Get deployer's private key
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy the channel contract
        BidirectionalChannel channel = new BidirectionalChannel(
            partyA,
            partyB,
            fundingDeadline,
            disputePeriod
        );

        vm.stopBroadcast();

        // Log deployment information
        console.log("BidirectionalChannel deployed at:", address(channel));
        console.log("Party A:", partyA);
        console.log("Party B:", partyB);
        console.log("Funding Deadline:", fundingDeadline);
        console.log("Dispute Period:", disputePeriod);

        return channel;
    }
}

contract DeployAndFundChannel is Script {
    function run() external returns (BidirectionalChannel) {
        // Get deployment parameters
        address partyA = vm.envAddress("PARTY_A");
        address partyB = vm.envAddress("PARTY_B");
        uint256 fundingDeadline = block.timestamp + vm.envOr("FUNDING_DEADLINE", uint256(3600));
        uint256 disputePeriod = vm.envOr("DISPUTE_PERIOD", uint256(86400));
        uint256 fundingAmount = vm.envOr("FUNDING_AMOUNT", uint256(1 ether));

        // Get deployer's private key
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy the channel contract
        BidirectionalChannel channel = new BidirectionalChannel(
            partyA,
            partyB,
            fundingDeadline,
            disputePeriod
        );

        // Fund the channel if deployer is one of the parties
        address deployer = vm.addr(deployerPrivateKey);
        if (deployer == partyA || deployer == partyB) {
            channel.fundChannel{value: fundingAmount}();
            console.log("Channel funded with:", fundingAmount);
        }

        vm.stopBroadcast();

        console.log("Channel deployed and funded at:", address(channel));

        return channel;
    }
}
