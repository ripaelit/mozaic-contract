pragma solidity ^0.8.9;

// imports
import "../interfaces/IStargateRouter.sol";
import "./ProtocolDriver.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract StargateDriver is ProtocolDriver{
    using SafeMath for uint256;

    struct StargateDriverConfig {
        address stgRouter;
        address stgLPStaking;
    }
    bytes32 public constant CONFIG_SLOT = keccak256("StargateDriver.config");
    function configDriver(bytes calldata params) public override onlyOwner returns (bytes memory response) {
        // Unpack into _getConfig().stgRouter, stgLPStaking
        (address _stgRouter, address _stgLPStaking) = abi.decode(params, (address, address));
        StargateDriverConfig storage _config = _getConfig();
        _config.stgRouter = _stgRouter;
        _config.stgLPStaking = _stgLPStaking;
    }
    function _getConfig() internal view returns (StargateDriverConfig storage _config) {
        // pure?
        bytes32 slotAddress = CONFIG_SLOT;
        assembly {
            _config.slot := slotAddress
        }
    }
    function execute(ActionType _actionType, bytes calldata _payload) public override returns (bytes memory response) {
        if (_actionType == ActionType.Stake) {
            _stake(_payload);
        }
        else if (_actionType == ActionType.Unstake) {
            _unstake(_payload);
        }
        else if (_actionType == ActionType.SwapRemote) {
            _swapRemote(_payload);
        }
        else if (_actionType == ActionType.GetStakedAmount) {
            response = _getStakedAmount();
        }
        else {
            revert("Undefined Action");
        }
    }
    function _stake(bytes calldata _payload) private {
        (uint256 _amountLD, address _token) = abi.decode(_payload, (uint256, address));
        require (_amountLD > 0, "Cannot stake zero amount");
        
        // Get pool and poolId
        address _pool = getStargatePoolFromToken(_token);
        (bool _success, bytes memory _response) = _pool.call(abi.encodeWithSignature("poolId()"));
        require(_success, "Failed to call poolId");
        uint256 _poolId = abi.decode(_response, (uint256));
        
        // Approve token transfer from vault to STG.Pool
        address _stgRouter = _getConfig().stgRouter;
        IERC20(_token).approve(_stgRouter, _amountLD);
        
        // Stake token from vault to STG.Pool and get LPToken
        // 1. Pool.LPToken of vault before
        (_success, _response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(_success, "Failed to call balanceOf");
        uint256 balancePre = abi.decode(_response, (uint256));
        // 2. Valut adds liquidity
        (_success, ) = _stgRouter.call(abi.encodeWithSignature("addLiquidity(uint256,uint256,address)", _poolId, _amountLD, address(this)));
        require(_success, "Failed to call addLiquidity");
        // 3. Pool.LPToken of vault after
        (_success, _response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(_success, "Failed to call balanceOf");
        uint256 balanceAfter = abi.decode(_response, (uint256));
        // 4. Increased LPToken of vault
        uint256 amountLPToken = balanceAfter - balancePre;
        
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");
        
        // Approve LPToken transfer from valut to LPStaking
        address _stgLPStaking = _getConfig().stgLPStaking;
        (_success, ) = _pool.call(abi.encodeWithSignature("approve(address,uint256)", _stgLPStaking, amountLPToken));
        require(_success, "Failed to call approve");

        // Stake LPToken from vault to LPStaking
        (_success, ) = _stgLPStaking.call(abi.encodeWithSignature("deposit(uint256,uint256)", stkPoolIndex, amountLPToken));
        require(_success, "Failed to call deposit");
    }

    function _unstake(bytes calldata _payload) private {
        (uint256 _amountLPToken, address _token) = abi.decode(_payload, (uint256, address));
        require (_amountLPToken > 0, "Cannot unstake zero amount");

        // Get pool and poolId
        address _pool = getStargatePoolFromToken(_token);
        (bool _success, bytes memory _response) = _pool.call(abi.encodeWithSignature("poolId()"));
        require(_success, "Failed to call poolId");
        uint256 _poolId = abi.decode(_response, (uint256));

        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Withdraw LPToken from LPStaking to vault
        // 1. Pool.LPToken of vault before
        (_success, _response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(_success, "Failed to call balanceOf");
        uint256 balancePre = abi.decode(_response, (uint256));
        // 2. Withdraw LPToken from LPStaking to vault
        address _stgLPStaking = _getConfig().stgLPStaking;
        (_success, ) = _stgLPStaking.call(abi.encodeWithSignature("withdraw(uint256,uint256)", stkPoolIndex, _amountLPToken));
        require(_success, "Failed to call withdraw");
        // 3. Pool.LPToken of vault after
        (_success, _response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(_success, "Failed to call balanceOf");
        uint256 balanceAfter = abi.decode(_response, (uint256));
        // 4. Increased LPToken of vault
        uint256 _amountLPTokenWithdrawn = balanceAfter - balancePre;

        // Give LPToken and redeem token from STG.Pool to vault
        address _stgRouter = _getConfig().stgRouter;
        (_success, ) = _stgRouter.call(abi.encodeWithSignature("instantRedeemLocal(uint16,uint256,address)", uint16(_poolId), _amountLPTokenWithdrawn, address(this)));
        require(_success, "Failed to call addLiquidity");
    }

    function _swapRemote(bytes calldata _payload) private {
        (uint256 _amountLD, address _srcToken, uint16 _dstChainId, uint256 _dstPoolId) = abi.decode(_payload, (uint256, address, uint16, uint256));
        require (_amountLD > 0, "Cannot stake zero amount");
        // Get srcPoolId
        address _srcPool = getStargatePoolFromToken(_srcToken);
        (bool _success, bytes memory _response) = _srcPool.call(abi.encodeWithSignature("poolId()"));
        require(_success, "Failed to call poolId");
        uint256 _srcPoolId = abi.decode(_response, (uint256));

        // Approve
        address _router = _getConfig().stgRouter;
        IERC20(_srcToken).approve(_router, _amountLD);

        // Swap
        bytes memory funcSignature = abi.encodeWithSignature("swap(uint16,uint256,uint256,address,uint256,uint256,(uint256,uint256,bytes),bytes,bytes)", _dstChainId, _srcPoolId, _dstPoolId, payable(msg.sender), _amountLD, 0, IStargateRouter.lzTxObj(0, 0, "0x"), abi.encodePacked(msg.sender), bytes(""));
        (_success, ) = address(_router).call(funcSignature);
        require(_success, "Failed to call swap");
    }

    function _getStakedAmount() private returns (bytes memory response) {
        uint256 _amountStaked = 0;
        address _stgLPStaking = _getConfig().stgLPStaking;
        (bool _success, bytes memory _response) = address(_stgLPStaking).call(abi.encodeWithSignature("poolLength()"));
        require(_success, "Failed to get LPStaking.poolLength");
        uint256 _poolLength = abi.decode(_response, (uint256));

        for (uint256 poolIndex = 0; poolIndex < _poolLength; poolIndex++) {
            // 1. Collect pending STG rewards
            (_success, ) = address(_stgLPStaking).call(abi.encodeWithSignature("withdraw(uint256,uint256)", poolIndex, 0));
            require(_success, "Failed to LPStaking.withdraw");

            // 2. Check total staked assets measured as stablecoin
            (_success, _response) = address(_stgLPStaking).call(abi.encodeWithSignature("getPoolInfo(uint256)", poolIndex));
            require(_success, "Failed to LPStaking.getPoolInfo");
            address _pool = abi.decode(_response, (address));
            
            (_success, _response) = address(_pool).call(abi.encodeWithSignature("balanceOf(address)", address(this)));
            require(_success, "Failed to Pool.balanceOf");
            uint256 _amountLPToken = abi.decode(_response, (uint256));
            
            (_success, _response) = address(_pool).call(abi.encodeWithSignature("totalLiquidity()"));
            require(_success, "Failed to Pool.totalLiquidity");
            uint256 _totalLiquidity = abi.decode(_response, (uint256));
            
            (_success, _response) = address(_pool).call(abi.encodeWithSignature("convertRate()"));
            require(_success, "Failed to Pool.convertRate");
            uint256 _convertRate = abi.decode(_response, (uint256));
            
            uint256 _totalLiquidityLD = _totalLiquidity.mul(_convertRate);
            
            (_success, _response) = address(_pool).call(abi.encodeWithSignature("totalSupply()"));
            require(_success, "Failed to Pool.totalSupply");
            uint256 _totalSupply = abi.decode(_response, (uint256));
            
            if (_totalSupply > 0) {
                _amountStaked = _amountStaked.add(_totalLiquidityLD.mul(_amountLPToken).div(_totalSupply));
            }
        }

        response = abi.encode(_amountStaked);
    }

    function getStargatePoolFromToken(address _token) public returns (address) {
        address _router = _getConfig().stgRouter;
        
        (bool _success, bytes memory _response) = address(_router).call(abi.encodeWithSignature("factory()"));
        require(_success, "Failed to get factory in StargateDriver");
        address _factory = abi.decode(_response, (address));

        (_success, _response) = _factory.call(abi.encodeWithSignature("allPoolsLength()"));
        require(_success, "Failed to get allPoolsLength");
        uint256 _allPoolsLength = abi.decode(_response, (uint256));

        for (uint i = 0; i < _allPoolsLength; i++) {
            (_success, _response) = _factory.call(abi.encodeWithSignature("allPools(uint256)", i));
            require(_success, "Failed to get allPools");
            address _pool = abi.decode(_response, (address));

            (_success, _response) = _pool.call(abi.encodeWithSignature("token()"));
            require(_success, "Failed to call token");
            address _poolToken = abi.decode(_response, (address));

            if (_poolToken == _token) {
                return _pool;
            }
        }
        // revert when not found.
        revert("Pool not found for token");
    }

    
    function _getPool(uint256 _poolId) internal returns (address _pool) {
        address _router = _getConfig().stgRouter;

        (bool _success, bytes memory _response) = _router.call(abi.encodeWithSignature("factory()"));
        require(_success, "Failed to get factory in StargateDriver");
        address _factory = abi.decode(_response, (address));

        (_success, _response) = _factory.call(abi.encodeWithSignature("getPool(uint256)", _poolId));
        require(_success, "Failed to get pool in StargateDriver");
        _pool = abi.decode(_response, (address));
    }

    function convertSDtoLD(address _token, uint256 _amountSD) public returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        address _pool = getStargatePoolFromToken(_token);

        (bool _success, bytes memory _response) = _pool.call(abi.encodeWithSignature("convertRate()"));
        require(_success, "Failed to call convertRate");
        uint256 _convertRate = abi.decode(_response, (uint256));

        return  _amountSD.mul(_convertRate); // pool.amountSDtoLD(_amountSD);
    }

    function convertLDtoSD(address _token, uint256 _amountLD) public returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        address _pool = getStargatePoolFromToken(_token);

        (bool _success, bytes memory _response) = _pool.call(abi.encodeWithSignature("convertRate()"));
        require(_success, "Failed to call convertRate");
        uint256 _convertRate = abi.decode(_response, (uint256));

        return  _amountLD.div(_convertRate); // pool.amountLDtoSD(_amountLD);
    }

    function getPoolIndexInFarming(uint256 _poolId) public returns (bool, uint256) {
        address _pool = _getPool(_poolId);
        address _lpStaking = _getConfig().stgLPStaking;
        
        (bool _success, bytes memory _response) = address(_lpStaking).call(abi.encodeWithSignature("poolLength()"));
        require(_success, "Failed to get LPStaking.poolLength");
        uint256 _poolLength = abi.decode(_response, (uint256));

        for (uint256 poolIndex = 0; poolIndex < _poolLength; poolIndex++) {
            (_success, _response) = address(_lpStaking).call(abi.encodeWithSignature("getPoolInfo(uint256)", poolIndex));
            require(_success, "Failed to call getPoolInfo");
            address _pool__ = abi.decode(_response, (address));
            if (_pool__ == _pool) {
                return (true, poolIndex);
            }
        }
       
        return (false, 0);
    }
}