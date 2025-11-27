.PHONY: help build test deploy clean install update-abis all dev

# Default target
help:
	@echo "Content Swap - Makefile Commands"
	@echo ""
	@echo "  make install       - Install all dependencies (npm and Foundry)"
	@echo "  make build         - Build smart contracts"
	@echo "  make test          - Run contract tests"
	@echo "  make update-abis   - Build contracts and copy ABIs to apps"
	@echo "  make deploy-local  - Deploy contracts to local Anvil node"
	@echo "  make clean         - Clean build artifacts"
	@echo "  make dev           - Start development environment (build + update-abis)"
	@echo "  make all           - Install, build, test, and update ABIs"
	@echo ""
	@echo "Application commands:"
	@echo "  make server        - Start the demo server (PartyB)"
	@echo "  make client        - Start the demo client (PartyA)"
	@echo "  make web           - Start the web application"
	@echo "  make cli-link      - Link CLI tool globally"
	@echo ""
	@echo "Utility commands:"
	@echo "  make anvil         - Start local Anvil blockchain"
	@echo "  make format        - Format Solidity code"
	@echo "  make gas-report    - Run tests with gas reporting"

# Install all dependencies
install:
	@echo "Installing npm dependencies..."
	npm install
	@echo "Installing Foundry dependencies..."
	cd contract && forge install
	@echo "Dependencies installed successfully!"

# Build smart contracts
build:
	@echo "Building smart contracts..."
	cd contract && forge build
	@echo "Build complete!"

# Run contract tests
test:
	@echo "Running contract tests..."
	cd contract && forge test
	@echo "Tests complete!"

# Build contracts and update ABIs in all applications
update-abis: build
	@echo "Updating ABIs in applications..."
	@# Create ABI directory if it doesn't exist
	@mkdir -p app/shared/abis
	@mkdir -p cli/abis

	@# Extract just the ABI from the compiled contract
	@echo "Extracting ABI from compiled contract..."
	@node -e " \
		const fs = require('fs'); \
		const path = require('path'); \
		const contractPath = path.join(__dirname, 'contract/out/BidirectionalChannel.sol/BidirectionalChannel.json'); \
		const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8')); \
		const abiData = { \
			abi: contract.abi, \
			bytecode: contract.bytecode.object \
		}; \
		fs.writeFileSync('app/shared/BidirectionalChannel.json', JSON.stringify(abiData, null, 2)); \
		fs.writeFileSync('cli/abis/BidirectionalChannel.json', JSON.stringify(abiData, null, 2)); \
		console.log('✓ ABI extracted and saved to app/shared/ and cli/abis/'); \
	"

	@# Optional: Create a TypeScript types file for the contract (if using TypeScript)
	@echo "ABIs updated successfully!"
	@echo "  - app/shared/BidirectionalChannel.json"
	@echo "  - cli/abis/BidirectionalChannel.json"

# Deploy contracts to local network
deploy-local:
	@echo "Deploying to local Anvil network..."
	cd contract && forge script script/DeployBidirectionalChannel.s.sol \
		--rpc-url http://127.0.0.1:8545 \
		--broadcast \
		--private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
	@echo "Deployment complete!"

# Deploy to testnet (requires .env configuration)
deploy-testnet:
	@echo "Deploying to testnet..."
	@test -f .env || (echo "Error: .env file not found" && exit 1)
	@cd contract && source ../.env && forge script script/DeployBidirectionalChannel.s.sol \
		--rpc-url $$RPC_URL \
		--broadcast \
		--verify \
		--private-key $$PRIVATE_KEY
	@echo "Testnet deployment complete!"

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	cd contract && forge clean
	rm -rf contract/out contract/cache
	@echo "Clean complete!"

# Development workflow - build and update ABIs
dev: build update-abis
	@echo "Development build complete!"

# Complete setup - install, build, test, and update ABIs
all: install build test update-abis
	@echo "Complete setup finished!"

# Start local Anvil blockchain
anvil:
	@echo "Starting Anvil local blockchain..."
	anvil

# Start demo server (PartyB - content provider)
server:
	@echo "Starting demo server (PartyB)..."
	cd app/server && npm start

# Start demo client (PartyA - content consumer)
client:
	@echo "Starting demo client (PartyA)..."
	cd app/server && npm run client

# Start web application
web:
	@echo "Starting web application..."
	cd app/web && npm run dev

# Link CLI tool globally
cli-link:
	@echo "Linking CLI tool..."
	cd cli && npm link
	@echo "CLI tool linked! You can now use 'channel-cli' command globally."

# Format Solidity code
format:
	@echo "Formatting Solidity code..."
	cd contract && forge fmt
	@echo "Formatting complete!"

# Run tests with gas reporting
gas-report:
	@echo "Running tests with gas report..."
	cd contract && forge test --gas-report

# Run tests with maximum verbosity
test-verbose:
	@echo "Running tests with verbose output..."
	cd contract && forge test -vvvv

# Check contract sizes
size-check:
	@echo "Checking contract sizes..."
	cd contract && forge build --sizes

# Create a snapshot of test gas usage
snapshot:
	@echo "Creating gas snapshot..."
	cd contract && forge snapshot

# Compare gas with snapshot
snapshot-diff:
	@echo "Comparing with gas snapshot..."
	cd contract && forge snapshot --diff

# Watch for changes and rebuild
watch:
	@echo "Watching for changes..."
	@while true; do \
		make build update-abis; \
		echo "Waiting for changes..."; \
		fswatch -1 -r contract/src contract/test; \
	done

# Generate contract documentation
docs:
	@echo "Generating contract documentation..."
	cd contract && forge doc --serve

# Verify contract on Etherscan (requires deployment)
verify:
	@test -f .env || (echo "Error: .env file not found" && exit 1)
	@echo "Verifying contract on Etherscan..."
	@read -p "Enter contract address: " CONTRACT_ADDRESS; \
	cd contract && source ../.env && forge verify-contract \
		--chain-id $$CHAIN_ID \
		--compiler-version v0.8.20 \
		$$CONTRACT_ADDRESS \
		src/BidirectionalChannel.sol:BidirectionalChannel \
		--etherscan-api-key $$ETHERSCAN_API_KEY

# Run slither security analysis (requires slither-analyzer)
security:
	@echo "Running security analysis with Slither..."
	@command -v slither >/dev/null 2>&1 || (echo "Error: slither not installed. Install with: pip3 install slither-analyzer" && exit 1)
	cd contract && slither . --print human-summary

# Quick build and test
quick: build test
	@echo "Quick build and test complete!"

# Development setup with auto-reload (requires fswatch)
dev-watch:
	@command -v fswatch >/dev/null 2>&1 || (echo "Error: fswatch not installed. Install with: brew install fswatch (macOS) or apt-get install fswatch (Linux)" && exit 1)
	@echo "Starting development watch mode..."
	@make watch