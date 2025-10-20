import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network } from "hardhat";
import { PredictionMarket, PredictionMarket__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

// Helper function to increase time
async function increaseTimeTo(timestamp: bigint) {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await network.provider.send("evm_mine");
}

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  charlie: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy ConfidentialToken first
  const tokenFactory = await ethers.getContractFactory("ConfidentialToken");
  const token = await tokenFactory.deploy(
    (await ethers.getSigners())[0].address, // owner
    0, // No initial supply - will mint later
    "Test Token",
    "TEST",
    ""
  );
  const tokenAddress = await token.getAddress();

  // Deploy PredictionMarket with token address
  const factory = (await ethers.getContractFactory("PredictionMarket")) as PredictionMarket__factory;
  const predictionMarket = (await factory.deploy(tokenAddress)) as PredictionMarket;
  const predictionMarketAddress = await predictionMarket.getAddress();

  return { predictionMarket, predictionMarketAddress, token, tokenAddress };
}

describe("PredictionMarket", function () {
  let signers: Signers;
  let predictionMarket: PredictionMarket;
  let predictionMarketAddress: string;
  let token: any;
  let tokenAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2], charlie: ethSigners[3] };
  });

  beforeEach(async function () {
    // Check whether the tests are running against an FHEVM mock environment
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ predictionMarket, predictionMarketAddress, token, tokenAddress } = await deployFixture());
    
    // Mint tokens to test users using plain mint (simpler and avoids ACL issues in tests)
    await token.connect(signers.deployer).mint(signers.alice.address, 1000000);
    await token.connect(signers.deployer).mint(signers.bob.address, 1000000);
    await token.connect(signers.deployer).mint(signers.charlie.address, 1000000);
    
    // Set PredictionMarket as operator (following privacy-pool pattern)
    const block = await ethers.provider.getBlock("latest");
    const blockTimestamp = block!.timestamp;
    const futureTimestamp = blockTimestamp + 100000000; // Far future
    
    await token.connect(signers.alice).setOperator(predictionMarketAddress, futureTimestamp);
    await token.connect(signers.bob).setOperator(predictionMarketAddress, futureTimestamp);
    await token.connect(signers.charlie).setOperator(predictionMarketAddress, futureTimestamp);
  });


  describe("Market Creation", function () {
    it("should create a market successfully", async function () {
      const question = "Will ETH reach $5000 by end of year?";
      const duration = 24; // 24 hours
      const resolutionDelay = 2; // 2 hours

      const tx = await predictionMarket.connect(signers.alice).createMarket(question, duration, resolutionDelay);
      await tx.wait();

      const market = await predictionMarket.getMarket(0);

      expect(market.id).to.equal(0);
      expect(market.question).to.equal(question);
      expect(market.creator).to.equal(signers.alice.address);
      expect(market.resolved).to.equal(false);
      expect(market.outcome).to.equal(255); // Unresolved
    });

    it("should increment market count", async function () {
      const initialCount = await predictionMarket.marketCount();

      await predictionMarket.connect(signers.alice).createMarket("Question 1?", 24, 2);
      await predictionMarket.connect(signers.bob).createMarket("Question 2?", 48, 3);

      const finalCount = await predictionMarket.marketCount();
      expect(finalCount).to.equal(initialCount + 2n);
    });

    it("should revert if duration is too short", async function () {
      const duration = 0; // Less than MIN_DURATION
      const resolutionDelay = 2;

      await expect(predictionMarket.createMarket("Question?", duration, resolutionDelay)).to.be.revertedWithCustomError(
        predictionMarket,
        "InvalidDuration",
      );
    });

    it("should revert if resolution delay is too short", async function () {
      const duration = 24;
      const resolutionDelay = 0; // Less than MIN_RESOLUTION_DELAY

      await expect(predictionMarket.createMarket("Question?", duration, resolutionDelay)).to.be.revertedWithCustomError(
        predictionMarket,
        "InvalidResolutionDelay",
      );
    });
  });

  describe("Placing Bets", function () {
    let marketId: number;

    beforeEach(async function () {
      // Create a test market
      const tx = await predictionMarket.connect(signers.alice).createMarket("Test Market?", 24, 2);
      await tx.wait();
      marketId = 0;
    });

    it("should allow placing a bet with encrypted amount", async function () {
      const betAmount = 100;
      const prediction = 1; // Yes

      // Place bet directly (contract will transfer tokens)
      const betInput = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(betAmount)
        .encrypt();

      const tx = await predictionMarket
        .connect(signers.bob)
        .placeBet(marketId, prediction, betInput.handles[0], betInput.inputProof);
      await tx.wait();

      const [userPrediction, claimed, exists] = await predictionMarket.getUserBet(marketId, signers.bob.address);

      expect(userPrediction).to.equal(prediction);
      expect(claimed).to.equal(false);
      expect(exists).to.equal(true);
      
      // Check participant count
      const [yesCount, noCount] = await predictionMarket.getParticipantCounts(marketId);
      expect(yesCount).to.equal(1);
      expect(noCount).to.equal(0);
    });

    it("should decrypt user's own bet amount", async function () {
      const betAmount = 100;
      const prediction = 1;

      const encryptedBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(betAmount)
        .encrypt();

      await predictionMarket
        .connect(signers.bob)
        .placeBet(marketId, prediction, encryptedBet.handles[0], encryptedBet.inputProof);

      const encryptedAmount = await predictionMarket.getUserBetAmount(marketId, signers.bob.address);
      const decryptedAmount = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encryptedAmount,
        predictionMarketAddress,
        signers.bob,
      );

      expect(decryptedAmount).to.equal(betAmount);
    });

    it("should allow multiple users to bet on different outcomes", async function () {
      const aliceBet = 100;
      const bobBet = 150;
      const charlieBet = 75;

      // Alice bets YES
      const encryptedAliceBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(aliceBet)
        .encrypt();
      await predictionMarket
        .connect(signers.alice)
        .placeBet(marketId, 1, encryptedAliceBet.handles[0], encryptedAliceBet.inputProof);

      // Bob bets NO
      const encryptedBobBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(bobBet)
        .encrypt();
      await predictionMarket
        .connect(signers.bob)
        .placeBet(marketId, 0, encryptedBobBet.handles[0], encryptedBobBet.inputProof);

      // Charlie bets YES
      const encryptedCharlieBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(charlieBet)
        .encrypt();
      await predictionMarket
        .connect(signers.charlie)
        .placeBet(marketId, 1, encryptedCharlieBet.handles[0], encryptedCharlieBet.inputProof);

      const [yesCount, noCount] = await predictionMarket.getParticipantCounts(marketId);
      expect(yesCount).to.equal(2);
      expect(noCount).to.equal(1);
    });

    it("should revert if user tries to bet twice", async function () {
      const betAmount = 100;
      
      const encryptedBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(betAmount)
        .encrypt();

      await predictionMarket
        .connect(signers.bob)
        .placeBet(marketId, 1, encryptedBet.handles[0], encryptedBet.inputProof);

      // Try to bet again
      const encryptedBet2 = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(betAmount)
        .encrypt();

      await expect(
        predictionMarket.connect(signers.bob).placeBet(marketId, 0, encryptedBet2.handles[0], encryptedBet2.inputProof),
      ).to.be.revertedWithCustomError(predictionMarket, "AlreadyBet");
    });

    it("should revert if prediction is invalid", async function () {
      const betAmount = 100;
      const invalidPrediction = 2; // Should be 0 or 1

      const encryptedBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(betAmount)
        .encrypt();

      await expect(
        predictionMarket
          .connect(signers.bob)
          .placeBet(marketId, invalidPrediction, encryptedBet.handles[0], encryptedBet.inputProof),
      ).to.be.revertedWithCustomError(predictionMarket, "InvalidPrediction");
    });

    it("should revert if betting after end time", async function () {
      const betAmount = 100;

      // Fast forward past end time
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.endTime + 1n);

      const encryptedBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(betAmount)
        .encrypt();

      await expect(
        predictionMarket.connect(signers.bob).placeBet(marketId, 1, encryptedBet.handles[0], encryptedBet.inputProof),
      ).to.be.revertedWithCustomError(predictionMarket, "BettingClosed");
    });
  });

  describe("Market Resolution", function () {
    let marketId: number;

    beforeEach(async function () {
      // Create and populate a test market
      const tx = await predictionMarket.connect(signers.alice).createMarket("Test Market?", 1, 1); // 1 hour each
      await tx.wait();
      marketId = 0;

      // Alice bets YES
      const aliceBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(100)
        .encrypt();
      await predictionMarket
        .connect(signers.alice)
        .placeBet(marketId, 1, aliceBet.handles[0], aliceBet.inputProof);

      // Bob bets NO
      const bobBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(150)
        .encrypt();
      await predictionMarket.connect(signers.bob).placeBet(marketId, 0, bobBet.handles[0], bobBet.inputProof);
    });

    it("should resolve market with outcome YES", async function () {
      const market = await predictionMarket.getMarket(marketId);

      // Fast forward to resolution time
      await increaseTimeTo(market.resolutionTime);

      const tx = await predictionMarket.connect(signers.alice).resolveMarket(marketId, 1); // YES
      await tx.wait();

      const resolvedMarket = await predictionMarket.getMarket(marketId);
      expect(resolvedMarket.resolved).to.equal(true);
      expect(resolvedMarket.outcome).to.equal(1);
    });

    it("should resolve market with outcome NO", async function () {
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.resolutionTime);

      const tx = await predictionMarket.connect(signers.alice).resolveMarket(marketId, 0); // NO
      await tx.wait();

      const resolvedMarket = await predictionMarket.getMarket(marketId);
      expect(resolvedMarket.resolved).to.equal(true);
      expect(resolvedMarket.outcome).to.equal(0);
    });

    it("should revert if non-creator tries to resolve", async function () {
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.resolutionTime);

      await expect(predictionMarket.connect(signers.bob).resolveMarket(marketId, 1)).to.be.revertedWithCustomError(
        predictionMarket,
        "OnlyCreator",
      );
    });

    it("should revert if trying to resolve before resolution time", async function () {
      await expect(predictionMarket.connect(signers.alice).resolveMarket(marketId, 1)).to.be.revertedWithCustomError(
        predictionMarket,
        "TooEarlyToResolve",
      );
    });

    it("should revert if trying to resolve twice", async function () {
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.resolutionTime);

      await predictionMarket.connect(signers.alice).resolveMarket(marketId, 1);

      await expect(predictionMarket.connect(signers.alice).resolveMarket(marketId, 0)).to.be.revertedWithCustomError(
        predictionMarket,
        "AlreadyResolved",
      );
    });
  });

  describe("View Functions", function () {
    let marketId: number;

    beforeEach(async function () {
      const tx = await predictionMarket.connect(signers.alice).createMarket("Test Market?", 24, 2);
      await tx.wait();
      marketId = 0;
    });

    it("should check if market is active", async function () {
      const isActive = await predictionMarket.isMarketActive(marketId);
      expect(isActive).to.equal(true);

      // Fast forward past end time
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.endTime + 1n);

      const isActiveAfter = await predictionMarket.isMarketActive(marketId);
      expect(isActiveAfter).to.equal(false);
    });

    it("should check if market can be resolved", async function () {
      const canResolve = await predictionMarket.canResolveMarket(marketId);
      expect(canResolve).to.equal(false);

      // Fast forward to resolution time
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.resolutionTime);

      const canResolveAfter = await predictionMarket.canResolveMarket(marketId);
      expect(canResolveAfter).to.equal(true);
    });

    it("should return correct participant counts", async function () {
      // Initially no participants
      let [yesCount, noCount] = await predictionMarket.getParticipantCounts(marketId);
      expect(yesCount).to.equal(0);
      expect(noCount).to.equal(0);

      // Add some bets
      const bet1 = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(100)
        .encrypt();
      await predictionMarket.connect(signers.bob).placeBet(marketId, 1, bet1.handles[0], bet1.inputProof);

      const bet2 = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(150)
        .encrypt();
      await predictionMarket.connect(signers.charlie).placeBet(marketId, 0, bet2.handles[0], bet2.inputProof);

      [yesCount, noCount] = await predictionMarket.getParticipantCounts(marketId);
      expect(yesCount).to.equal(1);
      expect(noCount).to.equal(1);
    });
  });

  describe("Claim Reward", function () {
    let marketId: number;

    beforeEach(async function () {
      // Create market
      const tx = await predictionMarket.connect(signers.deployer).createMarket("Test Market?", 1, 1);
      await tx.wait();
      marketId = 0;

      // Alice bets YES with 100
      const aliceBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(100)
        .encrypt();
      await predictionMarket
        .connect(signers.alice)
        .placeBet(marketId, 1, aliceBet.handles[0], aliceBet.inputProof);

      // Bob bets NO with 150
      const bobBet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(150)
        .encrypt();
      await predictionMarket.connect(signers.bob).placeBet(marketId, 0, bobBet.handles[0], bobBet.inputProof);

      // Resolve market
      const market = await predictionMarket.getMarket(marketId);
      await increaseTimeTo(market.resolutionTime);
      await predictionMarket.connect(signers.deployer).resolveMarket(marketId, 1); // YES wins
    });

    it("should allow winner to claim reward", async function () {
      // Alice won (predicted YES)
      const tx = await predictionMarket.connect(signers.alice).claimReward(marketId);
      await expect(tx).to.emit(predictionMarket, "RewardClaimRequested");
    });

    it("should revert if loser tries to claim", async function () {
      // Bob lost (predicted NO, but YES won)
      await expect(predictionMarket.connect(signers.bob).claimReward(marketId)).to.be.revertedWithCustomError(
        predictionMarket,
        "WrongPrediction",
      );
    });

    it("should revert if market is not resolved", async function () {
      // Create new unresolved market
      const tx = await predictionMarket.connect(signers.deployer).createMarket("New Market?", 24, 2);
      await tx.wait();
      const newMarketId = 1;

      const bet = await fhevm
        .createEncryptedInput(tokenAddress, predictionMarketAddress)
        .add64(100)
        .encrypt();
      await predictionMarket.connect(signers.alice).placeBet(newMarketId, 1, bet.handles[0], bet.inputProof);

      await expect(predictionMarket.connect(signers.alice).claimReward(newMarketId)).to.be.revertedWithCustomError(
        predictionMarket,
        "NotResolved",
      );
    });

    it("should revert if user didn't bet", async function () {
      await expect(predictionMarket.connect(signers.charlie).claimReward(marketId)).to.be.revertedWithCustomError(
        predictionMarket,
        "BetNotFound",
      );
    });
  });
});
