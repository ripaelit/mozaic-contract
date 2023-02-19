pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ProtocolDriver.sol";
import "hardhat/console.sol";

contract PancakeSwapDriver is ProtocolDriver {
    //---------------------------------------------------------------------------
    // VARIABLES
    struct PancakeSwapDriverConfig {
        address pancakeSwapSmartRouter;
    }
    bytes32 public constant CONFIG_SLOT = keccak256("PancakeSwapDriver.config");

    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    function configDriver(bytes calldata params) public virtual override onlyOwner returns (bytes memory) {
        // Unpack into _getConfig().stgRouter, stgLpStaking, stgToken
        (address _pancakeSwapSmartRouter) = abi.decode(params, (address));
        PancakeSwapDriverConfig storage _config = _getConfig();
        _config.pancakeSwapSmartRouter = _pancakeSwapSmartRouter;
    }
    function _getConfig() internal view returns (PancakeSwapDriverConfig storage _config) {
        // pure?
        bytes32 slotAddress = CONFIG_SLOT;
        assembly {
            _config.slot := slotAddress
        }
    }

    function execute(ProtocolDriver.ActionType actionType, bytes calldata payload) virtual override public returns (bytes memory) {
        console.log("PancakeSwapDriver.execute: msg.sender:", msg.sender);
        console.log("PancakeSwapDriver.execute: this", address(this));
        bytes memory returnData;
        if (actionType == ProtocolDriver.ActionType.Swap) {
            (uint256 _amountLD, address _srcToken, address _dstToken) = abi.decode(payload, (uint256, address, address));
            returnData = _swap(_amountLD, _srcToken, _dstToken);
        }
        return returnData;
    }

    //---------------------------------------------------------------------------
    // INTERNAL

    function _swap(uint256 _amount, address _srcToken, address _dstToken) private returns (bytes memory) {
        console.log("PancakeSwapDriver._swap: msg.sender:", msg.sender);
        console.log("PancakeSwapDriver._swap: this", address(this));
        console.log("PancakeSwapDriver._swap: _getConofig():", _getConfig().pancakeSwapSmartRouter);
        // Approve
        IERC20(_srcToken).approve( _getConfig().pancakeSwapSmartRouter, _amount);

        // Swap
        (bool success, bytes memory returnData) = address( _getConfig().pancakeSwapSmartRouter).call(abi.encodeWithSignature("swap(address,address,uint256,uint256,uint8)", _srcToken, _dstToken, _amount, 0, 0));
        require(success, "Failed to access Pancakeswap smart router");
        return returnData;
    }
}