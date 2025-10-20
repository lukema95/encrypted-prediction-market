// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "./tokens/ERC7984.sol";

/**
 * @title ConfidentialToken
 * @notice ERC-7984 compliant confidential token for prediction markets
 * @dev Extends the ERC7984 standard with minting/burning capabilities
 *      Uses Ownable2Step for secure ownership transfer
 * 
 * Based on: https://docs.zama.ai/protocol/examples/openzeppelin-confidential-contracts/erc7984/erc7984-tutorial
 */
contract ConfidentialToken is SepoliaConfig, ERC7984, Ownable2Step {
    
    /**
     * @notice Deploy a new confidential token
     * @param owner_ Initial owner address
     * @param initialSupply Initial supply to mint to owner (in base units)
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param tokenURI_ Token metadata URI
     * 
     * @dev The initial supply is minted with a clear (non-encrypted) amount during deployment.
     *      All subsequent transfers will be fully encrypted, preserving privacy.
     */
    constructor(
        address owner_,
        uint64 initialSupply,
        string memory name_,
        string memory symbol_,
        string memory tokenURI_
    ) ERC7984(name_, symbol_, tokenURI_) Ownable(owner_) {
        if (initialSupply > 0) {
            euint64 encryptedAmount = FHE.asEuint64(initialSupply);
            _mint(owner_, encryptedAmount);
        }
    }
    
    // ========== Minting Functions ==========
    
    /**
     * @notice Mint tokens with a visible (clear) amount
     * @param to Recipient address
     * @param amount Amount to mint (plaintext, will be encrypted)
     * 
     * @dev Prefer this for public/tokenomics-driven mints where transparency is desired
     *      (e.g., scheduled emissions). The minted amount is visible in calldata.
     *      
     *      Privacy caveat: Use confidentialMint for complete privacy.
     *      
     *      Access control: Uses onlyOwner. Consider role-based access via AccessControl
     *      for multi-signer workflows.
     */
    function mint(address to, uint64 amount) external onlyOwner {
        euint64 encryptedAmount = FHE.asEuint64(amount);
        _mint(to, encryptedAmount);
        // Critical: Allow token contract to access the minted balance for future transfers
        euint64 balance = confidentialBalanceOf(to);
        FHE.allowThis(balance);
        FHE.allow(balance, address(this));
    }
    
    /**
     * @notice Mint tokens with an encrypted amount for enhanced privacy
     * @param to Recipient address
     * @param encryptedAmount Encrypted amount to mint
     * @param inputProof Proof for the encrypted input
     * @return transferred The encrypted amount that was minted
     * 
     * @dev Inputs (encryptedAmount and inputProof) are produced off-chain with the SDK.
     *      Always validate and revert on malformed inputs.
     *      
     *      Gas considerations: Confidential operations cost more gas; batch mints
     *      sparingly and prefer fewer larger mints to reduce overhead.
     *      
     *      Auditing: While amounts stay private, you still get a verifiable audit
     *      trail of mints (timestamps, sender, recipient).
     *      
     * Example (Hardhat SDK):
     *   const enc = await fhevm
     *     .createEncryptedInput(await token.getAddress(), owner.address)
     *     .add64(1_000)
     *     .encrypt();
     *   await token.confidentialMint(recipient.address, enc.handles[0], enc.inputProof);
     */
    function confidentialMint(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external onlyOwner returns (euint64 transferred) {
        transferred = _mint(to, FHE.fromExternal(encryptedAmount, inputProof));
        // Critical: Allow token contract to access the minted balance for future transfers
        euint64 balance = confidentialBalanceOf(to);
        FHE.allowThis(balance);
        FHE.allow(balance, address(this));
        return transferred;
    }
    
    // ========== Burning Functions ==========
    
    /**
     * @notice Burn tokens with a visible (clear) amount
     * @param from Address to burn from
     * @param amount Amount to burn (plaintext, will be encrypted)
     * 
     * @dev Authorization: Burning from arbitrary accounts is powerful; consider
     *      stronger controls (roles, multisig, timelocks) or user-consented burns.
     */
    function burn(address from, uint64 amount) external onlyOwner {
        _burn(from, FHE.asEuint64(amount));
    }
    
    /**
     * @notice Burn tokens with an encrypted amount
     * @param from Address to burn from
     * @param encryptedAmount Encrypted amount to burn
     * @param inputProof Proof for the encrypted input
     * @return transferred The encrypted amount that was burned
     * 
     * @dev Error surfaces: Expect balance-like failures if encrypted amount exceeds
     *      balance; test both success and revert paths.
     *      
     * Example (Hardhat SDK):
     *   const enc = await fhevm
     *     .createEncryptedInput(await token.getAddress(), owner.address)
     *     .add64(250)
     *     .encrypt();
     *   await token.confidentialBurn(holder.address, enc.handles[0], enc.inputProof);
     */
    function confidentialBurn(
        address from,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external onlyOwner returns (euint64 transferred) {
        return _burn(from, FHE.fromExternal(encryptedAmount, inputProof));
    }
    
    // ========== Total Supply Visibility ==========
    
    /**
     * @notice Override _update to grant owner permission to view total supply
     * @dev What this does: Grants the owner permission to decrypt the latest total
     *      supply handle after every state-changing update.
     *      
     *      Operational model: The owner can call confidentialTotalSupply() and use
     *      their off-chain key material to decrypt the returned handle.
     *      
     *      Security considerations:
     *      - If ownership changes, only the new owner can decrypt going forward.
     *      - With Ownable2Step, this function automatically allows the current owner().
     *      - Be mindful of compliance: granting supply visibility may be considered
     *        privileged access; document who holds the key and why.
     *      
     *      Alternatives: If you want organization-wide access, grant via a dedicated
     *      admin contract that holds decryption authority instead of a single EOA.
     */
    function _update(
        address from,
        address to,
        euint64 amount
    ) internal virtual override returns (euint64 transferred) {
        transferred = super._update(from, to, amount);
        
        // Allow owner to view total supply
        FHE.allow(confidentialTotalSupply(), owner());
        
        // Critical fix: Allow token contract to access balances for future transfers
        // This enables confidentialTransferFrom to work properly
        if (from != address(0)) {
            FHE.allow(confidentialBalanceOf(from), address(this));
        }
        if (to != address(0)) {
            FHE.allow(confidentialBalanceOf(to), address(this));
        }
    }
    
    /**
     * @notice Get token decimals
     * @return Number of decimals (6 for this implementation)
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

