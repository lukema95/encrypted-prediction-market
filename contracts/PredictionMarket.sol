// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "./tokens/IERC7984.sol";

/// @title Encrypted Prediction Market
/// @author @lukema95
/// @notice A binary prediction market where bet amounts are encrypted for privacy
/// @dev Uses FHEVM for encrypted state and async decryption for settlements
contract PredictionMarket is SepoliaConfig {
    // ========== State Variables ==========

    /// @notice Market structure containing all market information
    struct Market {
        uint256 id;
        string question;
        uint256 endTime;
        uint256 resolutionTime;
        address creator;
        bool resolved;
        uint8 outcome; // 0 = No, 1 = Yes, 255 = Unresolved
        uint256 createdAt;
    }

    /// @notice User bet structure with encrypted amount
    struct Bet {
        euint64 amount;
        uint8 prediction; // 0 = No, 1 = Yes
        bool claimed;
        bool exists;
    }

    /// @notice Pending claim structure for async decryption
    struct PendingClaim {
        uint256 marketId;
        address user;
    }

    IERC7984 public immutable bettingToken;
    
    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Bet)) public userBets;
    mapping(uint256 => euint64) public totalYesBets;
    mapping(uint256 => euint64) public totalNoBets;
    mapping(uint256 => uint256) public yesCount;
    mapping(uint256 => uint256) public noCount;
    
    // User deposits: user => encrypted balance
    mapping(address => euint64) public deposits;

    // Decryption tracking
    mapping(uint256 => PendingClaim) public pendingClaims;

    // Constants
    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 30 days;
    uint256 public constant MIN_RESOLUTION_DELAY = 1 hours;

    // ========== Events ==========

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        uint256 endTime,
        uint256 resolutionTime,
        address indexed creator
    );

    event BetPlaced(uint256 indexed marketId, address indexed user, uint8 prediction);

    event MarketResolved(uint256 indexed marketId, uint8 outcome, address indexed resolver);

    event RewardClaimRequested(uint256 indexed marketId, address indexed user, uint256 requestId);

    event RewardClaimed(
        uint256 indexed marketId, 
        address indexed user, 
        uint256 amount,
        uint256 decryptedRewardNumerator,
        uint256 decryptedWinningPool
    );

    event MarketCancelled(uint256 indexed marketId, address indexed canceller);
    
    event Deposited(address indexed user, euint64 amount);
    
    event Withdrawn(address indexed user, euint64 amount);

    // ========== Errors ==========

    error InvalidDuration();
    error InvalidResolutionDelay();
    error MarketNotFound();
    error BettingClosed();
    error AlreadyResolved();
    error InvalidPrediction();
    error AlreadyBet();
    error NotResolved();
    error WrongPrediction();
    error AlreadyClaimed();
    error OnlyCreator();
    error TooEarlyToResolve();
    error InvalidOutcome();
    error BetNotFound();
    error NoWinners();
    error TransferFailed();
    error InsufficientBalance();

    // ========== Constructor ==========

    /// @notice Initialize the prediction market with a betting token
    /// @param _bettingToken The ERC-7984 confidential token used for betting
    constructor(address _bettingToken) {
        require(_bettingToken != address(0), "Invalid token address");
        bettingToken = IERC7984(_bettingToken);
    }

    // ========== Core Functions ==========

    /// @notice Create a new prediction market
    /// @param question The market question
    /// @param durationHours How long betting will be open (in hours)
    /// @param resolutionDelayHours Delay after betting ends before resolution (in hours)
    /// @return marketId The ID of the created market
    function createMarket(
        string calldata question,
        uint256 durationHours,
        uint256 resolutionDelayHours
    ) external returns (uint256) {
        uint256 duration = durationHours * 1 hours;
        uint256 resolutionDelay = resolutionDelayHours * 1 hours;

        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
        if (resolutionDelay < MIN_RESOLUTION_DELAY) revert InvalidResolutionDelay();

        uint256 marketId = marketCount++;

        markets[marketId] = Market({
            id: marketId,
            question: question,
            endTime: block.timestamp + duration,
            resolutionTime: block.timestamp + duration + resolutionDelay,
            creator: msg.sender,
            resolved: false,
            outcome: 255,
            createdAt: block.timestamp
        });

        // Initialize encrypted totals to zero
        totalYesBets[marketId] = FHE.asEuint64(0);
        totalNoBets[marketId] = FHE.asEuint64(0);
        
        // Grant permissions for future operations
        FHE.allowThis(totalYesBets[marketId]);
        FHE.allowThis(totalNoBets[marketId]);

        emit MarketCreated(marketId, question, markets[marketId].endTime, markets[marketId].resolutionTime, msg.sender);

        return marketId;
    }

    /// @notice Place an encrypted bet on a market
    /// @param marketId The market to bet on
    /// @param prediction The prediction (0 = No, 1 = Yes)
    /// @param encryptedAmount The encrypted bet amount
    /// @param inputProof The proof for the encrypted input
    /// @dev User must have set this contract as operator via token.setOperator()
    ///      The contract will transfer tokens from user using confidentialTransferFrom
    function placeBet(
        uint256 marketId,
        uint8 prediction,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external {
        Market storage market = markets[marketId];

        if (market.createdAt == 0) revert MarketNotFound();
        if (block.timestamp >= market.endTime) revert BettingClosed();
        if (market.resolved) revert AlreadyResolved();
        if (prediction > 1) revert InvalidPrediction();
        if (userBets[marketId][msg.sender].exists) revert AlreadyBet();

        // Transfer tokens from user to contract 
        // Token contract will handle FHE.fromExternal validation
        euint64 amount = bettingToken.confidentialTransferFrom(
            msg.sender,
            address(this),
            encryptedAmount,
            inputProof
        );
        
        // Set ACL for transferred amount
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);

        // Store user bet
        userBets[marketId][msg.sender] = Bet({
            amount: amount,
            prediction: prediction,
            claimed: false,
            exists: true
        });

        // Update encrypted totals
        if (prediction == 1) {
            totalYesBets[marketId] = FHE.add(totalYesBets[marketId], amount);
            FHE.allowThis(totalYesBets[marketId]);
            yesCount[marketId]++;
        } else {
            totalNoBets[marketId] = FHE.add(totalNoBets[marketId], amount);
            FHE.allowThis(totalNoBets[marketId]);
            noCount[marketId]++;
        }

        emit BetPlaced(marketId, msg.sender, prediction);
    }


    /// @notice Resolve a market with the final outcome
    /// @param marketId The market to resolve
    /// @param outcome The outcome (0 = No, 1 = Yes)
    function resolveMarket(uint256 marketId, uint8 outcome) external {
        Market storage market = markets[marketId];

        if (market.createdAt == 0) revert MarketNotFound();
        if (msg.sender != market.creator) revert OnlyCreator();
        if (block.timestamp < market.resolutionTime) revert TooEarlyToResolve();
        if (market.resolved) revert AlreadyResolved();
        if (outcome > 1) revert InvalidOutcome();

        market.resolved = true;
        market.outcome = outcome;

        emit MarketResolved(marketId, outcome, msg.sender);
    }

    /// @notice Request to claim reward (initiates async decryption)
    /// @param marketId The market to claim from
    function claimReward(uint256 marketId) external {
        Market storage market = markets[marketId];
        Bet storage bet = userBets[marketId][msg.sender];

        if (market.createdAt == 0) revert MarketNotFound();
        if (!market.resolved) revert NotResolved();
        if (!bet.exists) revert BetNotFound();
        if (bet.prediction != market.outcome) revert WrongPrediction();
        if (bet.claimed) revert AlreadyClaimed();

        // Check if there are winners
        uint256 winnerCount = market.outcome == 1 ? yesCount[marketId] : noCount[marketId];
        if (winnerCount == 0) revert NoWinners();

        // Mark as claimed to prevent re-entrancy
        bet.claimed = true;

        // Calculate reward
        euint64 winningPool = market.outcome == 1 ? totalYesBets[marketId] : totalNoBets[marketId];
        euint64 losingPool = market.outcome == 1 ? totalNoBets[marketId] : totalYesBets[marketId];
        euint64 totalPool = FHE.add(winningPool, losingPool);

        // Each winner gets: (their bet / total winning bets) * total pool
        // But this requires division, so we'll decrypt the total pool and winning pool
        // reward_numerator = userBet * totalPool
        euint64 rewardNumerator = FHE.mul(bet.amount, totalPool);
        FHE.allowThis(rewardNumerator); // Allow contract to access the result

        // We need to decrypt winning pool for division
        // Store pending claim for callback
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(rewardNumerator); 
        cts[1] = FHE.toBytes32(winningPool);

        uint256 requestId = FHE.requestDecryption(cts, this.finalizeReward.selector);

        pendingClaims[requestId] = PendingClaim({marketId: marketId, user: msg.sender});

        emit RewardClaimRequested(marketId, msg.sender, requestId);
    }

    /// @notice Callback function for async decryption of rewards
    /// @param requestId The decryption request ID
    /// @param cleartexts The decrypted values (rewardNumerator, winningPool)
    /// @param decryptionProof The decryption proof from KMS
    function finalizeReward(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory decryptionProof
    ) public {
        // Verify signatures
        FHE.checkSignatures(requestId, cleartexts, decryptionProof);

        PendingClaim memory claim = pendingClaims[requestId];

        // Decode the decrypted values using ABI decode (official FHEVM way)
        // cleartexts contains ABI-encoded (uint64, uint64) values
        (uint64 decryptedRewardNumerator, uint64 decryptedWinningPool) = abi.decode(cleartexts, (uint64, uint64));

        // Calculate final reward
        // Each winner gets: (their bet / total winning bets) * total pool
        // reward = (userBet * totalPool) / winningPool
        uint256 finalReward = 0;
        if (decryptedWinningPool > 0) {
            uint256 precisionReward = (uint256(decryptedRewardNumerator) * 100000) / uint256(decryptedWinningPool);
            finalReward = precisionReward / 100000;
        }

        // Transfer encrypted tokens to winner
        if (finalReward > 0) {
            euint64 encryptedReward = FHE.asEuint64(uint64(finalReward));
            FHE.allowThis(encryptedReward);
            FHE.allow(encryptedReward, claim.user);
            FHE.allow(encryptedReward, address(bettingToken)); // Allow token contract to access
            
            euint64 transferred = bettingToken.confidentialTransfer(claim.user, encryptedReward);
        }

        emit RewardClaimed(
            claim.marketId, 
            claim.user, 
            finalReward,
            decryptedRewardNumerator,
            decryptedWinningPool
        );

        // Clean up
        delete pendingClaims[requestId];
    }

    // ========== View Functions ==========

    /// @notice Get market details
    /// @param marketId The market ID
    /// @return market The market struct
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    /// @notice Get user's bet information (prediction and claim status)
    /// @param marketId The market ID
    /// @param user The user address
    /// @return prediction The user's prediction
    /// @return claimed Whether the reward has been claimed
    /// @return exists Whether a bet exists
    function getUserBet(
        uint256 marketId,
        address user
    ) external view returns (uint8 prediction, bool claimed, bool exists) {
        Bet memory bet = userBets[marketId][user];
        return (bet.prediction, bet.claimed, bet.exists);
    }

    /// @notice Get encrypted bet amount (user can decrypt their own)
    /// @param marketId The market ID
    /// @param user The user address
    /// @return amount The encrypted bet amount
    function getUserBetAmount(uint256 marketId, address user) external view returns (euint64) {
        return userBets[marketId][user].amount;
    }

    /// @notice Get participant counts
    /// @param marketId The market ID
    /// @return yesParticipants Number of Yes voters
    /// @return noParticipants Number of No voters
    function getParticipantCounts(uint256 marketId) external view returns (
        uint256 yesParticipants, 
        uint256 noParticipants
        ) {
        return (yesCount[marketId], noCount[marketId]);
    }

    /// @notice Get encrypted total bets (for frontend display)
    /// @param marketId The market ID
    /// @return encryptedYesTotal Encrypted total of Yes bets
    /// @return encryptedNoTotal Encrypted total of No bets
    function getTotalBets(uint256 marketId) external view returns (
        euint64 encryptedYesTotal, 
        euint64 encryptedNoTotal
        ) {
        return (totalYesBets[marketId], totalNoBets[marketId]);
    }

    /// @notice Check if market is active (can accept bets)
    /// @param marketId The market ID
    /// @return isActive Whether the market is active
    function isMarketActive(uint256 marketId) external view returns (bool) {
        Market memory market = markets[marketId];
        return !market.resolved && block.timestamp < market.endTime && market.createdAt > 0;
    }

    /// @notice Check if market can be resolved
    /// @param marketId The market ID
    /// @return canResolve Whether the market can be resolved
    function canResolveMarket(uint256 marketId) external view returns (bool) {
        Market memory market = markets[marketId];
        return !market.resolved && block.timestamp >= market.resolutionTime && market.createdAt > 0;
    }
}

