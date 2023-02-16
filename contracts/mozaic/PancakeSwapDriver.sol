pragma solidity ^0.8.0;

// import "../interfaces/IActionDriver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PancakeswapActionDriver {
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
    // INTERNAL

    function _swap(IERC20 _srcToken, IERC20 _dstToken, uint256 _amount, uint256 minReturn, FLAG flag) internal virtual {
        // Approve
        _srcToken.approve(PANCAKESWAP_SMART_ROUTER_ON_BSC, _amount);

        // Swap
        bytes memory functionSignature = abi.encodeWithSignature("swap(address,address,uint256,uint256,uint8)", _srcToken, _dstToken, _amount, minReturn, flag);
        (bool success, bytes memory returnData) = address(PANCAKESWAP_SMART_ROUTER_ON_BSC).call(functionSignature);
    }
}