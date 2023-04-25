// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

// imports
import "./ProtocolDriver.sol";
import "./MozaicLP.sol";
import "./MozaicBridge.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

contract MozaicVault is Ownable {
    using SafeERC20 for IERC20;

    /***********************************************/
    /****************** CONSTANTS ******************/
    /***********************************************/
    uint16 public constant STG_DRIVER_ID = 1;
    uint16 public constant PANCAKE_DRIVER_ID = 2;
    uint8 public constant MOZAIC_DECIMALS = 6;    // set to shared decimals
    bytes4 public constant SELECTOR_CONVERTSDTOLD = 0xdef46aa8;
    bytes4 public constant SELECTOR_CONVERTLDTOSD = 0xb53cf239;
    uint16 internal constant PT_TAKE_SNAPSHOT = 11;
    uint16 internal constant PT_SNAPSHOT_REPORT = 12;
    uint16 internal constant PT_PRE_SETTLE = 13;
    uint16 internal constant PT_SETTLED_REPORT = 14;

    /***********************************************/
    /******************** ENUMS ********************/
    /***********************************************/
    enum ProtocolStatus {
        IDLE,
        SNAPSHOTTING,
        OPTIMIZING,
        SETTLING
    }

    /***********************************************/
    /******************* STRUCTS *******************/
    /***********************************************/
    struct Action {
        uint256 driverId;
        ProtocolDriver.ActionType actionType;
        bytes payload;
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

    struct Snapshot {
        uint256 depositRequestAmount;
        uint256 withdrawRequestAmountMLP;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalMozaicLp; // Mozaic "LP"
    }

    /***********************************************/
    /****************** VARIABLES ******************/
    /***********************************************/
    uint16 public chainId;
    address public stargateToken;
    address[] public acceptingTokens;
    MozaicLP public mozaicLp;
    mapping(address => bool) public tokenMap;
    mapping (uint256=>ProtocolDriver) public protocolDrivers;

    bool public bufferFlag = false; // false ==> Left=pending Right=staged; true ==> Left=staged Right=pending
    RequestBuffer public leftBuffer;
    RequestBuffer public rightBuffer;
    uint256 public totalCoinMD;
    uint256 public totalMLP;
    uint16 public mainChainId;
    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot
    ProtocolStatus public protocolStatus;
    uint256 public numUnchecked;
    bool public settleAllowed;
    uint16[] public chainIdsToSettle;
    MozaicBridge public bridge;
    uint16[] public chainIds;

    /***********************************************/
    /******************* EVENTS ********************/
    /***********************************************/
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

    /***********************************************/
    /****************** MODIFIERS ******************/
    /***********************************************/
    modifier onlyMain() {
        require(chainId == mainChainId, "Only main chain");
        _;
    }

    modifier onlyBridge() {
        require(msg.sender == address(bridge), "Only bridge");
        _;
    }

    /***********************************************/
    /**************** CONSTRUCTOR ******************/
    /***********************************************/
    constructor() {}

    // Use this function to receive an amount of native token equals to msg.value from msg.sender
    receive() external payable {}

    /***********************************************/
    /************* EXTERNAL FUNCTIONS **************/
    /***********************************************/
    // Functions for configuration
    function setProtocolDriver(
        uint256 _driverId,
        ProtocolDriver _driver,
        bytes calldata _config
    ) external onlyOwner {
        protocolDrivers[_driverId] = _driver;
        // 0x0db03cba = bytes4(keccak256(bytes('configDriver(bytes)')));
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSelector(0x0db03cba, _config));
        require(success, "set driver failed");
    }

    function setContracts(
        address _stargateToken,
        address _mozaicLp,
        address _bridge
    ) external onlyOwner {
        require(
            _stargateToken != address(0x0) &&
            _mozaicLp != address(0x0) &&
            _bridge != address(0x0),
            "Invalid addresses"
        );
        stargateToken = _stargateToken;
        mozaicLp = MozaicLP(_mozaicLp);
        bridge = MozaicBridge(_bridge);
    }

    function setChainId(uint16 _chainId) external onlyOwner {
        require(_chainId > 0, "Invalid chainId");
        chainId = _chainId;
    }

    function setMainChainId(uint16 _mainChainId) external onlyOwner {
        require(_mainChainId > 0, "Invalid main chainId");
        mainChainId = _mainChainId;
    }

    function registerVaults(
        uint16[] memory _chainIds,
        address[] memory _addrs
    ) external onlyOwner {
        chainIds = _chainIds;
        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("registerVaults(uint16[],address[])", _chainIds, _addrs));
        require(success, "register vault failed");
    }

    function addToken(address _token) external onlyOwner {
        if (tokenMap[_token] == false) {
            tokenMap[_token] = true;
            acceptingTokens.push(_token);
        }
    }

    function removeToken(address _token) external onlyOwner {
        if (tokenMap[_token] == true) {
            tokenMap[_token] = false;
            for (uint i; i < acceptingTokens.length; ++i) {
                if (acceptingTokens[i] == _token) {
                    acceptingTokens[i] = acceptingTokens[acceptingTokens.length - 1];
                    acceptingTokens.pop();
                    return;
                }
            }
        }
    }

    // Functions for control center
    function initOptimizationSession() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.IDLE, "Protocol must be idle");
        numUnchecked = chainIds.length;
        for (uint i; i < chainIds.length; ++i) {
            _requestSnapshot(chainIds[i]);
        }
        protocolStatus = ProtocolStatus.SNAPSHOTTING;
    }

    function preSettleAllVaults() external onlyOwner onlyMain {
        require(protocolStatus == ProtocolStatus.OPTIMIZING, "Protocol must be optimizing");
        numUnchecked = 0;
        delete chainIdsToSettle;
        for (uint i; i < chainIds.length; ++i) {
            uint16 _chainId = chainIds[i];
            if(snapshotReported[_chainId].depositRequestAmount == 0 &&
                snapshotReported[_chainId].withdrawRequestAmountMLP == 0) {
                continue;
            }
            else {
                _requestPreSettle(_chainId);
                chainIdsToSettle.push(_chainId);
                ++numUnchecked;
            }
        }

        protocolStatus = ProtocolStatus.SETTLING;
    }

    function settleRequests() external onlyOwner {
        require(settleAllowed == true, "Not allowed to settle");

        _settleRequests();

        if (chainId == mainChainId) {
            _receiveSettledReport(chainId);
        }
        else {
            _reportSettled();
        }
        settleAllowed = false;
    }

    function executeActions(Action[] calldata _actions) external onlyOwner {
        for (uint i; i < _actions.length ; ++i) {
            Action calldata _action = _actions[i];
            ProtocolDriver _driver = protocolDrivers[_action.driverId];
            (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_action.actionType), _action.payload));
            require(success, "delegatecall failed");
        }
    }

    // Functions for bridge
    function takeAndReportSnapshot() external onlyBridge {
        Snapshot memory snapshot = _takeSnapshot();
        _reportSnapshot(snapshot);
    }

    function receiveSnapshotReport(
        Snapshot memory snapshot,
        uint16 _srcChainId
    ) external onlyBridge onlyMain {
        _receiveSnapshotReport(snapshot, _srcChainId);
    }

    function preSettle(
        uint256 _totalCoinMD,
        uint256 _totalMLP
    ) external onlyBridge {
        _preSettle(_totalCoinMD, _totalMLP);
    }

    function receiveSettledReport(uint16 _srcChainId) external onlyBridge onlyMain {
        _receiveSettledReport(_srcChainId);
    }

    // Functions for users
    function addDepositRequest(
        uint256 _amountLD,
        address _token,
        uint16 _chainId
    ) external {
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
        uint256 _amountMD = convertLDtoMD(_token, _amountLDAccept);
        _pendingBuffer.depositRequestLookup[_depositor][_token][_chainId] = _pendingBuffer.depositRequestLookup[_depositor][_token][_chainId] + _amountMD;
        _pendingBuffer.totalDepositAmount = _pendingBuffer.totalDepositAmount + _amountMD;
        _pendingBuffer.depositAmountPerToken[_token] = _pendingBuffer.depositAmountPerToken[_token] + _amountMD;

        emit DepositRequestAdded(_depositor, _token, _chainId, _amountMD);
    }

    function addWithdrawRequest(
        uint256 _amountMLP,
        address _token,
        uint16 _chainId
    ) external {
        require(_chainId == chainId, "withdraw onchain on PoC");
        require(isAcceptingToken(_token), "should be accepting token");

        address _withdrawer = msg.sender;
        RequestBuffer storage _pendingBuffer = _requests(false);
        RequestBuffer storage _stagedBuffer = _requests(true);

        // check amount MLP user has, if not enough, revert
        uint256 _bookedAmountMLP = _pendingBuffer.withdrawAmountPerUser[_withdrawer] + _stagedBuffer.withdrawAmountPerUser[_withdrawer];
        require(_amountMLP + _bookedAmountMLP <= mozaicLp.balanceOf(_withdrawer), "Withdraw amount > owned mLP");
        // add new withdraw amount to pending buffer
        _pendingBuffer.withdrawAmountPerUser[_withdrawer] = _pendingBuffer.withdrawAmountPerUser[_withdrawer] + _amountMLP;
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
        _pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token] = _pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token] + _amountMLP;
        _pendingBuffer.totalWithdrawAmount = _pendingBuffer.totalWithdrawAmount + _amountMLP;
        _pendingBuffer.withdrawAmountPerToken[_token] = _pendingBuffer.withdrawAmountPerToken[_token] + _amountMLP;

        emit WithdrawRequestAdded(_withdrawer, _token, _chainId, _amountMLP);
    }

    /***********************************************/
    /************** PUBLIC FUNCTIONS ***************/
    /***********************************************/
    function getDepositAmount(
        bool _staged,
        address _user,
        address _token,
        uint16 _chainId
    ) public view returns (uint256) {
        return _requests(_staged).depositRequestLookup[_user][_token][_chainId];
    }

    function getWithdrawAmount(
        bool _staged,
        address _user,
        uint16 _chainId,
        address _token
    ) public view returns (uint256) {
        return _requests(_staged).withdrawRequestLookup[_user][_chainId][_token];
    }

    function getDepositRequest(
        bool _staged,
        uint256 _index
    ) public view returns (DepositRequest memory) {
        return _requests(_staged).depositRequestList[_index];
    }

    function getWithdrawRequest(
        bool _staged,
        uint256 _index
    ) public view returns (WithdrawRequest memory) {
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

    function getDepositAmountPerToken(
        bool _staged,
        address _token
    ) public view returns (uint256) {
        return _requests(_staged).depositAmountPerToken[_token];
    }

    function getWithdrawAmountPerToken(
        bool _staged,
        address _token
    ) public view returns (uint256) {
        return _requests(_staged).withdrawAmountPerToken[_token];
    }

    function getChainIdsToSettleLength() public view returns (uint256) {
        return chainIdsToSettle.length;
    }

    function convertLDtoMD(
        address _token,
        uint256 _amountLD
    ) public view returns (uint256) {
        uint8 _localDecimals = IERC20Metadata(_token).decimals();
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountLD * (10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountLD / (10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function convertMDtoLD(
        address _token,
        uint256 _amountMD
    ) public view returns (uint256) {
        uint8 _localDecimals = IERC20Metadata(_token).decimals();
        if (MOZAIC_DECIMALS >= _localDecimals) {
            return _amountMD / (10**(MOZAIC_DECIMALS - _localDecimals));
        } else {
            return _amountMD * (10**(_localDecimals - MOZAIC_DECIMALS));
        }
    }

    function amountMDtoMLP(uint256 _amountMD) public view returns (uint256) {
        if (totalCoinMD == 0) {
            return _amountMD;
        } else {
            return _amountMD * totalMLP / totalCoinMD;
        }
    }

    function amountMLPtoMD(uint256 _amountMLP) public view returns (uint256) {
        if (totalMLP == 0) {
            return _amountMLP;
        } else {
            return _amountMLP * totalCoinMD / totalMLP;
        }
    }

    function isAcceptingToken(address _token) public view returns (bool) {
        return tokenMap[_token];
    }

    // Use this function to return balance to msg.sender
    function returnBalance() public onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) {
            return;
        }
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Return balance failed");
    }

    /***********************************************/
    /************* INTERNAL FUNCTIONS **************/
    /***********************************************/
    function _requests(bool staged) internal view returns (RequestBuffer storage) {
        return staged ? (bufferFlag ? rightBuffer : leftBuffer) : (bufferFlag ? leftBuffer : rightBuffer);
    }

    function _safeTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _value
    ) internal {
        IERC20(_token).transferFrom(_from, _to, _value);
    }

    function _safeTransfer(
        address _user,
        address _token,
        uint256 _amountLD
    ) internal {
        IERC20(_token).transfer(_user, _amountLD);
    }

    /**
    * NOTE: PoC: need to move to StargateDriver in next phase of development.
     */
    function _getStargatePriceMil() internal pure returns (uint256) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        // KEVIN-TODO:
        return 1000000;
    }

    function _updateStats() internal {
        uint256 _stargatePriceMil = _getStargatePriceMil();
        // totalMLP - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        totalCoinMD = 0;
        totalMLP = 0;
        for (uint i; i < chainIds.length ; ++i) {
            Snapshot storage report = snapshotReported[chainIds[i]];
            totalCoinMD = totalCoinMD + report.totalStablecoin + report.totalStargate * _stargatePriceMil / 1000000;
            totalMLP = totalMLP + report.totalMozaicLp;
        }
    }

    function _takeSnapshot() internal returns (Snapshot memory snapshot) {
        require(_requests(true).totalDepositAmount==0, "Still processing requests");
        require(_requests(true).totalWithdrawAmount==0, "Still processing requests");
        // Stage Requests: Pending --> Processing
        bufferFlag = !bufferFlag;
        // Get total assets as MD
        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        ProtocolDriver.ActionType _actionType = ProtocolDriver.ActionType.GetTotalAssetsMD;
        bytes memory _payload = abi.encode(acceptingTokens);
        (bool success, bytes memory response) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_actionType), _payload));
        require(success, "get assets failed");
        (uint256 _totalStablecoinMD) = abi.decode(abi.decode(response, (bytes)), (uint256));
        // TODO: Protocol-Specific Logic. Move to StargateDriver
        snapshot.totalStargate = IERC20(stargateToken).balanceOf(address(this));
        // Right now we don't consider that the vault keep stablecoin as staked asset before the session.
        snapshot.totalStablecoin = _totalStablecoinMD - _requests(true).totalDepositAmount;
        snapshot.depositRequestAmount = _requests(true).totalDepositAmount;
        snapshot.withdrawRequestAmountMLP = _requests(true).totalWithdrawAmount;
        snapshot.totalMozaicLp = mozaicLp.totalSupply();
    }

    function _settleRequests() internal {
        // for all deposit requests, mint MozaicLp
        // TODO: Consider gas fee reduction possible.
        RequestBuffer storage _reqs = _requests(true);
        for (uint i; i < _reqs.depositRequestList.length; ++i) {
            DepositRequest storage request = _reqs.depositRequestList[i];
            uint256 _depositAmountMD = _reqs.depositRequestLookup[request.user][request.token][request.chainId];
            if (_depositAmountMD == 0) {
                continue;
            }
            uint256 _amountMLPToMint = amountMDtoMLP(_depositAmountMD);
            mozaicLp.mint(request.user, _amountMLPToMint);
            // Reduce Handled Amount from Buffer
            _reqs.totalDepositAmount = _reqs.totalDepositAmount - _depositAmountMD;
            _reqs.depositAmountPerToken[request.token] = _reqs.depositAmountPerToken[request.token] - _depositAmountMD;
            _reqs.depositRequestLookup[request.user][request.token][request.chainId] = _reqs.depositRequestLookup[request.user][request.token][request.chainId] - _depositAmountMD;
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
            uint256 _coinAmountLDtoGive = convertMDtoLD(request.token, _coinAmountMDtoGive);
            uint256 _vaultBalanceLD = IERC20(request.token).balanceOf(address(this));
            uint256 _mlpToBurn = _withdrawAmountMLP;
            if (_vaultBalanceLD < _coinAmountLDtoGive) {
                // The vault does not have enough balance. Only give as much as it has.
                _mlpToBurn = _withdrawAmountMLP * _vaultBalanceLD / _coinAmountLDtoGive;
                _coinAmountLDtoGive = _vaultBalanceLD;
            }
            mozaicLp.burn(request.user, _mlpToBurn);
            _safeTransfer(request.user, request.token, _coinAmountLDtoGive);
            // Reduce Handled Amount from Buffer
            _reqs.totalWithdrawAmount = _reqs.totalWithdrawAmount - _withdrawAmountMLP;
            _reqs.withdrawAmountPerToken[request.token] = _reqs.withdrawAmountPerToken[request.token] - _withdrawAmountMLP;
            _reqs.withdrawAmountPerUser[request.user] = _reqs.withdrawAmountPerUser[request.user] - _withdrawAmountMLP;
            _reqs.withdrawRequestLookup[request.user][request.chainId][request.token] = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token] - _withdrawAmountMLP;
        }
        require(_reqs.totalWithdrawAmount == 0, "Has unsettled withdrawal amount.");
    }

    function _requestSnapshot(uint16 _dstChainId) internal {
        if (_dstChainId == mainChainId) {
            Snapshot memory snapshot = _takeSnapshot();
            _receiveSnapshotReport(snapshot, _dstChainId);
        }
        else {
            (uint256 _nativeFee, ) = bridge.quoteLayerZeroFee(_dstChainId, PT_TAKE_SNAPSHOT, MozaicBridge.LzTxObj(0, 0, "0x"));
            bridge.requestSnapshot{value: _nativeFee}(_dstChainId);
        }
    }

    function _reportSnapshot(Snapshot memory snapshot) internal {
        (uint256 _nativeFee, ) = bridge.quoteLayerZeroFee(mainChainId, PT_SNAPSHOT_REPORT, MozaicBridge.LzTxObj(0, 0, "0x"));
        bridge.reportSnapshot{value: _nativeFee}(mainChainId, snapshot);
    }

    function _requestPreSettle(uint16 _dstChainId) internal {
        if (_dstChainId == mainChainId) {
            _preSettle(totalCoinMD, totalMLP);
        }
        else {
            (uint256 _nativeFee, ) = bridge.quoteLayerZeroFee(_dstChainId, PT_PRE_SETTLE, MozaicBridge.LzTxObj(0, 0, "0x"));
            bridge.requestPreSettle{value: _nativeFee}(_dstChainId, totalCoinMD, totalMLP);
        }
    }

    function _reportSettled() internal {
        (uint256 _nativeFee, ) = bridge.quoteLayerZeroFee(mainChainId, PT_SETTLED_REPORT, MozaicBridge.LzTxObj(0, 0, "0x"));
        bridge.reportSettled{value: _nativeFee}(mainChainId);
    }

    function _receiveSnapshotReport(Snapshot memory snapshot, uint16 _srcChainId) internal {
        numUnchecked = numUnchecked - 1;
        snapshotReported[_srcChainId] = snapshot;
        if (numUnchecked == 0) {
            _updateStats();
            protocolStatus = ProtocolStatus.OPTIMIZING;
        }
    }

    function _receiveSettledReport(uint16 _srcChainId) internal {
        numUnchecked = numUnchecked - 1;
        if (numUnchecked == 0) {
            protocolStatus = ProtocolStatus.IDLE;
        }
    }

    function _preSettle(uint256 _totalCoinMD, uint256 _totalMLP) internal {
        settleAllowed = true;
        totalCoinMD = _totalCoinMD;
        totalMLP = _totalMLP;
    }
}
