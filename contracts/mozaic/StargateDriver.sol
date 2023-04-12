// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "../interfaces/IStargateRouter.sol";
import "./ProtocolDriver.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract StargateDriver is ProtocolDriver{
    using SafeMath for uint256;

    // struct VaultInfo {
    //     uint16 chainId;
    //     address vaultAddress;
    // }

    struct StargateDriverConfig {
        address stgRouter;
        address stgLPStaking;
        uint16[] chainIds;
        mapping(uint16 => address) vaultsLookup;
    }

    uint8 internal constant TYPE_SWAP_REMOTE = 1;
    uint8 internal constant MOZAIC_DECIMALS = 6;
    bytes32 public constant CONFIG_SLOT = keccak256("StargateDriver.config");
    
    function configDriver(bytes calldata params) public override onlyOwner returns (bytes memory) {
        // Unpack into _getConfig().stgRouter, stgLPStaking
        (address _stgRouter, address _stgLPStaking) = abi.decode(params, (address, address));
        StargateDriverConfig storage _config = _getConfig();
        _config.stgRouter = _stgRouter;
        _config.stgLPStaking = _stgLPStaking;
    }

    function registerVaults(uint16[] memory _chainIds, address[] calldata _vaultAddrs) public onlyOwner returns (bytes memory) {
        require(_chainIds.length == _vaultAddrs.length, "StgDriver: err in registerVaults");
        StargateDriverConfig storage _config = _getConfig();
        for (uint i = 0; i < _config.chainIds.length; ++i) {
            delete _config.vaultsLookup[_config.chainIds[i]];
        }
        _config.chainIds = _chainIds;
        for (uint i = 0; i < _chainIds.length; ++i) {
            _config.vaultsLookup[_chainIds[i]] = _vaultAddrs[i];
        }
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
            response = _stake(_payload);
        }
        else if (_actionType == ActionType.Unstake) {
            response = _unstake(_payload);
        }
        else if (_actionType == ActionType.SwapRemote) {
            response = _swapRemote(_payload);
        }
        else if (_actionType == ActionType.GetStakedAmountLD) {
            response = _getStakedAmountLDPerToken(_payload);
        }
        else if (_actionType == ActionType.GetTotalAssetsMD) {
            response = _getTotalAssetsMDPerToken(_payload);
        }
        else {
            revert("Undefined Action");
        }
    }
    function _stake(bytes calldata _payload) private returns (bytes memory) {
        (uint256 _amountLD, address _token) = abi.decode(_payload, (uint256, address));
        require (_amountLD > 0, "Cannot stake zero amount");
        
        // Get pool and poolId
        address _pool = _getStargatePoolFromToken(_token);
        (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("poolId()"));
        require(success, "poolId failed");
        uint256 _poolId = abi.decode(response, (uint256));
        
        // Approve token transfer from vault to STG.Pool
        address _stgRouter = _getConfig().stgRouter;
        IERC20(_token).approve(_stgRouter, _amountLD);
        
        // Stake token from vault to STG.Pool and get LPToken
        // 1. Pool.LPToken of vault before
        (success, response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(success, "balanceOf failed");
        uint256 balancePre = abi.decode(response, (uint256));
        // 2. Vault adds liquidity
        IStargateRouter(_stgRouter).addLiquidity(_poolId, _amountLD, address(this));
        // 3. Pool.LPToken of vault after
        (success, response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(success, "balanceOf failed");
        uint256 balanceAfter = abi.decode(response, (uint256));
        // 4. Increased LPToken of vault
        uint256 amountLPToken = balanceAfter - balancePre;
        
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = _getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");
        
        // Approve LPToken transfer from vault to LPStaking
        address _stgLPStaking = _getConfig().stgLPStaking;
        (success, response) = _pool.call(abi.encodeWithSignature("approve(address,uint256)", _stgLPStaking, amountLPToken));
        require(success, "approve failed");

        // Stake LPToken from vault to LPStaking
        (success, response) = _stgLPStaking.call(abi.encodeWithSignature("deposit(uint256,uint256)", stkPoolIndex, amountLPToken));
        require(success, "deposit failed");
    }

    function _unstake(bytes calldata _payload) private returns (bytes memory) {
        (uint256 _amountLPToken, address _token) = abi.decode(_payload, (uint256, address));
        require (_amountLPToken > 0, "Cannot unstake zero amount");

        // Get pool and poolId
        address _pool = _getStargatePoolFromToken(_token);
        (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("poolId()"));
        require(success, "poolId failed");
        uint256 _poolId = abi.decode(response, (uint256));

        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = _getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Withdraw LPToken from LPStaking to vault
        // 1. Pool.LPToken of vault before
        (success, response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(success, "balanceOf failed");
        uint256 balancePre = abi.decode(response, (uint256));
        // 2. Withdraw LPToken from LPStaking to vault
        address _stgLPStaking = _getConfig().stgLPStaking;
        (success, response) = _stgLPStaking.call(abi.encodeWithSignature("withdraw(uint256,uint256)", stkPoolIndex, _amountLPToken));
        require(success, "withdraw failed");
        // 3. Pool.LPToken of vault after
        (success, response) = _pool.call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(success, "balanceOf failed");
        uint256 balanceAfter = abi.decode(response, (uint256));
        // 4. Increased LPToken of vault
        uint256 _amountLPTokenWithdrawn = balanceAfter - balancePre;

        // Give LPToken and redeem token from STG.Pool to vault
        address _stgRouter = _getConfig().stgRouter;
        IStargateRouter(_stgRouter).instantRedeemLocal(uint16(_poolId), _amountLPTokenWithdrawn, address(this));
    }

    function _swapRemote(bytes calldata _payload) private returns (bytes memory) {
        uint256 _amountLD;
        uint16 _dstChainId;
        uint256 _dstPoolId;
        uint256 _srcPoolId;
        address _router;
        // To avoid stack deep error
        {
            address _srcToken;
            (_amountLD, _srcToken, _dstChainId, _dstPoolId) = abi.decode(_payload, (uint256, address, uint16, uint256));
            require (_amountLD > 0, "Cannot stake zero amount");

            address _srcPool = _getStargatePoolFromToken(_srcToken);
            (bool success, bytes memory response) = _srcPool.call(abi.encodeWithSignature("poolId()"));
            require(success, "poolId failed");
            _srcPoolId = abi.decode(response, (uint256));

            _router = _getConfig().stgRouter;
            IERC20(_srcToken).approve(_router, _amountLD);
        }

        address _to = _getConfig().vaultsLookup[_dstChainId];
        require(_to != address(0x0), "StgDriver: _to cannot be 0x0");

        // Quote native fee
        (uint256 _nativeFee, ) = IStargateRouter(_router).quoteLayerZeroFee(_dstChainId, TYPE_SWAP_REMOTE, abi.encodePacked(_to), bytes(""), IStargateRouter.lzTxObj(0, 0, "0x"));
        // Swap
        IStargateRouter(_router).swap{value:_nativeFee}(_dstChainId, _srcPoolId, _dstPoolId, payable(address(this)), _amountLD, 0, IStargateRouter.lzTxObj(0, 0, "0x"), abi.encodePacked(_to), bytes(""));
    }

    function _getStakedAmountLDPerToken(bytes calldata _payload) private returns (bytes memory result) {
        (address _token) = abi.decode(_payload, (address));

        // Get pool address
        address _pool = _getStargatePoolFromToken(_token);

        // Get pool id: _poolId = _pool.poolId()
        (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("poolId()"));
        require(success, "poolId failed");
        uint256 _poolId = abi.decode(response, (uint256));

        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 poolIndex) = _getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Collect pending STG rewards: _stgLPStaking = _getConfig().stgLPStaking.withdraw(poolIndex, 0)
        address _stgLPStaking = _getConfig().stgLPStaking;
        (success, response) = address(_stgLPStaking).call(abi.encodeWithSignature("withdraw(uint256,uint256)", poolIndex, 0));
        require(success, "withdraw failed");

        // Get amount LP staked
        (success, response) = address(_stgLPStaking).call(abi.encodeWithSignature("userInfo(uint256,address)", poolIndex, address(this)));
        require(success, "lp staked failed");
        uint256 _amountLP = abi.decode(response, (uint256));

        // Get amount LD staked
        (success, response) = address(_pool).call(abi.encodeWithSignature("amountLPtoLD(uint256)", _amountLP));
        require(success, "amountLPtoLD failed");
        uint256 _amountLD = abi.decode(response, (uint256));
        
        result = abi.encode(_amountLD);
    }

    function _getTotalAssetsMDPerToken(bytes calldata _payload) private returns (bytes memory result) {
        (address[] memory _tokens) = abi.decode(_payload, (address[]));

        uint256 _totalAssetsMD;
        for (uint i; i < _tokens.length; ++i) {
            address _token = _tokens[i];

            // Get assets LD in vault
            uint256 _assetsLD = IERC20(_token).balanceOf(address(this));

            // Get assets LD staked in LPStaking
            // Get pool address
            address _pool = _getStargatePoolFromToken(_token);

            // Get pool id: _poolId = _pool.poolId()
            (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("poolId()"));
            require(success, "poolId failed");
            uint256 _poolId = abi.decode(response, (uint256));

            // Find the Liquidity Pool's index in the Farming Pool.
            (bool found, uint256 poolIndex) = _getPoolIndexInFarming(_poolId);
            require(found, "The LP token not acceptable.");

            // Collect pending STG rewards: _stgLPStaking = _getConfig().stgLPStaking.withdraw(poolIndex, 0)
            address _stgLPStaking = _getConfig().stgLPStaking;
            (success, response) = address(_stgLPStaking).call(abi.encodeWithSignature("withdraw(uint256,uint256)", poolIndex, 0));
            require(success, "withdraw failed");

            // Get amount LP staked
            (success, response) = address(_stgLPStaking).call(abi.encodeWithSignature("userInfo(uint256,address)", poolIndex, address(this)));
            require(success, "lp staked failed");
            uint256 _amountLPStaked = abi.decode(response, (uint256));

            // Get amount LD staked
            (success, response) = address(_pool).call(abi.encodeWithSignature("amountLPtoLD(uint256)", _amountLPStaked));
            require(success, "amountLPtoLD failed");
            uint256 _amountLDStaked = abi.decode(response, (uint256));

            _assetsLD = _assetsLD.add(_amountLDStaked);

            uint256 _assetsMD = convertLDtoMD(_token, _assetsLD);
            _totalAssetsMD = _totalAssetsMD.add(_assetsMD);
        }
        result = abi.encode(_totalAssetsMD);
    }

    function _getStargatePoolFromToken(address _token) private returns (address) {
        address _router = _getConfig().stgRouter;
        
        (bool success, bytes memory response) = address(_router).call(abi.encodeWithSignature("factory()"));
        require(success, "factory failed");
        address _factory = abi.decode(response, (address));

        (success, response) = _factory.call(abi.encodeWithSignature("allPoolsLength()"));
        require(success, "allPoolsLength failed");
        uint256 _allPoolsLength = abi.decode(response, (uint256));

        for (uint i; i < _allPoolsLength; ++i) {
            (success, response) = _factory.call(abi.encodeWithSignature("allPools(uint256)", i));
            require(success, "allPools failed");
            address _pool = abi.decode(response, (address));

            (success, response) = _pool.call(abi.encodeWithSignature("token()"));
            require(success, "token failed");
            address _poolToken = abi.decode(response, (address));

            if (_poolToken == _token) {
                return _pool;
            } else {
                continue;
            }
        }
        // revert when not found.
        revert("Pool not found for token");
    }

    
    function _getPool(uint256 _poolId) internal returns (address _pool) {
        address _router = _getConfig().stgRouter;

        (bool success, bytes memory response) = _router.call(abi.encodeWithSignature("factory()"));
        require(success, "factory failed");
        address _factory = abi.decode(response, (address));

        (success, response) = _factory.call(abi.encodeWithSignature("getPool(uint256)", _poolId));
        require(success, "getPool failed");
        _pool = abi.decode(response, (address));
    }

    function convertSDtoLD(address _token, uint256 _amountSD) public returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        address _pool = _getStargatePoolFromToken(_token);

        (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("convertRate()"));
        require(success, "convertRate failed");
        uint256 _convertRate = abi.decode(response, (uint256));

        return  _amountSD.mul(_convertRate); // pool.amountSDtoLD(_amountSD);
    }

    function convertLDtoSD(address _token, uint256 _amountLD) public returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        address _pool = _getStargatePoolFromToken(_token);

        (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("convertRate()"));
        require(success, "convertRate failed");
        uint256 _convertRate = abi.decode(response, (uint256));

        return  _amountLD.div(_convertRate); // pool.amountLDtoSD(_amountLD);
    }

    function convertLDtoMD(address _token, uint256 _amountLD) public view returns (uint256) {
        uint256 _localDecimals = IERC20Metadata(_token).decimals();
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountLD.mul(10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountLD.div(10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function convertMDtoLD(address _token, uint256 _amountMD) public view returns (uint256) {
        uint256 _localDecimals = IERC20Metadata(_token).decimals();
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountMD.div(10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountMD.mul(10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function _getPoolIndexInFarming(uint256 _poolId) private returns (bool, uint256) {
        address _pool = _getPool(_poolId);
        address _lpStaking = _getConfig().stgLPStaking;
        
        (bool success, bytes memory response) = address(_lpStaking).call(abi.encodeWithSignature("poolLength()"));
        require(success, "poolLength failed");
        uint256 _poolLength = abi.decode(response, (uint256));

        for (uint256 poolIndex; poolIndex < _poolLength; poolIndex++) {
            (success, response) = address(_lpStaking).call(abi.encodeWithSignature("getPoolInfo(uint256)", poolIndex));
            require(success, "getPoolInfo failed");
            address _pool__ = abi.decode(response, (address));
            if (_pool__ == _pool) {
                return (true, poolIndex);
            } else {
                continue;
            }
        }
       
        return (false, 0);
    }
}