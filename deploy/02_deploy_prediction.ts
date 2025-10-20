import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  console.log("\n📊 Deploying PredictionMarket contract...\n");

  // Get existing ConfidentialToken (should be deployed first)
  const confidentialToken = await get("ConfidentialToken");
  console.log(`✅ Using ConfidentialToken at: ${confidentialToken.address}`);

  // Deploy PredictionMarket with ConfidentialToken
  const deployedPredictionMarket = await deploy("PredictionMarket", {
    from: deployer,
    args: [confidentialToken.address],
    log: true,
  });

  console.log(`✅ PredictionMarket deployed at: ${deployedPredictionMarket.address}`);

  console.log("\n🎉 PredictionMarket deployment complete!\n");
  console.log("📝 Contract Addresses:");
  console.log(`   - ConfidentialToken: ${confidentialToken.address}`);
  console.log(`   - PredictionMarket: ${deployedPredictionMarket.address}`);
  
  console.log("\n⚠️  Next Steps (Required before using):");
  console.log(`   1. Mint test tokens:`);
  console.log(`      npx hardhat task:pm:mint-tokens --amount 1000000 --network <network>`);
  console.log(`   2. Approve contract as operator:`);
  console.log(`      npx hardhat task:pm:approve-operator --network <network>`);
  console.log(`   3. Create your first market:`);
  console.log(`      npx hardhat task:pm:create-market --question "Your question?" --duration 24 --delay 2 --network <network>`);
  
  console.log("\n💡 Note: This uses ERC-7984 confidential tokens for fully encrypted transfers");
};

export default func;
func.id = "deploy_prediction_market";
func.tags = ["PredictionMarket"];
func.dependencies = ["ConfidentialToken"];

