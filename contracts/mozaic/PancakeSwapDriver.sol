pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ProtocolDriver.sol";
import "hardhat/console.sol";

contract PancakeSwapDriver is ProtocolDriver {
    //---------------------------------------------------------------------------
    // VARIABLES
    address public protocol;

    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
    ) {
    }

    function configDriver(bytes calldata params) public virtual override onlyOwner returns (bytes memory) {
        protocol = abi.decode(params, (address));
    }

    function execute(ProtocolDriver.ActionType actionType, bytes calldata payload) virtual override public returns (bytes memory) {
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
        // Approve
        IERC20(_srcToken).approve(protocol, _amount);

        // Swap
        (bool success, bytes memory returnData) = address(protocol).call(abi.encodeWithSignature("swap(address,address,uint256,uint256,uint8)", _srcToken, _dstToken, _amount, 0, 0));
        require(success, "Failed to access Pancakeswap smart router");
        return returnData;
    }
}