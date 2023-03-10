// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "./ProtocolDriver.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
        bytes32 slotAddress = CONFIG_SLOT;
        assembly {
            _config.slot := slotAddress
        }
    }

    function execute(ProtocolDriver.ActionType actionType, bytes calldata payload) virtual override public returns (bytes memory response) {
        if (actionType == ProtocolDriver.ActionType.Swap) {
            (uint256 _amountLD, address _srcToken, address _dstToken) = abi.decode(payload, (uint256, address, address));
            response = _swap(_amountLD, _srcToken, _dstToken);
        }
        else if (actionType == ProtocolDriver.ActionType.GetPriceMil) {
            response = _getStargatePriceMil();
        }
        else {
            revert ("Undefined Action");
        }
    }

    //---------------------------------------------------------------------------
    // INTERNAL

    function _swap(uint256 _amount, address _srcToken, address _dstToken) private returns (bytes memory) {
        // Approve
        IERC20(_srcToken).approve( _getConfig().pancakeSwapSmartRouter, _amount);

        // Swap
        (bool success, bytes memory response) = address(_getConfig().pancakeSwapSmartRouter).call(abi.encodeWithSignature("swap(address,address,uint256,uint256,uint8)", _srcToken, _dstToken, _amount, 0, 0));
        require(success, abi.decode(response, (string)));
    }

    function _getStargatePriceMil() internal view returns (bytes memory) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        bytes memory returnData = abi.encode((1000000));
        return returnData;
    }
}