import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("\n💰 Deploying ConfidentialToken contract...\n");

  const deployed = await deploy("ConfidentialToken", {
    from: deployer,
    args: [
      deployer,                  // owner
      0,                         // No initial supply - use mint() after deployment
      "Confidential Test Token", // name
      "CTT",                     // symbol
      "",                        // tokenURI
    ],
    log: true,
  });

  console.log(`✅ ConfidentialToken deployed at: ${deployed.address}`);
  console.log(`   Owner: ${deployer}`);
  console.log(`   Name: Confidential Test Token`);
  console.log(`   Symbol: CTT`);
  console.log(`   Initial Supply: 0 (use mint() to create tokens)`);
  
  console.log("\n💡 This is an ERC-7984 confidential token with FHE encryption");
};

export default func;
func.id = "deploy_confidential_token";
func.tags = ["ConfidentialToken"];

