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
    modifier onlyVault() {
        require(vault == msg.sender, "onlyVault: caller is not vault");
        _;
    }

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
    address public vault;
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

    function getStargatePriceMil() public virtual view returns (uint256) {
        return 0;
    }
    function executeOrders(Order[] memory orders) public onlyOwner{
        for (uint i = 0; i < orders.length; i++ ) {
            {
                Order memory order = orders[i];
                if (order.orderType == OrderType.Stake) {
                    _stake(order.amount, order.arg1);
                }
                else if (order.orderType == OrderType.Unstake) {
                    _unstake(order.amount, order.arg1);
                }
                else if (order.orderType == OrderType.Sell) {
                    _sell(order.amount, order.arg1);
                }
                else if (order.orderType == OrderType.Swap) {
                    _swap(order.amount, order.arg1, order.arg2);
                }
                else if (order.orderType == OrderType.SwapRemote) {
                    _swapRemote(order.amount, order.arg1, order.arg2, order.arg3);
                }
            }
        }
    }
    
    function _stake(uint256 _amount, uint256 _poolId ) private{
        require (_amount > 0, "Cannot stake zero amount");
        Pool pool = getPool(_poolId);
        // 1. Deposit
        uint256 balancePre = pool.balanceOf(address(this));
        IERC20 coinContract = IERC20(pool.token());
        coinContract.approve(stargateRouter, _amount);
        Router(stargateRouter).addLiquidity(_poolId, _amount, address(this));
        uint256 balanceAfter = pool.balanceOf(address(this));
        uint256 balanceDelta = balanceAfter - balancePre;
        // 2. Stake LP
        // 2-1. Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");
        pool.approve(stargateLpStaking, balanceDelta);
        LPStaking(stargateLpStaking).deposit(stkPoolIndex, balanceDelta);
    }
    function _unstake(uint256 _amount, uint256 _poolId) private {
        
    }

    function _sell(uint256 _amount, uint256 _poolId) internal virtual {
        
    }

    function _swap(uint256 _amount, uint256 _srcPoolId, uint256 _dstPoolId) internal virtual {

    }

    function _swapRemote(uint256 _amount, uint256 _srcPoolId, uint256 _dstChainId, uint256 _dstPoolId) internal virtual {

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

    function giveStablecoin(address _user, address _token, uint256 _amountLD) public onlyVault {
        IERC20(_token).transfer(_user, _amountLD);
    }

}