# 🔐 Encrypted Prediction Market

A privacy-preserving binary prediction market built with Zama's FHEVM (Fully Homomorphic Encryption Virtual Machine). This project enables users to place encrypted bets on binary outcomes (Yes/No) while keeping bet amounts completely private on-chain.

## ✨ Key Features

- **🔒 Complete Privacy**: All bet amounts are encrypted using FHEVM - nobody can see how much you bet
- **⚖️ Fair Markets**: Binary prediction markets with transparent rules and automated settlement
- **💰 Confidential Tokens**: ERC-7984 compliant confidential tokens for betting
- **🔐 Encrypted State**: All balances and bet amounts remain encrypted on-chain
- **🎯 Decentralized Resolution**: Market creators resolve outcomes after specified delays
- **💸 Proportional Rewards**: Winners share the total pool proportionally to their encrypted bets

## 🏗️ Architecture

### Smart Contracts

1. **PredictionMarket.sol** - Core prediction market contract
   - Create binary (Yes/No) prediction markets
   - Place encrypted bets using confidential tokens
   - Resolve markets and claim rewards
   - Uses async decryption for reward calculations

2. **ConfidentialToken.sol** - ERC-7984 confidential token
   - Fully encrypted balances and transfers
   - Minting and burning capabilities
   - Owner-visible total supply
   - Operator approval system for market interactions

### How It Works

1. **Market Creation**: Anyone can create a binary prediction market with a question and time parameters
2. **Betting Phase**: Users approve the market as an operator and place encrypted bets (Yes/No)
3. **Resolution**: After the betting period ends, the market creator resolves the outcome
4. **Claims**: Winners claim their proportional share of the total pool using async decryption

## 🚀 Quick Start

### Prerequisites

- **Node.js**: Version 20 or higher
- **npm or yarn/pnpm**: Package manager

### Installation

1. **Clone the repository and install dependencies**

   ```bash
   git clone <repository-url>
   cd encrypted-prediction-market
   npm install
   ```

2. **Set up environment variables**

   ```bash
   npx hardhat vars set MNEMONIC

   # Set your Infura API key for network access
   npx hardhat vars set INFURA_API_KEY

   # Optional: Set Etherscan API key for contract verification
   npx hardhat vars set ETHERSCAN_API_KEY
   ```

3. **Compile contracts**

   ```bash
   npm run compile
   ```

4. **Run tests**

   ```bash
   npm run test
   ```

### Deployment

#### Local Network

```bash
# Start a local FHEVM-ready node
npx hardhat node

# In a new terminal, deploy contracts
npx hardhat deploy --network localhost
```

#### Sepolia Testnet

```bash
# Deploy to Sepolia
npx hardhat deploy --network sepolia

# Verify contracts on Etherscan (optional)
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## 📖 Usage Guide

### 1. Initial Setup

After deployment, mint some test tokens and approve the market contract:

```bash
# Mint 1,000,000 test tokens to your account
npx hardhat task:pm:mint-tokens --amount 1000000 --network localhost

# Approve PredictionMarket contract as operator (required for betting)
npx hardhat task:pm:approve-operator --network localhost

# Check your token balance
npx hardhat task:pm:view-balance --network localhost
```

### 2. Create a Market

```bash
npx hardhat task:pm:create-market \
  --question "Will ETH reach $5000 by end of 2025?" \
  --duration 24 \
  --delay 2 \
  --network localhost
```

Parameters:
- `question`: The market question (binary Yes/No)
- `duration`: Betting period in hours (min: 1, max: 720)
- `delay`: Resolution delay in hours after betting ends (min: 1)

### 3. Place Encrypted Bets

```bash
# Bet YES with 100 tokens (amount is encrypted)
npx hardhat task:pm:place-bet \
  --market 0 \
  --prediction 1 \
  --amount 100 \
  --network localhost

# Bet NO with 150 tokens
npx hardhat task:pm:place-bet \
  --market 0 \
  --prediction 0 \
  --amount 150 \
  --network localhost
```

Parameters:
- `market`: Market ID
- `prediction`: 0 = No, 1 = Yes
- `amount`: Bet amount (will be encrypted on-chain)

### 4. View Market Information

```bash
# View detailed market information
npx hardhat task:pm:view-market --market 0 --network localhost

# View your bet on a market
npx hardhat task:pm:view-bet --market 0 --network localhost

# List all markets
npx hardhat task:pm:list-markets --network localhost
```

### 5. Resolve Market

After the betting period ends and resolution delay passes, the market creator can resolve:

```bash
npx hardhat task:pm:resolve-market \
  --market 0 \
  --outcome 1 \
  --network localhost
```

Parameters:
- `outcome`: 0 = No, 1 = Yes

### 6. Claim Rewards

Winners can claim their proportional share of the total pool:

```bash
npx hardhat task:pm:claim-reward --market 0 --network localhost
```

**Note**: Reward calculation uses async decryption via FHEVM's KMS (Key Management Service). The transaction will emit a `RewardClaimRequested` event, and the actual reward transfer happens in the callback.

## 📁 Project Structure

```
encrypted-prediction-market/
├── contracts/
│   ├── PredictionMarket.sol           # Main prediction market contract
│   ├── ConfidentialToken.sol          # ERC-7984 confidential token
│   └── tokens/                        # Token standard implementations
│       ├── ERC7984.sol                # Base ERC-7984 implementation
│       ├── IERC7984.sol               # ERC-7984 interface
│       ├── ERC7984Utils.sol           # Utility functions
│       ├── IERC7984Receiver.sol       # Receiver interface
│       └── FHESafeMath.sol            # Safe math for FHE operations
├── deploy/
│   ├── 01_deploy_confidential_token.ts  # Token deployment script
│   └── 02_deploy_prediction.ts           # Market deployment script
├── tasks/
│   ├── accounts.ts                    # Account management tasks
│   └── PredictionMarket.ts            # Market interaction tasks
├── test/
│   └── PredictionMarket.ts            # Comprehensive test suite
├── hardhat.config.ts                  # Hardhat configuration
└── package.json                       # Dependencies and scripts
```

## 📜 Available Scripts

| Script                  | Description                          |
| ----------------------- | ------------------------------------ |
| `npm run compile`       | Compile all contracts                |
| `npm run test`          | Run all tests                        |
| `npm run test:sepolia`  | Run tests on Sepolia testnet         |
| `npm run coverage`      | Generate coverage report             |
| `npm run lint`          | Run linting checks (Solidity + TS)   |
| `npm run lint:sol`      | Run Solidity linting                 |
| `npm run lint:ts`       | Run TypeScript linting               |
| `npm run prettier:check`| Check code formatting                |
| `npm run prettier:write`| Auto-format code                     |
| `npm run clean`         | Clean build artifacts                |
| `npm run chain`         | Start local Hardhat node             |
| `npm run deploy:localhost` | Deploy to local network           |
| `npm run deploy:sepolia`   | Deploy to Sepolia testnet         |

## 🔧 Available Hardhat Tasks

The project includes comprehensive Hardhat tasks for interacting with the prediction market:

| Task                          | Description                              |
| ----------------------------- | ---------------------------------------- |
| `task:pm:mint-tokens`         | Mint test tokens to your account         |
| `task:pm:approve-operator`    | Approve market contract as operator      |
| `task:pm:view-balance`        | View your confidential token balance     |
| `task:pm:create-market`       | Create a new prediction market           |
| `task:pm:place-bet`           | Place an encrypted bet on a market       |
| `task:pm:view-market`         | View detailed market information         |
| `task:pm:view-bet`            | View your bet on a specific market       |
| `task:pm:list-markets`        | List all prediction markets              |
| `task:pm:resolve-market`      | Resolve a market with final outcome      |
| `task:pm:claim-reward`        | Claim rewards from a resolved market     |

Use `npx hardhat <task-name> --help` for detailed information about each task.

## 📚 Documentation

- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [FHEVM Hardhat Setup Guide](https://docs.zama.ai/protocol/solidity-guides/getting-started/setup)
- [FHEVM Testing Guide](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/write_test)
- [FHEVM Hardhat Plugin](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat)

## 📄 License

This project is licensed under the BSD-3-Clause-Clear License. See the [LICENSE](LICENSE) file for details.

---

