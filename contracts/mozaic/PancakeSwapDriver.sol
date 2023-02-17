pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ProtocolDriver.sol";

contract PancakeSwapDriver is ProtocolDriver {
    //---------------------------------------------------------------------------
    // CONSTANTS
    address public constant PANCAKESWAP_SMART_ROUTER_ON_BSC = 0xC6665d98Efd81f47B03801187eB46cbC63F328B0;

    enum FLAG {
        STABLE_SWAP,
        V2_EXACT_IN
    }

    //---------------------------------------------------------------------------
    // VARIABLES

    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
    ) {}

    function execute(ProtocolDriver.ActionType actionType, bytes calldata payload) virtual override public onlyOwner returns (bytes memory) {
        bytes memory returnData;
        if (actionType == ProtocolDriver.ActionType.Swap) {
            (uint256 _amountLD, address _srcToken, address _dstToken) = abi.decode(payload, (uint256, address, address));
            returnData = _swap(_amountLD, IERC20(_srcToken), IERC20(_dstToken));
        }
        return returnData;
    }

    //---------------------------------------------------------------------------
    // INTERNAL

    function _swap(uint256 _amount, IERC20 _srcToken, IERC20 _dstToken) private returns (bytes memory) {
        // kevin
        uint256 minReturn = 0;
        FLAG flag = FLAG.STABLE_SWAP;
        //
        // Approve
        _srcToken.approve(PANCAKESWAP_SMART_ROUTER_ON_BSC, _amount);

        // Swap
        (bool success, bytes memory returnData) = address(PANCAKESWAP_SMART_ROUTER_ON_BSC).call(abi.encodeWithSignature("swap(address,address,uint256,uint256,uint8)", _srcToken, _dstToken, _amount, minReturn, flag));
        require(success, "Failed to access Pancakeswap smart router on BSC");
        return returnData;
    }
}