// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.9;

// imports
import "../libraries/lzApp/NonblockingLzApp.sol";
import "./ProtocolDriver.sol";
import "./MozaicLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract SecondaryVault is NonblockingLzApp {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    //--------------------------------------------------------------------------
    // EVENTS
    event UnexpectedLzMessage(uint16 packetType, bytes payload);

    event DepositRequestAdded (
        address indexed depositor,
        address indexed token,
        uint16 indexed chainId,
        uint256 amountLD
    );

    event WithdrawRequestAdded (
        address indexed withdrawer,
        address indexed token,
        uint16 indexed chainId,
        uint256 amountMLP
    );

    //--------------------------------------------------------------------------
    // CONSTANTS
    uint16 public constant PT_SNAPSHOT_REPORT = 10001;
    uint16 public constant PT_SETTLE_REQUESTS = 10002;
    uint16 public constant PT_SETTLED_REPORT = 10003;
    uint16 public constant PT_TAKE_SNAPSHOT = 10004;
    uint16 public constant STG_DRIVER_ID = 1;
    uint16 public constant PANCAKE_DRIVER_ID = 2;
    // uint256 public constant MOZAIC_DECIMALS = 18;
    uint256 public constant MOZAIC_DECIMALS = 6;    // set to shared decimals

    bytes4 public constant SELECTOR_CONVERTSDTOLD = 0xdef46aa8;
    bytes4 public constant SELECTOR_CONVERTLDTOSD = 0xb53cf239;
    
    enum VaultStatus {
        // No staged requests. Neutral status.
        IDLE,

        // (Primary Vault vision) Primary Vault thinks Secondary Vault is snapshotting. But haven't got report yet.
        // SNAPSHOTTING,

        // (Secondary Vault vision) Secondary Vault knows it staged requests and made snapshot. It sent snapshot report, but doesn't care the rest.
        // (Primary Vault vision) Primary Vault got snapshot report from the Secondary Vault.
        SNAPSHOTTED

        // (Primary Vault vision) Primary Vault sent "settle" message to Secondary Vault. Thinks it is settling requests now.
        // SETTLING
    }

    //---------------------------------------------------------------------------
    // STRUCTS
    struct Action {
        uint256 driverId;
        ProtocolDriver.ActionType actionType;
        bytes payload;
    }

    struct Snapshot {
        uint256 depositRequestAmount;
        uint256 withdrawRequestAmountMLP;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalMozaicLp; // Mozaic "LP"
    }

    struct DepositRequest {
        address user;
        address token;
        uint16 chainId; // chain to receive mLP
    }

    struct WithdrawRequest {
        address user;
        uint16 chainId; // chain to receive stablecoin
        address token; // stablecoin token address
    }

    struct RequestBuffer {
        // deposit
        mapping (address => mapping (address => mapping (uint16 => uint256))) depositRequestLookup; // [user][token][chainId] = amountSD
        DepositRequest[] depositRequestList;
        mapping (address => uint256) depositAmountPerToken; // [token] = amountLD
        uint256 totalDepositAmount;
        // withdraw
        mapping (address => mapping (uint16 => mapping (address => uint256))) withdrawRequestLookup; // [user][chainId][token] = amountMLP
        WithdrawRequest[] withdrawRequestList;
        mapping (address => uint256) withdrawAmountPerUser; // [user] = amountMLP
        mapping (address => uint256) withdrawAmountPerToken; // [token] = amountMLP
        uint256 totalWithdrawAmount;
    }

    struct LzTxObj {
        uint256 dstGasForCall;
        uint256 dstNativeAmount;
        bytes dstNativeAddr;
    }

    struct VaultDescriptor {
        address addr;
        VaultStatus status;
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    mapping (uint256=>ProtocolDriver) public protocolDrivers;
    Snapshot public snapshot;
    address public stargateLpStaking;
    address public stargateToken;
    address public mozaicLp;
    uint16 public primaryChainId;
    uint16 public chainId;
    address[] public acceptingTokens;

    bool public bufferFlag = false; // false ==> Left=pending Right=staged; true ==> Left=staged Right=pending
    RequestBuffer public leftBuffer;
    RequestBuffer public rightBuffer;
    mapping(uint16 => mapping(uint16 => uint256)) public gasLookup;
    uint16[] public chainIds;
    mapping (uint16 => VaultDescriptor) public vaults;
    uint256 public totalBalanceMD;
    uint256 public totalMLP;

    function _requests(bool staged) internal view returns (RequestBuffer storage) {
        return staged ? (bufferFlag ? rightBuffer : leftBuffer) : (bufferFlag ? leftBuffer : rightBuffer);
    }

    function getDepositAmount(bool _staged, address _user, address _token, uint16 _chainId) public view returns (uint256) {
        return _requests(_staged).depositRequestLookup[_user][_token][_chainId];
    }

    function getWithdrawAmount(bool _staged, address _user, uint16 _chainId, address _token) public view returns (uint256) {
        return _requests(_staged).withdrawRequestLookup[_user][_chainId][_token];
    }

    function getDepositRequest(bool _staged, uint256 _index) public view returns (DepositRequest memory) {
        return _requests(_staged).depositRequestList[_index];
    }

    function getWithdrawRequest(bool _staged, uint256 _index) public view returns (WithdrawRequest memory) {
        return _requests(_staged).withdrawRequestList[_index];
    }

    function getTotalDepositAmount(bool _staged) public view returns (uint256) {
        return _requests(_staged).totalDepositAmount;
    }

    function getTotalWithdrawAmount(bool _staged) public view returns (uint256) {
        return _requests(_staged).totalWithdrawAmount;
    }

    function getDepositRequestListLength(bool _staged) public view returns (uint256) {
        return _requests(_staged).depositRequestList.length;
    }

    function getWithdrawRequestListLength(bool _staged) public view returns (uint256) {
        return _requests(_staged).withdrawRequestList.length;
    }

    function getDepositAmountPerToken(bool _staged, address _token) public view returns (uint256) {
        return _requests(_staged).depositAmountPerToken[_token];
    }

    function getWithdrawAmountPerToken(bool _staged, address _token) public view returns (uint256) {
        return _requests(_staged).withdrawAmountPerToken[_token];
    }

    function getBalanceMDPerToken(address _token) public view returns (uint256) {
        return amountLDtoMD(IERC20(_token).balanceOf(address(this)), IERC20Metadata(_token).decimals());
    }

    // Use this function to receive an amount of native token equals to msg.value from msg.sender
    receive () external payable {}

    // Use this function to return balance to msg.sender
    function returnBalance() public onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) {
            return;
        }
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Return balance failed");
    }

    //---------------------------------------------------------------------------
    // Constructor and Public Functions
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        uint16 _primaryChainId,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) NonblockingLzApp(_lzEndpoint) {
        chainId = _chainId;
        primaryChainId = _primaryChainId;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
        mozaicLp = _mozaicLp;
    }

    function setProtocolDriver(uint256 _driverId, ProtocolDriver _driver, bytes calldata _config) public onlyOwner {
        protocolDrivers[_driverId] = _driver;
        // 0x0db03cba = bytes4(keccak256(bytes('configDriver(bytes)')));
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSelector(0x0db03cba, _config));
        require(success, "set driver failed");
    }

    function addToken(address _token) public onlyOwner {
        for (uint i; i < acceptingTokens.length; ++i) {
            if (acceptingTokens[i] == _token) {
                return;
            }
        }
        acceptingTokens.push(_token);
    }

    function removeToken(address _token) public onlyOwner {
        // TODO: Make sure there's no asset as this token.
        uint _idxToken = acceptingTokens.length;
        for (uint i; i < acceptingTokens.length; ++i) {
            if (acceptingTokens[i] == _token) {
                _idxToken = i;
                break;
            }
        }
        require(_idxToken < acceptingTokens.length, "Token not in accepting list");
        if (acceptingTokens.length > 1) {
            acceptingTokens[_idxToken] = acceptingTokens[acceptingTokens.length-1];
        }
        acceptingTokens.pop();
    }

    function isAcceptingToken(address _token) public view returns (bool) {
        for (uint i; i < acceptingTokens.length; ++i) {
            if (acceptingTokens[i] == _token) {
                return true;
            }
        }
        return false;
    }

    function executeActions(Action[] calldata _actions) public onlyOwner {
        for (uint i; i < _actions.length ; ++i) {
            Action calldata _action = _actions[i];
            ProtocolDriver _driver = protocolDrivers[_action.driverId];
            (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_action.actionType), _action.payload));
            require(success, "delegatecall failed");
        }
    }

    function addDepositRequest(uint256 _amountLD, address _token, uint16 _chainId) public {
        require(primaryChainId > 0, "primary chain is not set");
        require(_chainId == chainId, "only onchain mint in PoC");
        require(isAcceptingToken(_token), "should be accepting token");

        address _depositor = msg.sender;
        // Minimum unit of acceptance 1 USD - to easy the following staking
        // uint256 _amountLDAccept = _amountLD.div(IERC20Metadata(_token).decimals()).mul(IERC20Metadata(_token).decimals());
        uint256 _amountLDAccept = _amountLD;

        // transfer stablecoin from depositor to this vault
        _safeTransferFrom(_token, _depositor, address(this), _amountLDAccept);

        // add deposit request to pending buffer
        RequestBuffer storage _pendingBuffer = _requests(false);
        bool exists = false;
        for (uint i; i < _pendingBuffer.depositRequestList.length; ++i) {
            DepositRequest storage _req = _pendingBuffer.depositRequestList[i];
            if (_req.user == _depositor && _req.token == _token) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            DepositRequest memory _req;
            _req.user = _depositor;
            _req.token = _token;
            _req.chainId = _chainId;
            _pendingBuffer.depositRequestList.push(_req);
        }
        uint256 _amountMD = amountLDtoMD(_amountLDAccept, IERC20Metadata(_token).decimals());
        _pendingBuffer.depositRequestLookup[_depositor][_token][_chainId] = _pendingBuffer.depositRequestLookup[_depositor][_token][_chainId].add(_amountMD);
        _pendingBuffer.totalDepositAmount = _pendingBuffer.totalDepositAmount.add(_amountMD);
        _pendingBuffer.depositAmountPerToken[_token] = _pendingBuffer.depositAmountPerToken[_token].add(_amountMD);

        emit DepositRequestAdded(_depositor, _token, _chainId, _amountMD);
    }

    function addWithdrawRequest(uint256 _amountMLP, address _token, uint16 _chainId) public {
        require(_chainId == chainId, "withdraw onchain on PoC");
        require(primaryChainId > 0, "main chain should be set");
        require(isAcceptingToken(_token), "should be accepting token");

        address _withdrawer = msg.sender;
        RequestBuffer storage _pendingBuffer = _requests(false);
        RequestBuffer storage _stagedBuffer = _requests(true);

        // check amount MLP user has, if not enough, revert
        uint256 _bookedAmountMLP = _pendingBuffer.withdrawAmountPerUser[_withdrawer] + _stagedBuffer.withdrawAmountPerUser[_withdrawer];
        require(_amountMLP.add(_bookedAmountMLP) <= MozaicLP(mozaicLp).balanceOf(_withdrawer), "Withdraw amount > owned mLP");

        // add new withdraw amount to pending buffer
        _pendingBuffer.withdrawAmountPerUser[_withdrawer] = _pendingBuffer.withdrawAmountPerUser[_withdrawer].add(_amountMLP);

        // add withdraw request to pending buffer
        bool _exists = false;
        for (uint i; i < _pendingBuffer.withdrawRequestList.length; ++i) {
            WithdrawRequest storage _req = _pendingBuffer.withdrawRequestList[i];
            if (_req.user == _withdrawer && _req.token == _token && _req.chainId == _chainId) {
                _exists = true;
                break;
            }
        }
        if (!_exists) {
            WithdrawRequest memory _req;
            _req.user = _withdrawer;
            _req.token = _token;
            _req.chainId = _chainId;
            _pendingBuffer.withdrawRequestList.push(_req);
        }

        _pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token] = _pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token].add(_amountMLP);
        _pendingBuffer.totalWithdrawAmount = _pendingBuffer.totalWithdrawAmount.add(_amountMLP);
        _pendingBuffer.withdrawAmountPerToken[_token] = _pendingBuffer.withdrawAmountPerToken[_token].add(_amountMLP);

        emit WithdrawRequestAdded(_withdrawer, _token, _chainId, _amountMLP);
    }

    function _takeSnapshot() internal {
        require(_requests(true).totalDepositAmount==0, "Still processing requests");
        require(_requests(true).totalWithdrawAmount==0, "Still processing requests");

        // Stage Requests: Pending --> Processing
        bufferFlag = !bufferFlag;

        // Make Report
        // PoC: Right now Stargate logic is hard-coded. Need to move to each protocol driver.
        uint256 _totalStablecoinMD;

        for (uint i; i < acceptingTokens.length; ++i) {
            address _token = acceptingTokens[i];
            // Add stablecoins remaining in this vault
            _totalStablecoinMD = _totalStablecoinMD.add(getBalanceMDPerToken(_token));
            // Add stablecoins staked in stargate using stargateDriver
            // TODO: Do not specify driver type
            ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
            ProtocolDriver.ActionType _actionType = ProtocolDriver.ActionType.GetStakedAmountLD;
            bytes memory _payload = abi.encode(_token);
            (bool success, bytes memory response) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_actionType), _payload));
            require(success, "staked amount failed");
            (uint256 _amountStakedLD) = abi.decode(abi.decode(response, (bytes)), (uint256));
            uint256 _decimals = IERC20Metadata(_token).decimals();
            _totalStablecoinMD = _totalStablecoinMD.add(amountLDtoMD(_amountStakedLD, _decimals));
        }

        // TODO: Protocol-Specific Logic. Move to StargateDriver
        
        snapshot.totalStargate = IERC20(stargateToken).balanceOf(address(this));

        // Right now we don't consider that the vault keep stablecoin as staked asset before the session.
        snapshot.totalStablecoin = _totalStablecoinMD.sub(_requests(true).totalDepositAmount);
        snapshot.depositRequestAmount = _requests(true).totalDepositAmount;
        snapshot.withdrawRequestAmountMLP = _requests(true).totalWithdrawAmount;
        snapshot.totalMozaicLp = MozaicLP(mozaicLp).totalSupply();
    }

    function _reportSnapshot() internal {
        bytes memory lzPayload = abi.encode(PT_SNAPSHOT_REPORT, snapshot);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(primaryChainId, PT_SNAPSHOT_REPORT, LzTxObj((10**6), 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(primaryChainId, PT_SNAPSHOT_REPORT, LzTxObj((10**6), 0, "0x"));
        _lzSend(primaryChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    function _settleRequests() internal {
        // for all deposit requests, mint MozaicLp
        // TODO: Consider gas fee reduction possible.
        MozaicLP mozaicLpContract = MozaicLP(mozaicLp);
        RequestBuffer storage _reqs = _requests(true);
        for (uint i; i < _reqs.depositRequestList.length; ++i) {
            DepositRequest storage request = _reqs.depositRequestList[i];
            uint256 _depositAmountMD = _reqs.depositRequestLookup[request.user][request.token][request.chainId];
            if (_depositAmountMD == 0) {
                continue;
            }
            uint256 _amountMLPToMint = amountMDtoMLP(_depositAmountMD);
            mozaicLpContract.mint(request.user, _amountMLPToMint);
            // Reduce Handled Amount from Buffer
            _reqs.totalDepositAmount = _reqs.totalDepositAmount.sub(_depositAmountMD);
            _reqs.depositAmountPerToken[request.token] = _reqs.depositAmountPerToken[request.token].sub(_depositAmountMD);
            _reqs.depositRequestLookup[request.user][request.token][request.chainId] = _reqs.depositRequestLookup[request.user][request.token][request.chainId].sub(_depositAmountMD);
        }
        require(_reqs.totalDepositAmount == 0, "Has unsettled deposit amount.");

        // for all withdraw requests, give tokens
        for (uint i; i < _reqs.withdrawRequestList.length; ++i) {
            WithdrawRequest storage request = _reqs.withdrawRequestList[i];
            uint256 _withdrawAmountMLP = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token];
            if (_withdrawAmountMLP == 0) {
                continue;
            }
            uint256 _coinAmountMDtoGive = amountMLPtoMD(_withdrawAmountMLP);
            uint256 _coinAmountLDtoGive = amountMDtoLD(_coinAmountMDtoGive, IERC20Metadata(request.token).decimals());
            uint256 _vaultBalanceLD = IERC20(request.token).balanceOf(address(this));
            uint256 _mlpToBurn = _withdrawAmountMLP;
            if (_vaultBalanceLD < _coinAmountLDtoGive) {
                // The vault does not have enough balance. Only give as much as it has.
                _mlpToBurn = _withdrawAmountMLP.mul(_vaultBalanceLD).div(_coinAmountLDtoGive);
                _coinAmountLDtoGive = _vaultBalanceLD;
            }
            mozaicLpContract.burn(request.user, _mlpToBurn);
            _safeTransfer(request.user, request.token, _coinAmountLDtoGive);
            // Reduce Handled Amount from Buffer
            _reqs.totalWithdrawAmount = _reqs.totalWithdrawAmount.sub(_withdrawAmountMLP);
            _reqs.withdrawAmountPerToken[request.token] = _reqs.withdrawAmountPerToken[request.token].sub(_withdrawAmountMLP);
            _reqs.withdrawAmountPerUser[request.user] = _reqs.withdrawAmountPerUser[request.user].sub(_withdrawAmountMLP);
            _reqs.withdrawRequestLookup[request.user][request.chainId][request.token] = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token].sub(_withdrawAmountMLP);
            
        }
        require(_reqs.totalWithdrawAmount == 0, "Has unsettled withdrawal amount.");
    }

    function _reportSettled() internal {
        bytes memory lzPayload = abi.encode(PT_SETTLED_REPORT);
        (uint256 _nativeFee, ) = quoteLayerZeroFee(primaryChainId, PT_SETTLED_REPORT, LzTxObj((10**6), 0, "0x"));
        bytes memory _adapterParams = _txParamBuilder(primaryChainId, PT_SETTLED_REPORT, LzTxObj((10**6), 0, "0x"));
        _lzSend(primaryChainId, lzPayload, payable(address(this)), address(0x0), _adapterParams, _nativeFee);
    }

    //---------------------------------------------------------------------------
    // INTERNAL
    function _safeTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _value
    ) internal {
        IERC20(_token).transferFrom(_from, _to, _value);
    }

    function _safeTransfer(address _user, address _token, uint256 _amountLD) internal {
        IERC20(_token).transfer(_user, _amountLD);
    } 

    function registerVault(uint16 _chainId, address _addr) public onlyOwner {
        bool isNew = true;
        for (uint i; i < chainIds.length; ++i) {
            if (chainIds[i] == _chainId) {
                isNew = false;
                break;
            }
        }
        if (isNew) {
            chainIds.push(_chainId);
        }
        vaults[_chainId] = VaultDescriptor(_addr, VaultStatus.IDLE);

        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("registerVault(uint16,address)", _chainId, _addr));
        require(success, "register vault failed");

    }

    // function getVaultsCount() public view returns (uint256) {
    //     return chainIds.length;
    // }

    function setGasAmount(
        uint16 _chainId,
        uint16 _packetType,
        uint256 _gasAmount
    ) external onlyOwner {
        // TODO: require invalid packetType
        gasLookup[_chainId][_packetType] = _gasAmount;
    }

    function txParamBuilderType1(uint256 _gasAmount) internal pure returns (bytes memory) {
        uint16 txType = 1;
        return abi.encodePacked(txType, _gasAmount);
    }

    function txParamBuilderType2(
        uint256 _gasAmount,
        uint256 _dstNativeAmount,
        bytes memory _dstNativeAddr
    ) internal pure returns (bytes memory) {
        uint16 txType = 2;
        return abi.encodePacked(txType, _gasAmount, _dstNativeAmount, _dstNativeAddr);
    }

    function _txParamBuilder(
        uint16 _chainId,
        uint16 _packetType,
        LzTxObj memory _lzTxParams
    ) internal view returns (bytes memory) {
        bytes memory lzTxParam;
        address dstNativeAddr;
        {
            bytes memory dstNativeAddrBytes = _lzTxParams.dstNativeAddr;
            assembly {
                dstNativeAddr := mload(add(dstNativeAddrBytes, 20))
            }
        }

        uint256 totalGas = gasLookup[_chainId][_packetType].add(_lzTxParams.dstGasForCall);
        if (_lzTxParams.dstNativeAmount > 0 && dstNativeAddr != address(0x0)) {
            lzTxParam = txParamBuilderType2(totalGas, _lzTxParams.dstNativeAmount, _lzTxParams.dstNativeAddr);
        } else {
            lzTxParam = txParamBuilderType1(totalGas);
        }

        return lzTxParam;
    }

    function quoteLayerZeroFee(
        uint16 _chainId,
        uint16 _packetType,
        LzTxObj memory _lzTxParams
    ) public view virtual returns (uint256 _nativeFee, uint256 _zroFee) {
        bytes memory payload = "";
        if (_packetType == PT_SNAPSHOT_REPORT) {
            payload = abi.encode(PT_SNAPSHOT_REPORT, snapshot);
        } else if (_packetType == PT_SETTLED_REPORT) {
            payload = abi.encode(PT_SETTLED_REPORT);
        } else {
            revert("Unknown packet type");
        }

        bytes memory _adapterParams = _txParamBuilder(_chainId, _packetType, _lzTxParams);
        return lzEndpoint.estimateFees(_chainId, address(this), payload, false, _adapterParams);
    }

    function amountLDtoMD(uint256 _amountLD, uint256 _localDecimals) public pure returns (uint256) {
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountLD.mul(10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountLD.div(10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function amountMDtoLD(uint256 _amountMD, uint256 _localDecimals) public pure returns (uint256) {
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountMD.div(10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountMD.mul(10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function amountMDtoMLP(uint256 _amountMD) public view returns (uint256) {
        if (totalBalanceMD == 0) {
            return _amountMD;
        } else {
            return _amountMD.mul(totalMLP).div(totalBalanceMD);
        }
    }

    function amountMLPtoMD(uint256 _amountMLP) public view returns (uint256) {
        if (totalMLP == 0) {
            return _amountMLP;
        } else {
            return _amountMLP.mul(totalBalanceMD).div(totalMLP);
        }
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId, 
        bytes memory _srcAddress, 
        uint64 _nonce, 
        bytes memory _payload
    ) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_TAKE_SNAPSHOT) {
            _takeSnapshot();
            _reportSnapshot();

        } else if (packetType == PT_SETTLE_REQUESTS) {
            (, totalBalanceMD, totalMLP) = abi.decode(_payload, (uint16, uint256, uint256));
            _settleRequests();
            _reportSettled();

        } else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
}