// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "../interfaces/IStargateRouter.sol";
import "./ProtocolDriver.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract StargateDriver is ProtocolDriver{
    using SafeMath for uint256;

    struct VaultDescriptor {
        uint16 chainId;
        address vaultAddress;
    }

    struct StargateDriverConfig {
        address stgRouter;
        address stgLPStaking;
        VaultDescriptor[] vaults;
    }

    uint8 internal constant TYPE_SWAP_REMOTE = 1;
    bytes32 public constant CONFIG_SLOT = keccak256("StargateDriver.config");
    
    function configDriver(bytes calldata params) public override onlyOwner returns (bytes memory) {
        // Unpack into _getConfig().stgRouter, stgLPStaking
        (address _stgRouter, address _stgLPStaking) = abi.decode(params, (address, address));
        StargateDriverConfig storage _config = _getConfig();
        _config.stgRouter = _stgRouter;
        _config.stgLPStaking = _stgLPStaking;
    }

    function registerVault(uint16 _chainId, address _vaultAddress) public onlyOwner returns (bytes memory) {
        StargateDriverConfig storage _config = _getConfig();
        bool flagExist = false;
        // if it already exists, update vault address 
        for (uint256 i = 0; i < _config.vaults.length; i++) {
            if (_config.vaults[i].chainId == _chainId) {
                _config.vaults[i].vaultAddress = _vaultAddress;
                flagExist = true;
                break;
            }
        }
        
        if (!flagExist) {   // if new vault, add it.
            VaultDescriptor memory _newVault;
            _newVault.chainId = _chainId;
            _newVault.vaultAddress = _vaultAddress;
            _config.vaults.push(_newVault);
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

        address _to = address(0x0);
        {
            for (uint256 i = 0; i < _getConfig().vaults.length; i++) {
                if (_getConfig().vaults[i].chainId == _dstChainId) {
                    _to = _getConfig().vaults[i].vaultAddress;
                }
            }
            require(_to != address(0x0), "StargateDriver: _to cannot be 0x0");
        }

        // Get native fee
        (uint256 _nativeFee, ) = IStargateRouter(_router).quoteLayerZeroFee(_dstChainId, TYPE_SWAP_REMOTE, abi.encodePacked(_to), bytes(""), IStargateRouter.lzTxObj(0, 0, "0x"));
        // Swap
        IStargateRouter(_router).swap{value:_nativeFee}(_dstChainId, _srcPoolId, _dstPoolId, payable(address(this)), _amountLD, 0, IStargateRouter.lzTxObj(0, 0, "0x"), abi.encodePacked(_to), bytes(""));
    }

    function _getStakedAmountLDPerToken(bytes calldata _payload) private returns (bytes memory result) {
        (address _token) = abi.decode(_payload, (address));

        // Get pool and poolId
        address _pool = _getStargatePoolFromToken(_token);
        (bool success, bytes memory response) = _pool.call(abi.encodeWithSignature("poolId()"));
        require(success, "poolId failed");
        uint256 _poolId = abi.decode(response, (uint256));

        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 poolIndex) = _getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Collect pending STG rewards
        address _stgLPStaking = _getConfig().stgLPStaking;
        (success, response) = address(_stgLPStaking).call(abi.encodeWithSignature("withdraw(uint256,uint256)", poolIndex, 0));
        require(success, "withdraw failed");

        (success, response) = address(_pool).call(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(success, "balanceOf failed");
        uint256 _amountLPToken = abi.decode(response, (uint256));
        
        (success, response) = address(_pool).call(abi.encodeWithSignature("totalLiquidity()"));
        require(success, "totalLiquidity failed");
        uint256 _totalLiquidity = abi.decode(response, (uint256));
        
        (success, response) = address(_pool).call(abi.encodeWithSignature("convertRate()"));
        require(success, "convertRate failed");
        uint256 _convertRate = abi.decode(response, (uint256));
        
        uint256 _totalLiquidityLD = _totalLiquidity.mul(_convertRate);
        
        (success, response) = address(_pool).call(abi.encodeWithSignature("totalSupply()"));
        require(success, "totalSupply failed");
        uint256 _totalSupply = abi.decode(response, (uint256));
        
        uint256 _amountStakedLD = 0;
        if (_totalSupply > 0) {
            _amountStakedLD = _amountStakedLD.add(_totalLiquidityLD.mul(_amountLPToken).div(_totalSupply));
        }

        result = abi.encode(_amountStakedLD);
    }

    function _getStargatePoolFromToken(address _token) private returns (address) {
        address _router = _getConfig().stgRouter;
        
        (bool success, bytes memory response) = address(_router).call(abi.encodeWithSignature("factory()"));
        require(success, "factory failed");
        address _factory = abi.decode(response, (address));

        (success, response) = _factory.call(abi.encodeWithSignature("allPoolsLength()"));
        require(success, "allPoolsLength failed");
        uint256 _allPoolsLength = abi.decode(response, (uint256));

        for (uint i = 0; i < _allPoolsLength; i++) {
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

    function _getPoolIndexInFarming(uint256 _poolId) private returns (bool, uint256) {
        address _pool = _getPool(_poolId);
        address _lpStaking = _getConfig().stgLPStaking;
        
        (bool success, bytes memory response) = address(_lpStaking).call(abi.encodeWithSignature("poolLength()"));
        require(success, "poolLength failed");
        uint256 _poolLength = abi.decode(response, (uint256));

        for (uint256 poolIndex = 0; poolIndex < _poolLength; poolIndex++) {
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