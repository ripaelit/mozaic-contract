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

import "../libraries/stargate/Pool.sol";
import "../libraries/stargate/LPStaking.sol";
import "../libraries/stargate/Router.sol";

contract OrderTaker is Ownable {
    using SafeMath for uint256;

    // data types
    enum OrderType {
        Stake,
        Unstake,
        Swap,
        SwapRemote,
        Sell
    }
    

    /// @title: Order Parameters for Each Type:
    /// - Stake (amountCoin, poolIndex)
    /// - Unstake: (amountLP, poolIndex)
    /// - Swap (amountSrc, srcPoolIndex, dstPoolIndex)
    /// - Swap Remote(amountSrc, srcPoolIndex, dstChainId, dstPoolIndex)
    /// - Sell(amountSTG, StgPoolIndex)
    /// @note: every pool index is the index in Stargate Factory
    struct Order {
        OrderType orderType;
        uint256 amount;
        uint256 arg1;
        uint256 arg2;
        uint256 arg3;
    }

    uint16 public chainId; // LayerZero defined chain ID;
    address public stargateRouter; // Stargate Router Address. Used for DEX operations.
    address public stargateLpStaking; // Stargate Farming Pool Address.
    address public stargateToken; // Stargate Token Address.
    constructor(
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
    ) {
        chainId = _chainId;
        stargateRouter = _stargateRouter;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
    }
    function executeOrders(Order[] memory orders) public {
        for (uint i = 0; i < orders.length; i++ ) {
            {
                Order memory order = orders[i];
                if (order.orderType == OrderType.Stake) {
                    stake(order.amount, order.arg1);
                }
            }
        }
    }
    function stake(uint256 _amount, uint256 _poolId ) private{
        Pool pool = getPool(_poolId);
        // 1. Deposit
        uint256 balancePre = pool.balanceOf(address(this));
        Router(stargateRouter).addLiquidity(_poolId, _amount, address(this));
        uint256 balanceAfter = pool.balanceOf(address(this));
        uint256 balanceDelta = balanceAfter - balancePre;
        // 2. Stake LP
        // 2-1. Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not accepted.");
        LPStaking(stargateLpStaking).deposit(stkPoolIndex, balanceDelta);
    }
    
    function getPool(uint256 _poolId) public view returns (Pool) {
        return Router(stargateRouter).factory().getPool(_poolId);
    }

    function getPoolIndexInFarming(uint256 _poolId)public view returns (bool, uint256) {
        Pool pool = getPool(_poolId);
        for (uint i = 0; i < LPStaking(stargateLpStaking).poolLength(); i++ ) {
            if (address(LPStaking(stargateLpStaking).getPoolInfo(i)) == address(pool)) {
                return (true, i);
            }
        }
        // not found
        return (false, 0);
    }
}