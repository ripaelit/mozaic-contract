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

import "hardhat/console.sol";

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
                // else if (order.orderType == OrderType.Sell) {
                //     _sell(order.amount, order.arg1);
                // }
                else if (order.orderType == OrderType.Swap) {
                    _swap(order.amount, order.arg1, order.arg2);
                }
                else if (order.orderType == OrderType.SwapRemote) {
                    _swapRemote(order.amount, order.arg1, order.arg2, order.arg3);
                }
            }
        }
    }
    
    function _stake(uint256 _amountLD, uint256 _poolId ) private {
        require (_amountLD > 0, "Cannot stake zero amount");
        Pool pool = getPool(_poolId);
        // Approve coin transfer from OrderTaker to STG.Pool
        IERC20 coinContract = IERC20(pool.token());
        coinContract.approve(stargateRouter, _amountLD);
        // Stake coin from OrderTaker to STG.Pool
        uint256 balancePre = pool.balanceOf(address(this));
        Router(stargateRouter).addLiquidity(_poolId, _amountLD, address(this));
        uint256 balanceAfter = pool.balanceOf(address(this));
        uint256 amountLPToken = balanceAfter - balancePre;
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");
        // Approve LPToken transfer from OrderTaker to LPStaking
        pool.approve(stargateLpStaking, amountLPToken);
        // Stake LPToken from OrderTaker to LPStaking
        LPStaking(stargateLpStaking).deposit(stkPoolIndex, amountLPToken);
    }
    function _unstake(uint256 _amountLPToken, uint256 _poolId) private {
        console.log("OrderTaker._unstake started: _amountLPToken, _poolId", _amountLPToken, _poolId);
        require (_amountLPToken > 0, "Cannot unstake zero amount");
        Pool pool = getPool(_poolId);
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Unstake LPToken from LPStaking to OrderTaker
        console.log("   LPTokens in LPStaking before withdraw", LPStaking(stargateLpStaking).lpBalances(stkPoolIndex));
        LPStaking(stargateLpStaking).withdraw(stkPoolIndex, _amountLPToken);
        console.log("   LPTokens in LPStaking after withdraw", LPStaking(stargateLpStaking).lpBalances(stkPoolIndex));
        
        // Unstake coin from STG.Pool to OrderTaker
        Router(stargateRouter).instantRedeemLocal(uint16(_poolId), _amountLPToken, address(this));
        
        IERC20 coinContract = IERC20(pool.token());
        uint256 userToken = coinContract.balanceOf(address(this));
        console.log("   USDC in OrderTaker", userToken);
        console.log("OrderTaker._unstake ended");
    }

    // function _sell(uint256 _amount, uint256 _poolId) internal virtual {
        
    // }

    function _swap(uint256 _amount, uint256 _srcPoolId, uint256 _dstPoolId) internal virtual {
    }

    function _swapRemote(uint256 _amountLD, uint256 _srcPoolId, uint256 _dstChainId, uint256 _dstPoolId) internal virtual {
        require (_amountLD > 0, "Cannot stake zero amount");
        Pool pool = getPool(_srcPoolId);
        // Approve coin transfer from OrderTaker to STG.Pool
        IERC20 coinContract = IERC20(pool.token());
        coinContract.approve(stargateRouter, _amountLD);
        Router(stargateRouter).swap(uint16(_dstChainId), _srcPoolId, _dstPoolId, payable(msg.sender), _amountLD, 0, IStargateRouter.lzTxObj(0, 0, "0x"), abi.encodePacked(msg.sender), bytes(""));
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

    //this swap function is used to trade from one token to another
    //the inputs are self explainatory
    //token in = the token address you want to trade out of
    //token out = the token address you want as the output of this trade
    //amount in = the amount of tokens you are sending in
    //amount out Min = the minimum amount of tokens you want out of the trade
    //to = the address you want the tokens to be sent to
    
    // function _swapUsingDex(address _tokenIn, address _tokenOut, uint256 _amountIn, uint256 _amountOutMin, address _to) internal {
      
    //     //first we need to transfer the amount in tokens from the msg.sender to this contract
    //     //this contract will have the amount of in tokens
    //     IERC20(_tokenIn).transferFrom(msg.sender, address(this), _amountIn);
        
    //     //next we need to allow the uniswapv2 router to spend the token we just sent to this contract
    //     //by calling IERC20 approve you allow the uniswap contract to spend the tokens in this contract 
    //     IERC20(_tokenIn).approve(UNISWAP_V2_ROUTER, _amountIn);

    //     //path is an array of addresses.
    //     //this path array will have 3 addresses [tokenIn, WETH, tokenOut]
    //     //the if statement below takes into account if token in or token out is WETH.  then the path is only 2 addresses
    //     address[] memory path;
    //     if (_tokenIn == WETH || _tokenOut == WETH) {
    //         path = new address[](2);
    //         path[0] = _tokenIn;
    //         path[1] = _tokenOut;
    //     } else {
    //         path = new address[](3);
    //         path[0] = _tokenIn;
    //         path[1] = WETH;
    //         path[2] = _tokenOut;
    //     }
    //     //then we will call swapExactTokensForTokens
    //     //for the deadline we will pass in block.timestamp
    //     //the deadline is the latest time the trade is valid for
    //     IUniswapV2Router(UNISWAP_V2_ROUTER).swapExactTokensForTokens(_amountIn, _amountOutMin, path, _to, block.timestamp);
    // }

    // //this function will return the minimum amount from a swap
    // //input the 3 parameters below and it will return the minimum amount out
    // //this is needed for the swap function above
    //  function _getAmountOutMin(address _tokenIn, address _tokenOut, uint256 _amountIn) internal view returns (uint256) {

    //    //path is an array of addresses.
    //    //this path array will have 3 addresses [tokenIn, WETH, tokenOut]
    //    //the if statement below takes into account if token in or token out is WETH.  then the path is only 2 addresses
    //     address[] memory path;
    //     if (_tokenIn == WETH || _tokenOut == WETH) {
    //         path = new address[](2);
    //         path[0] = _tokenIn;
    //         path[1] = _tokenOut;
    //     } else {
    //         path = new address[](3);
    //         path[0] = _tokenIn;
    //         path[1] = WETH;
    //         path[2] = _tokenOut;
    //     }
        
    //     uint256[] memory amountOutMins = IUniswapV2Router(UNISWAP_V2_ROUTER).getAmountsOut(_amountIn, path);
    //     return amountOutMins[path.length -1];  
    // }  

}