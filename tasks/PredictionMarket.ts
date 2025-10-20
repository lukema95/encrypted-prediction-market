import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

/**
 * Tutorial: Prediction Market Tasks
 * ==================================
 *
 * 1. Deploy contracts:
 *    npx hardhat deploy --network localhost
 *
 * 2. Mint test tokens (First time setup):
 *    npx hardhat task:pm:mint-tokens --amount 1000000 --network localhost
 *
 * 3. Approve contract as operator (Required before betting):
 *    npx hardhat task:pm:approve-operator --network localhost
 *
 * 4. Create a market:
 *    npx hardhat task:pm:create-market \
 *      --question "Will ETH reach $5000 by Dec 31?" \
 *      --duration 24 \
 *      --delay 2 \
 *      --network localhost
 *
 * 5. Place bets:
 *    npx hardhat task:pm:place-bet --market 0 --prediction 1 --amount 100 --network localhost
 *    npx hardhat task:pm:place-bet --market 0 --prediction 0 --amount 150 --network localhost
 *
 * 6. View market info:
 *    npx hardhat task:pm:view-market --market 0 --network localhost
 *
 * 7. Resolve market (after end time):
 *    npx hardhat task:pm:resolve-market --market 0 --outcome 1 --network localhost
 *
 * 8. Claim reward (winners only):
 *    npx hardhat task:pm:claim-reward --market 0 --network localhost
 *
 * 9. View my bet:
 *    npx hardhat task:pm:view-bet --market 0 --network localhost
 *
 * 10. Check token balance:
 *    npx hardhat task:pm:view-balance --network localhost
 */

// Helper function to format timestamps
function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

/**
 * Mint test tokens to your account
 * Example: npx hardhat task:pm:mint-tokens --amount 1000000 --network localhost
 */
task("task:pm:mint-tokens", "Mint test tokens to your account")
  .addParam("amount", "Amount of tokens to mint")
  .addOptionalParam("address", "ConfidentialToken contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const amount = parseInt(taskArguments.amount);

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("ConfidentialToken");

    console.log(`\n💰 Minting ${amount} test tokens...`);
    console.log(`Token Contract: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const tokenContract = await ethers.getContractAt("ConfidentialToken", deployment.address);

    const tx = await tokenContract.connect(signers[0]).mint(signers[0].address, amount);

    console.log(`⏳ Waiting for tx: ${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`✅ Minted ${amount} tokens successfully! (tx status: ${receipt?.status})`);
    console.log(`   Recipient: ${signers[0].address}`);
  });

/**
 * Approve PredictionMarket contract as operator
 * Example: npx hardhat task:pm:approve-operator --network localhost
 */
task("task:pm:approve-operator", "Approve PredictionMarket as operator for token transfers")
  .addOptionalParam("pm", "PredictionMarket contract address")
  .addOptionalParam("token", "ConfidentialToken contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const pmDeployment = taskArguments.pm
      ? { address: taskArguments.pm }
      : await deployments.get("PredictionMarket");

    const tokenDeployment = taskArguments.token
      ? { address: taskArguments.token }
      : await deployments.get("ConfidentialToken");

    console.log(`\n✅ Approving PredictionMarket as operator...`);
    console.log(`Token Contract: ${tokenDeployment.address}`);
    console.log(`PredictionMarket: ${pmDeployment.address}`);

    const signers = await ethers.getSigners();
    const tokenContract = await ethers.getContractAt("ConfidentialToken", tokenDeployment.address);

    // Set operator for 1 year
    const block = await ethers.provider.getBlock("latest");
    const futureTimestamp = block!.timestamp + 365 * 24 * 60 * 60;

    const tx = await tokenContract.connect(signers[0]).setOperator(pmDeployment.address, futureTimestamp);

    console.log(`⏳ Waiting for tx: ${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`✅ Operator approved successfully! (tx status: ${receipt?.status})`);
    console.log(`   Valid until: ${formatTime(futureTimestamp)}`);
  });

/**
 * View your token balance
 * Example: npx hardhat task:pm:view-balance --network localhost
 */
task("task:pm:view-balance", "View your confidential token balance")
  .addOptionalParam("address", "ConfidentialToken contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("ConfidentialToken");

    const signers = await ethers.getSigners();
    const tokenContract = await ethers.getContractAt("ConfidentialToken", deployment.address);

    console.log(`\n💰 Checking Token Balance...`);
    console.log(`Token Contract: ${deployment.address}`);
    console.log(`Your Address: ${signers[0].address}`);

    const encryptedBalance = await tokenContract.confidentialBalanceOf(signers[0].address);

    if (encryptedBalance !== ethers.ZeroHash) {
      const clearBalance = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedBalance,
        deployment.address,
        signers[0],
      );
      console.log(`\n✅ Your Balance: ${clearBalance} tokens`);
    } else {
      console.log(`\n❌ No balance found (or balance is 0)`);
    }
  });

/**
 * Create a new prediction market
 * Example: npx hardhat task:pm:create-market --question "Will BTC > $100k?" --duration 48 --delay 2 --network localhost
 */
task("task:pm:create-market", "Create a new prediction market")
  .addParam("question", "The market question")
  .addParam("duration", "Betting duration in hours")
  .addParam("delay", "Resolution delay in hours after betting ends")
  .addOptionalParam("address", "PredictionMarket contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    console.log(`\n📊 Creating Prediction Market...`);
    console.log(`Contract: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    const tx = await contract
      .connect(signers[0])
      .createMarket(taskArguments.question, taskArguments.duration, taskArguments.delay);

    console.log(`⏳ Waiting for tx: ${tx.hash}...`);
    const receipt = await tx.wait();

    // Get market ID from events
    const event = receipt?.logs.find((log: any) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === "MarketCreated";
      } catch {
        return false;
      }
    });

    if (event) {
      const parsed = contract.interface.parseLog(event);
      const marketId = parsed?.args[0];
      console.log(`\n✅ Market Created Successfully!`);
      console.log(`   Market ID: ${marketId}`);
      console.log(`   Question: ${taskArguments.question}`);
      console.log(`   Duration: ${taskArguments.duration} hours`);
      console.log(`   Resolution Delay: ${taskArguments.delay} hours`);
    }
  });

/**
 * Place an encrypted bet on a market
 * Example: npx hardhat task:pm:place-bet --market 0 --prediction 1 --amount 100 --network localhost
 */
task("task:pm:place-bet", "Place an encrypted bet on a market")
  .addParam("market", "Market ID")
  .addParam("prediction", "Your prediction: 0 = No, 1 = Yes")
  .addParam("amount", "Bet amount (will be encrypted)")
  .addOptionalParam("address", "PredictionMarket contract address")
  .addOptionalParam("token", "ConfidentialToken contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const marketId = parseInt(taskArguments.market);
    const prediction = parseInt(taskArguments.prediction);
    const amount = parseInt(taskArguments.amount);

    if (prediction !== 0 && prediction !== 1) {
      throw new Error("Prediction must be 0 (No) or 1 (Yes)");
    }

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    // Get token contract address
    const tokenDeployment = taskArguments.token
      ? { address: taskArguments.token }
      : await deployments.get("ConfidentialToken");

    console.log(`\n🎲 Placing Bet...`);
    console.log(`PredictionMarket: ${deployment.address}`);
    console.log(`Token Contract: ${tokenDeployment.address}`);
    console.log(`Market ID: ${marketId}`);
    console.log(`Prediction: ${prediction === 1 ? "YES" : "NO"}`);
    console.log(`Amount: ${amount} (encrypted)`);

    const signers = await ethers.getSigners();
    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    // Encrypt the bet amount
    // - First param: TOKEN address (where FHE.fromExternal is called)
    // - Second param: PredictionMarket address (the contract calling placeBet)
    const encryptedAmount = await fhevm
      .createEncryptedInput(tokenDeployment.address, deployment.address)
      .add64(amount)
      .encrypt();

    const tx = await contract
      .connect(signers[0])
      .placeBet(marketId, prediction, encryptedAmount.handles[0], encryptedAmount.inputProof);

    console.log(`⏳ Waiting for tx: ${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`✅ Bet placed successfully! (tx status: ${receipt?.status})`);

    // Decrypt and show the user's bet
    console.log(`\n📋 Your Bet Details:`);
    const encryptedBetAmount = await contract.getUserBetAmount(marketId, signers[0].address);

    if (encryptedBetAmount !== ethers.ZeroHash) {
      const clearAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedBetAmount,
        deployment.address,
        signers[0],
      );
      console.log(`   Amount: ${clearAmount}`);
      console.log(`   Prediction: ${prediction === 1 ? "YES" : "NO"}`);
    }
  });

/**
 * View market details
 * Example: npx hardhat task:pm:view-market --market 0 --network localhost
 */
task("task:pm:view-market", "View market details")
  .addParam("market", "Market ID")
  .addOptionalParam("address", "PredictionMarket contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const marketId = parseInt(taskArguments.market);

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    console.log(`\n📊 Market Details (ID: ${marketId})`);
    console.log(`Contract: ${deployment.address}\n`);

    const market = await contract.getMarket(marketId);
    const [yesCount, noCount] = await contract.getParticipantCounts(marketId);
    const isActive = await contract.isMarketActive(marketId);
    const canResolve = await contract.canResolveMarket(marketId);

    console.log(`Question: ${market.question}`);
    console.log(`Creator: ${market.creator}`);
    console.log(`Created: ${formatTime(Number(market.createdAt))}`);
    console.log(`Betting Ends: ${formatTime(Number(market.endTime))}`);
    console.log(`Resolution Time: ${formatTime(Number(market.resolutionTime))}`);
    console.log(`\nStatus:`);
    console.log(`   Active: ${isActive ? "✅ Yes" : "❌ No"}`);
    console.log(`   Can Resolve: ${canResolve ? "✅ Yes" : "❌ No"}`);
    console.log(`   Resolved: ${market.resolved ? "✅ Yes" : "❌ No"}`);

    if (market.resolved) {
      console.log(`   Outcome: ${Number(market.outcome) === 1 ? "✅ YES" : "❌ NO"}`);
    }

    console.log(`\nParticipants:`);
    console.log(`   YES voters: ${yesCount}`);
    console.log(`   NO voters: ${noCount}`);
    console.log(`   Total: ${Number(yesCount) + Number(noCount)}`);
  });

/**
 * View user's bet
 * Example: npx hardhat task:pm:view-bet --market 0 --network localhost
 */
task("task:pm:view-bet", "View your bet on a market")
  .addParam("market", "Market ID")
  .addOptionalParam("address", "PredictionMarket contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    const marketId = parseInt(taskArguments.market);

    await fhevm.initializeCLIApi();

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    const signers = await ethers.getSigners();
    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    console.log(`\n📋 Your Bet (Market ${marketId})`);

    const [prediction, claimed, exists] = await contract.getUserBet(marketId, signers[0].address);

    if (!exists) {
      console.log(`❌ You haven't placed a bet on this market yet.`);
      return;
    }

    console.log(`Prediction: ${Number(prediction) === 1 ? "✅ YES" : "❌ NO"}`);
    console.log(`Claimed: ${claimed ? "✅ Yes" : "❌ No"}`);

    // Decrypt bet amount
    const encryptedAmount = await contract.getUserBetAmount(marketId, signers[0].address);

    if (encryptedAmount !== ethers.ZeroHash) {
      const clearAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedAmount,
        deployment.address,
        signers[0],
      );
      console.log(`Amount: ${clearAmount} (encrypted on-chain)`);
    }
  });

/**
 * Resolve a market
 * Example: npx hardhat task:pm:resolve-market --market 0 --outcome 1 --network localhost
 */
task("task:pm:resolve-market", "Resolve a market with the final outcome")
  .addParam("market", "Market ID")
  .addParam("outcome", "Final outcome: 0 = No, 1 = Yes")
  .addOptionalParam("address", "PredictionMarket contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const marketId = parseInt(taskArguments.market);
    const outcome = parseInt(taskArguments.outcome);

    if (outcome !== 0 && outcome !== 1) {
      throw new Error("Outcome must be 0 (No) or 1 (Yes)");
    }

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    console.log(`\n⚖️  Resolving Market ${marketId}...`);
    console.log(`Contract: ${deployment.address}`);
    console.log(`Outcome: ${outcome === 1 ? "✅ YES" : "❌ NO"}`);

    const signers = await ethers.getSigners();
    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    const tx = await contract.connect(signers[0]).resolveMarket(marketId, outcome);

    console.log(`⏳ Waiting for tx: ${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`✅ Market resolved successfully! (tx status: ${receipt?.status})`);

    const market = await contract.getMarket(marketId);
    console.log(`\nFinal Result: ${Number(market.outcome) === 1 ? "✅ YES" : "❌ NO"}`);
  });

/**
 * Claim reward from a market
 * Example: npx hardhat task:pm:claim-reward --market 0 --network localhost
 */
task("task:pm:claim-reward", "Claim your reward from a resolved market")
  .addParam("market", "Market ID")
  .addOptionalParam("address", "PredictionMarket contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments, fhevm } = hre;

    await fhevm.initializeCLIApi();

    const marketId = parseInt(taskArguments.market);

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    console.log(`\n💰 Claiming Reward from Market ${marketId}...`);
    console.log(`Contract: ${deployment.address}`);

    const signers = await ethers.getSigners();
    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    const tx = await contract.connect(signers[0]).claimReward(marketId);

    console.log(`⏳ Waiting for tx: ${tx.hash}...`);
    const receipt = await tx.wait();
    console.log(`✅ Reward claim initiated! (tx status: ${receipt?.status})`);

    console.log(`\n📝 Note: The reward calculation requires async decryption.`);
    console.log(`   Watch for the 'RewardClaimed' event to see your final reward amount.`);
    console.log(`   This may take a few moments...`);
  });

/**
 * List all markets
 * Example: npx hardhat task:pm:list-markets --network localhost
 */
task("task:pm:list-markets", "List all prediction markets")
  .addOptionalParam("address", "PredictionMarket contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;

    const deployment = taskArguments.address
      ? { address: taskArguments.address }
      : await deployments.get("PredictionMarket");

    const contract = await ethers.getContractAt("PredictionMarket", deployment.address);

    const marketCount = await contract.marketCount();

    console.log(`\n📊 Prediction Markets (Total: ${marketCount})`);
    console.log(`Contract: ${deployment.address}\n`);

    for (let i = 0; i < marketCount; i++) {
      const market = await contract.getMarket(i);
      const [yesCount, noCount] = await contract.getParticipantCounts(i);
      const isActive = await contract.isMarketActive(i);

      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Market #${i}`);
      console.log(`Question: ${market.question}`);
      console.log(`Status: ${isActive ? "🟢 Active" : market.resolved ? "✅ Resolved" : "⏸️  Ended"}`);
      if (market.resolved) {
        console.log(`Result: ${Number(market.outcome) === 1 ? "✅ YES" : "❌ NO"}`);
      }
      console.log(`Participants: ${Number(yesCount) + Number(noCount)} (YES: ${yesCount}, NO: ${noCount})`);
      console.log(`Ends: ${formatTime(Number(market.endTime))}`);
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  });

