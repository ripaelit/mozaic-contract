pragma solidity ^0.8.0;

// imports
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// libraries
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// interfaces
import "../interfaces/IStargateRouter.sol";
import "../interfaces/IStargateLpStaking.sol";
import "../interfaces/IDex.sol";

contract OrderTaker is Ownable {
    using SafeMath for uint256;
    uint16 public chainId; // LayerZero defined chain ID;
    address public stargateRouter; // Stargate Router Address.
    address public stargateLpStaking; // Stargate Farming Pool Address.
    address public stargateToken; // Stargate Token Address.
    constructor(
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
        // PoolInfo[] memory _poolInfos
    ) {
        chainId = _chainId;
        stargateRouter = _stargateRouter;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
    }
}