pragma solidity ^0.8.9;

import "./ProtocolDriver.sol";
import "../libraries/stargate/Router.sol";
import "../libraries/stargate/Pool.sol";
import "../libraries/stargate/LPStaking.sol";

contract StargateDriver is ProtocolDriver{
    using SafeMath for uint256;

    struct StargateDriverConfig {
        address stgRouter;
        address stgLpStaking;
    }
    StargateDriverConfig public stargateDriverConfig;
    function configDriver(bytes calldata params) public override onlyOwner returns (bytes memory response) {
        // Unpack into stargateDriverConfig.stgRouter, stgLpStaking, stgToken
        (address _stgRouter, address _stgLpStaking) = abi.decode(params, (address, address));
        stargateDriverConfig.stgRouter = _stgRouter;
        stargateDriverConfig.stgLpStaking = _stgLpStaking;
    }
    function execute(ActionType _actionType, bytes calldata _payload) public override returns (bytes memory response) {
        if (_actionType == ActionType.Stake) {
            (uint256 _amountLD, address _token) = abi.decode(_payload, (uint256, address));
            _stake(_amountLD, _token);
        }
        else if (_actionType == ActionType.Unstake) {
            (uint256 _amountMLP, address _token) = abi.decode(_payload, (uint256, address));
            _unstake(_amountMLP, _token);
        }
        else if (_actionType == ActionType.SwapRemote) {
            (uint256 _amountLD, address _srcToken, uint16 _dstChainId, address _dstToken) = abi.decode(_payload, (uint256, address, uint16, address));
            _swapRemote(_amountLD, _srcToken, _dstChainId, _dstToken);
        }
    }
    function _stake(uint256 _amountLD, address _token) private {
        // CHECKLATER: try internal
        require (_amountLD > 0, "Cannot stake zero amount");
        Pool _pool = getStargatePoolFromToken(_token);
        uint256 _poolId = _pool.poolId();
        // Approve coin transfer from OrderTaker to STG.Pool
        IERC20 coinContract = IERC20(_pool.token());
        coinContract.approve(stargateDriverConfig.stgRouter, _amountLD);
        // Stake coin from OrderTaker to STG.Pool
        uint256 balancePre = _pool.balanceOf(address(this));
        Router(stargateDriverConfig.stgRouter).addLiquidity(_poolId, _amountLD, address(this));
        uint256 balanceAfter = _pool.balanceOf(address(this));
        uint256 amountLPToken = balanceAfter - balancePre;
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");
        // Approve LPToken transfer from OrderTaker to LPStaking
        _pool.approve(stargateDriverConfig.stgLpStaking, amountLPToken);
        // Stake LPToken from OrderTaker to LPStaking
        LPStaking(stargateDriverConfig.stgLpStaking).deposit(stkPoolIndex, amountLPToken);
    }

    function _unstake(uint256 _amountLPToken, address _token) private {
        require (_amountLPToken > 0, "Cannot unstake zero amount");
        Pool _pool = getStargatePoolFromToken(_token);
        uint256 _poolId = _pool.poolId();
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Unstake LPToken from LPStaking to OrderTaker
        LPStaking(stargateDriverConfig.stgLpStaking).withdraw(stkPoolIndex, _amountLPToken);
        
        // Unstake coin from STG.Pool to OrderTaker
        Router(stargateDriverConfig.stgRouter).instantRedeemLocal(uint16(_poolId), _amountLPToken, address(this));
        
        IERC20 _coinContract = IERC20(_pool.token());
        uint256 _userToken = _coinContract.balanceOf(address(this));
    }

    function _swapRemote(uint256 _amountLD, address _srcToken, uint16 _dstChainId, address _dstToken) private {
        require (_amountLD > 0, "Cannot stake zero amount");
        uint256 _srcPoolId = getStargatePoolFromToken(_srcToken).poolId();
        uint256 _dstPoolId = getStargatePoolFromToken(_dstToken).poolId();

        IERC20(_srcToken).approve(stargateDriverConfig.stgRouter, _amountLD);
        Router(stargateDriverConfig.stgRouter).swap(_dstChainId, _srcPoolId, _dstPoolId, payable(msg.sender), _amountLD, 0, IStargateRouter.lzTxObj(0, 0, "0x"), abi.encodePacked(msg.sender), bytes(""));
    }

    function getStargatePoolFromToken(address _token) public view returns (Pool) {
        for (uint i = 0; i < Factory(Router(stargateDriverConfig.stgRouter).factory()).allPoolsLength(); i++) {
            Pool _pool = Pool(Factory(Router(stargateDriverConfig.stgRouter).factory()).allPools(i));
            if (_pool.token() == _token) {
                return _pool;
            }
        }
        // revert when not found.
        revert("Pool not found for token");
    }

    
    function getPool(uint256 _poolId) internal view returns (Pool) {
        return Router(stargateDriverConfig.stgRouter).factory().getPool(_poolId);
    }

    function convertSDtoLD(address _token, uint256 _amountSD) public view returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        Pool pool = getStargatePoolFromToken(_token);
        return  _amountSD.mul(pool.convertRate()); // pool.amountSDtoLD(_amountSD);
    }

    function convertLDtoSD(address _token, uint256 _amountLD) public view returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        Pool pool = getStargatePoolFromToken(_token);
        return  _amountLD.div(pool.convertRate()); // pool.amountLDtoSD(_amountLD);
    }

    function getPoolIndexInFarming(uint256 _poolId) public view returns (bool, uint256) {
        Pool pool = getPool(_poolId);
        
        for (uint i = 0; i < LPStaking(stargateDriverConfig.stgLpStaking).poolLength(); i++ ) {
            if (address(LPStaking(stargateDriverConfig.stgLpStaking).getPoolInfo(i)) == address(pool)) {
                return (true, i);
            }
        }
        // not found
        return (false, 0);
    }
}