// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
// pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "../interfaces/IMozaicTokenV2.sol";
import "../interfaces/IXMozaicToken.sol";
import "../interfaces/IXMozaicTokenUsage.sol";
import "../libraries/token/oft/v2/OFTV2.sol";

/*
 * xMOZ is Mozaic's escrowed governance token obtainable by converting MOZ to it
 * It's non-transferable, except from/to whitelisted addresses
 * It can be converted back to MOZ through a vesting process
 * This contract is made to receive xMOZ deposits from users in order to allocate them to Usages (plugins) contracts
 */
contract XMozaicToken is OFTV2, ReentrancyGuard, IXMozaicToken {
    using Address for address;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IMozaicTokenV2;

    struct XMozBalance {
        uint256 allocatedAmount; // Amount of xMOZ allocated to a Usage
        uint256 redeemingAmount; // Total amount of xMOZ currently being redeemed
    }

    struct RedeemInfo {
        uint256 mozAmount; // MOZ amount to receive when vesting has ended
        uint256 xMozAmount; // xMOZ amount to redeem
        uint256 endTime;
    }

    IMozaicTokenV2 public immutable mozaicToken; // MOZ token to convert to/from

    EnumerableSet.AddressSet private _transferWhitelist; // addresses allowed to send/receive xMOZ

    mapping(address => mapping(address => uint256)) public usageApprovals; // Usage approvals to allocate xMOZ
    mapping(address => mapping(address => uint256)) public override usageAllocations; // Active xMOZ allocations to usages

    uint256 public constant MAX_DEALLOCATION_FEE = 200; // 2%
    mapping(address => uint256) public usagesDeallocationFee; // Fee paid when deallocating xMOZ

    uint256 public constant MAX_FIXED_RATIO = 100; // 100%

    // Redeeming min/max settings
    uint256 public minRedeemRatio = 50; // 1:0.5
    uint256 public mediumRedeemRatio = 75; // 1:0.75
    uint256 public maxRedeemRatio = 100; // 1:1
    uint256 public minRedeemDuration = 15 days; // 1,296,000s
    uint256 public mediumRedeemDuration = 30 days; // 2,592,000s
    uint256 public maxRedeemDuration = 45 days; // 3,888,000s

    mapping(address => XMozBalance) public xMozBalances; // User's xMOZ balances
    mapping(address => RedeemInfo[]) public userRedeems; // User's redeeming instances


    constructor(IMozaicTokenV2 mozaicToken_, address _layerZeroEndpoint, uint256 _initialSupply, uint8 _sharedDecimals) OFTV2("Mozaic escrowed token", "xMOZ", _sharedDecimals, _layerZeroEndpoint) {
        mozaicToken = mozaicToken_;
        _transferWhitelist.add(address(this));
        _mint(msg.sender, _initialSupply);
    }

    /********************************************/
    /****************** EVENTS ******************/
    /********************************************/

    event ApproveUsage(address indexed userAddress, address indexed usageAddress, uint256 amount);
    event Convert(address indexed from, address to, uint256 amount);
    event UpdateRedeemSettings(uint256 minRedeemRatio, uint256 mediumRedeemRatio, uint256 maxRedeemRatio, uint256 minRedeemDuration, uint256 mediumRedeemDuration, uint256 maxRedeemDuration);
    event UpdateDeallocationFee(address indexed usageAddress, uint256 fee);
    event SetTransferWhitelist(address account, bool add);
    event Redeem(address indexed userAddress, uint256 xMozAmount, uint256 mozAmount, uint256 duration);
    event FinalizeRedeem(address indexed userAddress, uint256 xMozAmount, uint256 mozAmount);
    event CancelRedeem(address indexed userAddress, uint256 xMozAmount);
    event Allocate(address indexed userAddress, address indexed usageAddress, uint256 amount);
    event Deallocate(address indexed userAddress, address indexed usageAddress, uint256 amount, uint256 fee);

    /***********************************************/
    /****************** MODIFIERS ******************/
    /***********************************************/

    /*
    * @dev Check if a redeem entry exists
    */
    modifier validateRedeem(address userAddress, uint256 redeemIndex) {
        require(redeemIndex < userRedeems[userAddress].length, "validateRedeem: redeem entry does not exist");
        _;
    }

    /**************************************************/
    /****************** PUBLIC VIEWS ******************/
    /**************************************************/

    /*
    * @dev Returns user's xMOZ balances
    */
    function getXMozBalance(address userAddress) external view returns (uint256 allocatedAmount, uint256 redeemingAmount) {
        XMozBalance storage balance = xMozBalances[userAddress];
        return (balance.allocatedAmount, balance.redeemingAmount);
    }

    /*
    * @dev returns redeemable MOZ for "amount" of xMOZ vested for "duration" seconds
    */
    function getMozByVestingDuration(uint256 amount, uint256 duration) public view returns (uint256) {
        uint256 ratio;
        
        if(duration < minRedeemDuration) {
            return 0;
        }
        else if(duration >= minRedeemDuration && duration < mediumRedeemDuration) {
            ratio = minRedeemRatio + (mediumRedeemRatio - minRedeemRatio) * (duration - minRedeemDuration) / (mediumRedeemDuration - minRedeemDuration);
        }
        else if(duration >= mediumRedeemDuration && duration < maxRedeemDuration) {
            ratio = mediumRedeemRatio + (maxRedeemRatio - mediumRedeemRatio) * (duration - mediumRedeemDuration) / (maxRedeemDuration - mediumRedeemDuration);
        }
        // capped to maxRedeemDuration
        else {
            ratio = maxRedeemRatio;
        }

        return amount * ratio / MAX_FIXED_RATIO;
    }

    /**
    * @dev returns quantity of "userAddress" pending redeems
    */
    function getUserRedeemsLength(address userAddress) external view returns (uint256) {
        return userRedeems[userAddress].length;
    }

    /**
    * @dev returns "userAddress" info for a pending redeem identified by "redeemIndex"
    */
    function getUserRedeem(address userAddress, uint256 redeemIndex) external view validateRedeem(userAddress, redeemIndex) returns (uint256 mozAmount, uint256 xMozAmount, uint256 endTime) {
        RedeemInfo storage _redeem = userRedeems[userAddress][redeemIndex];
        return (_redeem.mozAmount, _redeem.xMozAmount, _redeem.endTime);
    }

    /**
    * @dev returns approved xMoz to allocate from "userAddress" to "usageAddress"
    */
    function getUsageApproval(address userAddress, address usageAddress) external view returns (uint256) {
        return usageApprovals[userAddress][usageAddress];
    }

    /**
    * @dev returns allocated xMoz from "userAddress" to "usageAddress"
    */
    function getUsageAllocation(address userAddress, address usageAddress) external view returns (uint256) {
        return usageAllocations[userAddress][usageAddress];
    }

    /**
    * @dev returns length of transferWhitelist array
    */
    function transferWhitelistLength() external view returns (uint256) {
        return _transferWhitelist.length();
    }

    /**
    * @dev returns transferWhitelist array item's address for "index"
    */
    function transferWhitelist(uint256 index) external view returns (address) {
        return _transferWhitelist.at(index);
    }

    /**
    * @dev returns if "account" is allowed to send/receive xMOZ
    */
    function isTransferWhitelisted(address account) external override view returns (bool) {
        return _transferWhitelist.contains(account);
    }

    /*******************************************************/
    /****************** OWNABLE FUNCTIONS ******************/
    /*******************************************************/

    /**
    * @dev Updates all redeem ratios and durations
    *
    * Must only be called by owner
    */
    function updateRedeemSettings(uint256 minRedeemRatio_, uint256 mediumRedeemRatio_, uint256 maxRedeemRatio_, uint256 minRedeemDuration_, uint256 mediumRedeemDuration_, uint256 maxRedeemDuration_) external onlyOwner {
        require(minRedeemRatio_ <= mediumRedeemRatio_ || mediumRedeemRatio_ <= maxRedeemRatio_, "updateRedeemSettings: wrong ratio values");
        require(minRedeemDuration_ < mediumRedeemDuration_ || mediumRedeemDuration_ < maxRedeemDuration_, "updateRedeemSettings: wrong duration values");
        // should never exceed 100%
        require(maxRedeemRatio_ <= MAX_FIXED_RATIO, "updateRedeemSettings: wrong ratio values");

        minRedeemRatio = minRedeemRatio_;
        mediumRedeemRatio = mediumRedeemRatio_;
        maxRedeemRatio = maxRedeemRatio_;
        minRedeemDuration = minRedeemDuration_;
        mediumRedeemDuration = mediumRedeemDuration_;
        maxRedeemDuration = maxRedeemDuration_;

        emit UpdateRedeemSettings(minRedeemRatio_, mediumRedeemRatio_, maxRedeemRatio_, minRedeemDuration_, mediumRedeemDuration_, maxRedeemDuration_);
    }

    /**
    * @dev Updates fee paid by users when deallocating from "usageAddress"
    */
    function updateDeallocationFee(address usageAddress, uint256 fee) external onlyOwner {
        require(fee <= MAX_DEALLOCATION_FEE, "updateDeallocationFee: too high");

        usagesDeallocationFee[usageAddress] = fee;
        emit UpdateDeallocationFee(usageAddress, fee);
    }

    /**
    * @dev Adds or removes addresses from the transferWhitelist
    */
    function updateTransferWhitelist(address account, bool add) external onlyOwner {
        require(account != address(this), "updateTransferWhitelist: Cannot remove xMoz from whitelist");

        if(add) _transferWhitelist.add(account);
        else _transferWhitelist.remove(account);

        emit SetTransferWhitelist(account, add);
    }

    /*****************************************************************/
    /******************  EXTERNAL PUBLIC FUNCTIONS  ******************/
    /*****************************************************************/

    /**
    * @dev Approves "usage" address to get allocations up to "amount" of xMOZ from msg.sender
    */
    function approveUsage(IXMozaicTokenUsage usage, uint256 amount) external nonReentrant {
        require(address(usage) != address(0), "approveUsage: approve to the zero address");

        usageApprovals[msg.sender][address(usage)] = amount;
        emit ApproveUsage(msg.sender, address(usage), amount);
    }

    /**
    * @dev Convert caller's "amount" of MOZ to xMOZ
    */
    function convert(uint256 amount) external nonReentrant {
        _convert(amount, msg.sender);
    }

    /**
    * @dev Convert caller's "amount" of MOZ to xMOZ to "to" address
    */
    function convertTo(uint256 amount, address to) external override nonReentrant {
        require(address(msg.sender).isContract(), "convertTo: not allowed");
        _convert(amount, to);
    }

    /**
    * @dev Initiates redeem process (xMOZ to MOZ)
    *
    */
    function redeem(uint256 xMozAmount, uint256 duration) external nonReentrant {
        require(xMozAmount > 0, "redeem: xMozAmount cannot be null");
        require(duration >= minRedeemDuration, "redeem: duration too low");

        _transfer(msg.sender, address(this), xMozAmount);
        XMozBalance storage balance = xMozBalances[msg.sender];

        // get corresponding MOZ amount
        uint256 mozAmount = getMozByVestingDuration(xMozAmount, duration);
        emit Redeem(msg.sender, xMozAmount, mozAmount, duration);

        // if redeeming is not immediate, go through vesting process
        if(duration > 0) {
            // add to SBT total
            balance.redeemingAmount += xMozAmount;

            // add redeeming entry
            userRedeems[msg.sender].push(RedeemInfo(mozAmount, xMozAmount, _currentBlockTimestamp() + duration));
        } else {
            // immediately redeem for MOZ
            _finalizeRedeem(msg.sender, xMozAmount, mozAmount);
        }
    }

    /**
    * @dev Finalizes redeem process when vesting duration has been reached
    *
    * Can only be called by the redeem entry owner
    */
    function finalizeRedeem(uint256 redeemIndex) external nonReentrant validateRedeem(msg.sender, redeemIndex) {
        XMozBalance storage balance = xMozBalances[msg.sender];
        RedeemInfo storage _redeem = userRedeems[msg.sender][redeemIndex];
        require(_currentBlockTimestamp() >= _redeem.endTime, "finalizeRedeem: vesting duration has not ended yet");

        // remove from SBT total
        balance.redeemingAmount -= _redeem.xMozAmount;
        _finalizeRedeem(msg.sender, _redeem.xMozAmount, _redeem.mozAmount);

        // remove redeem entry
        _deleteRedeemEntry(redeemIndex);
    }

    /**
    * @dev Cancels an ongoing redeem entry
    *
    * Can only be called by its owner
    */
    function cancelRedeem(uint256 redeemIndex) external nonReentrant validateRedeem(msg.sender, redeemIndex) {
        XMozBalance storage balance = xMozBalances[msg.sender];
        RedeemInfo storage _redeem = userRedeems[msg.sender][redeemIndex];

        // make redeeming xMOZ available again
        balance.redeemingAmount -= _redeem.xMozAmount;
        _transfer(address(this), msg.sender, _redeem.xMozAmount);

        emit CancelRedeem(msg.sender, _redeem.xMozAmount);

        // remove redeem entry
        _deleteRedeemEntry(redeemIndex);
    }


    /**
    * @dev Allocates caller's "amount" of available xMOZ to "usageAddress" contract
    *
    * args specific to usage contract must be passed into "usageData"
    */
    function allocate(address usageAddress, uint256 amount, bytes calldata usageData) external nonReentrant {
        _allocate(msg.sender, usageAddress, amount);

        // allocates xMOZ to usageContract
        IXMozaicTokenUsage(usageAddress).allocate(msg.sender, amount, usageData);
    }

    /**
    * @dev Allocates "amount" of available xMOZ from "userAddress" to caller (ie usage contract)
    *
    * Caller must have an allocation approval for the required xMOZ from "userAddress"
    */
    function allocateFromUsage(address userAddress, uint256 amount) external override nonReentrant {
        _allocate(userAddress, msg.sender, amount);
    }

    /**
    * @dev Deallocates caller's "amount" of available xMOZ from "usageAddress" contract
    *
    * args specific to usage contract must be passed into "usageData"
    */
    function deallocate(address usageAddress, uint256 amount, bytes calldata usageData) external nonReentrant {
        _deallocate(msg.sender, usageAddress, amount);

        // deallocate xMOZ into usageContract
        IXMozaicTokenUsage(usageAddress).deallocate(msg.sender, amount, usageData);
    }

    /**
    * @dev Deallocates "amount" of allocated xMOZ belonging to "userAddress" from caller (ie usage contract)
    *
    * Caller can only deallocate xMOZ from itself
    */
    function deallocateFromUsage(address userAddress, uint256 amount) external override nonReentrant {
        _deallocate(userAddress, msg.sender, amount);
    }

    /********************************************************/
    /****************** INTERNAL FUNCTIONS ******************/
    /********************************************************/

    /**
    * @dev Convert caller's "amount" of MOZ into xMOZ to "to"
    */
    function _convert(uint256 amount, address to) internal {
        require(amount != 0, "convert: amount cannot be null");

        // mint new xMOZ
        _mint(to, amount);

        emit Convert(msg.sender, to, amount);
        mozaicToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
    * @dev Finalizes the redeeming process for "userAddress" by transferring him "mozAmount" and removing "xMozAmount" from supply
    *
    * Any vesting check should be ran before calling this
    * MOZ excess is automatically burnt
    */
    function _finalizeRedeem(address userAddress, uint256 xMozAmount, uint256 mozAmount) internal {
        uint256 mozExcess = xMozAmount - mozAmount;

        // sends due MOZ tokens
        mozaicToken.safeTransfer(userAddress, mozAmount);

        // burns MOZ excess if any
        mozaicToken.burn(mozExcess);
        _burn(address(this), xMozAmount);

        emit FinalizeRedeem(userAddress, xMozAmount, mozAmount);
    }

    /**
    * @dev Allocates "userAddress" user's "amount" of available xMOZ to "usageAddress" contract
    *
    */
    function _allocate(address userAddress, address usageAddress, uint256 amount) internal {
        require(amount > 0, "allocate: amount cannot be null");

        XMozBalance storage balance = xMozBalances[userAddress];

        // approval checks if allocation request amount has been approved by userAddress to be allocated to this usageAddress
        uint256 approvedXMoz = usageApprovals[userAddress][usageAddress];
        require(approvedXMoz >= amount, "allocate: non authorized amount");

        // remove allocated amount from usage's approved amount
        usageApprovals[userAddress][usageAddress] = approvedXMoz - amount;

        // update usage's allocatedAmount for userAddress
        usageAllocations[userAddress][usageAddress] += amount;

        // adjust user's xMOZ balances
        balance.allocatedAmount += amount;
        _transfer(userAddress, address(this), amount);

        emit Allocate(userAddress, usageAddress, amount);
    }

    /**
    * @dev Deallocates "amount" of available xMOZ to "usageAddress" contract
    *
    * args specific to usage contract must be passed into "usageData"
    */
    function _deallocate(address userAddress, address usageAddress, uint256 amount) internal {
        require(amount > 0, "deallocate: amount cannot be null");

        // check if there is enough allocated xMOZ to this usage to deallocate
        uint256 allocatedAmount = usageAllocations[userAddress][usageAddress];
        require(allocatedAmount >= amount, "deallocate: non authorized amount");

        // remove deallocated amount from usage's allocation
        usageAllocations[userAddress][usageAddress] = allocatedAmount - amount;

        uint256 deallocationFeeAmount = amount * usagesDeallocationFee[usageAddress] / 10000;

        // adjust user's xMOZ balances
        XMozBalance storage balance = xMozBalances[userAddress];
        balance.allocatedAmount -= amount;
        _transfer(address(this), userAddress, amount - deallocationFeeAmount);
        // burn corresponding MOZ and XMOZ
        mozaicToken.burn(deallocationFeeAmount);
        _burn(address(this), deallocationFeeAmount);

        emit Deallocate(userAddress, usageAddress, amount, deallocationFeeAmount);
    }

    function _deleteRedeemEntry(uint256 index) internal {
        userRedeems[msg.sender][index] = userRedeems[msg.sender][userRedeems[msg.sender].length - 1];
        userRedeems[msg.sender].pop();
    }

    /**
    * @dev Hook override to forbid transfers except from whitelisted addresses and minting
    */
    function _beforeTokenTransfer(address from, address to, uint256 /*amount*/) internal view override {
        require(from == address(0) || _transferWhitelist.contains(from) || _transferWhitelist.contains(to), "transfer: not allowed");
    }

    /**
    * @dev Utility function to get the current block timestamp
    */
    function _currentBlockTimestamp() internal view virtual returns (uint256) {
        /* solhint-disable not-rely-on-time */
        return block.timestamp;
    }

}