pragma solidity ^0.8.9;

// imports
import "../libraries/lzApp/NonblockingLzApp.sol";
import "./ProtocolDriver.sol";
import "./MozaicLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

// import "hardhat/console.sol";

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

    event Received (
        address indexed sender,
        uint256 amount
    );

    //--------------------------------------------------------------------------
    // CONSTANTS
    uint16 public constant PT_REPORTSNAPSHOT = 10001;
    uint16 public constant PT_SETTLE_REQUESTS = 10002;
    uint16 public constant PT_SETTLED_REQUESTS = 10003;
    uint16 public constant STG_DRIVER_ID = 1;
    uint16 public constant PANCAKE_DRIVER_ID = 2;

    bytes4 public constant SELECTOR_CONVERTSDTOLD = 0xdef46aa8;
    bytes4 public constant SELECTOR_CONVERTLDTOSD = 0xb53cf239;
    
    enum VaultStatus {
        // No staged requests. Neutral status.
        IDLE,

        // (Primary Vault vision) Primary Vault thinks Secondary Vault is snapshotting. But haven't got report yet.
        SNAPSHOTTING,

        // (Secondary Vault vision) Secondary Vault knows it staged requests and made snapshot. It sent snapshot report, but doesn't care the rest.
        // (Primary Vault vision) Primary Vault got snapshot report from the Secondary Vault.
        SNAPSHOTTED,

        // (Primary Vault vision) Primary Vault sent "settle" message to Secondary Vault. Thinks it is settling requests now.
        SETTLING
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


    //---------------------------------------------------------------------------
    // VARIABLES
    mapping (uint256 => ProtocolDriver) public protocolDrivers;
    VaultStatus public status;
    Snapshot public snapshot;
    address public stargateLpStaking;
    address public stargateToken;
    address public mozaicLp;
    uint16 public primaryChainId = 0;
    uint16 public chainId = 0;
    address[] public acceptingTokens;

    bool public bufferFlag = false; // false ==> Left=pending Right=processing; true ==> Left=processing Right=pending
    RequestBuffer public leftBuffer;
    RequestBuffer public rightBuffer;

    uint16[] public chainIds;

    struct VaultInfo {
        address vaultAddress;
        VaultStatus vaultStatus;
    }

    mapping(uint16 => VaultInfo) public vaultInfos;

    // For primary
    enum ProtocolStatus {
        IDLE,
        OPTIMIZING
    }
    ProtocolStatus public protocolStatus;
    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot
    uint256 public mozaicLpPerStablecoinMil = 0; // mozLP/stablecoinSD*1_000_000
    uint256 public constant INITIAL_MLP_PER_COIN_MIL = 1000000;

    function _pendingReqs() internal view returns (RequestBuffer storage) {
        if (bufferFlag) {
            return leftBuffer;
        }
        else {
            return rightBuffer;
        }
    }

    function _stagedReqs() internal view returns (RequestBuffer storage) {
        if (bufferFlag) {
            return rightBuffer;
        }
        else {
            return leftBuffer;
        }
    }

    function getDepositAmount(bool _staged, address _user, address _token, uint16 _chainId) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().depositRequestLookup[_user][_token][_chainId];
        }
        else {
            return _pendingReqs().depositRequestLookup[_user][_token][_chainId];
        }
    }

    function getWithdrawAmount(bool _staged, address _user, uint16 _chainId, address _token) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().withdrawRequestLookup[_user][_chainId][_token];
        }
        else {
            return _pendingReqs().withdrawRequestLookup[_user][_chainId][_token];
        }
    }

    function getDepositRequest(bool _staged, uint256 _index) public view returns (DepositRequest memory) {
        if (_staged) {
            return _stagedReqs().depositRequestList[_index];
        }
        else {
            return _pendingReqs().depositRequestList[_index];
        }
    }

    function getWithdrawRequest(bool _staged, uint256 _index) public view returns (WithdrawRequest memory) {
        if (_staged) {
            return _stagedReqs().withdrawRequestList[_index];
        }
        else {
            return _pendingReqs().withdrawRequestList[_index];
        }
    }

    function getTotalDepositAmount(bool _staged) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().totalDepositAmount;
        }
        else {
            return _pendingReqs().totalDepositAmount;
        }
    }

    function getTotalWithdrawAmount(bool _staged) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().totalWithdrawAmount;
        }
        else {
            return _pendingReqs().totalWithdrawAmount;
        }
    }

    function getDepositRequestListLength(bool _staged) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().depositRequestList.length;
        }
        else {
            return _pendingReqs().depositRequestList.length;
        }
    }

    function getWithdrawRequestListLength(bool _staged) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().withdrawRequestList.length;
        }
        else {
            return _pendingReqs().withdrawRequestList.length;
        }
    }

    function getDepositAmountPerToken(bool _staged, address _token) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().depositAmountPerToken[_token];
        }
        else {
            return _pendingReqs().depositAmountPerToken[_token];
        }
    }

    function getWithdrawAmountPerToken(bool _staged, address _token) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().withdrawAmountPerToken[_token];
        }
        else {
            return _pendingReqs().withdrawAmountPerToken[_token];
        }
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
        require(success, "Failed to return balance.");
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
        status = VaultStatus.IDLE;
        protocolStatus = ProtocolStatus.IDLE;
    }

    function setProtocolDriver(uint256 _driverId, ProtocolDriver _driver, bytes calldata _config) public onlyOwner {
        protocolDrivers[_driverId] = _driver;
        // 0x0db03cba = bytes4(keccak256(bytes('configDriver(bytes)')));
        (bool _success, ) = address(_driver).delegatecall(abi.encodeWithSelector(0x0db03cba, _config));
        require(_success, "Failed to access configDriver in setProtocolDriver");
    }

    function addToken(address _token) public onlyOwner {
        for (uint i = 0; i < acceptingTokens.length; i++) {
            if (acceptingTokens[i] == _token) {
                return;
            }
        }
        acceptingTokens.push(_token);
    }

    function removeToken(address _token) public onlyOwner {
        // TODO: Make sure there's no asset as this token.
        uint _idxToken = acceptingTokens.length;
        for (uint i = 0; i < acceptingTokens.length; i++) {
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
        for (uint i = 0; i < acceptingTokens.length; i++) {
            if (acceptingTokens[i] == _token) {
                return true;
            }
        }
        return false;
    }

    function executeActions(Action[] calldata _actions) external onlyOwner {
        for (uint i = 0; i < _actions.length ; i++) {
            Action calldata _action = _actions[i];
            ProtocolDriver _driver = protocolDrivers[_action.driverId];
            (bool success, bytes memory response) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_action.actionType), _action.payload));
            (string memory errorMessage) = abi.decode(response, (string));
            require(success, errorMessage);
        }
    }

    /**
     * Add Deposit Request
     */
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
        RequestBuffer storage buffer = _pendingReqs();
        bool exists = false;
        for (uint i = 0; i < buffer.depositRequestList.length; i++) {
            DepositRequest memory req = buffer.depositRequestList[i];
            if (req.user == _depositor && req.token == _token) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            DepositRequest memory req;
            req.user = _depositor;
            req.token = _token;
            req.chainId = _chainId;
            buffer.depositRequestList.push(req);
        }
        buffer.depositRequestLookup[_depositor][_token][_chainId] = buffer.depositRequestLookup[_depositor][_token][_chainId].add(_amountLDAccept);
        buffer.totalDepositAmount = buffer.totalDepositAmount.add(_amountLDAccept);
        buffer.depositAmountPerToken[_token] = buffer.depositAmountPerToken[_token].add(_amountLDAccept);

        emit DepositRequestAdded(_depositor, _token, _chainId, _amountLDAccept);
    }

    function addWithdrawRequest(uint256 _amountMLP, address _token, uint16 _chainId) public {
        require(_chainId == chainId, "PoC restriction - withdraw onchain");
        require(primaryChainId > 0, "main chain should be set");
        require(isAcceptingToken(_token), "should be accepting token");

        address _withdrawer = msg.sender;
        RequestBuffer storage pendingBuffer = _pendingReqs();
        RequestBuffer storage stagedBuffer = _stagedReqs();
        // check if the user has enough balance
        pendingBuffer.withdrawAmountPerUser[_withdrawer] = pendingBuffer.withdrawAmountPerUser[_withdrawer].add(_amountMLP);
        require (pendingBuffer.withdrawAmountPerUser[_withdrawer].add(stagedBuffer.withdrawAmountPerUser[_withdrawer]) <= MozaicLP(mozaicLp).balanceOf(_withdrawer), "Withdraw amount > owned mLP");

        // add withdraw request to pending buffer
        bool _exists = false;
        for (uint i = 0; i < pendingBuffer.withdrawRequestList.length; i++) {
            WithdrawRequest memory req = pendingBuffer.withdrawRequestList[i];
            if (req.user == _withdrawer && req.token == _token && req.chainId == _chainId) {
                _exists = true;
                break;
            }
        }
        if (!_exists) {
            WithdrawRequest memory req;
            req.user = _withdrawer;
            req.token = _token;
            req.chainId = _chainId;
            pendingBuffer.withdrawRequestList.push(req);
        }

        pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token] = pendingBuffer.withdrawRequestLookup[_withdrawer][_chainId][_token].add(_amountMLP);
        pendingBuffer.totalWithdrawAmount = pendingBuffer.totalWithdrawAmount.add(_amountMLP);
        pendingBuffer.withdrawAmountPerToken[_token] = pendingBuffer.withdrawAmountPerToken[_token].add(_amountMLP);

        emit WithdrawRequestAdded(_withdrawer, _token, _chainId, _amountMLP);
    }

    /**
    * Make Snapshot.
    * Save as State Variable.
    * Return Snapshot to caller.
    * NOTE:
    * Turn vault status into SNAPSHOTTED, not allowing snapshotting again in a session.
    **/
    function takeSnapshot() public onlyOwner returns (Snapshot memory) {
        if (status == VaultStatus.IDLE) {
            status = VaultStatus.SNAPSHOTTED;
            return _takeSnapshot();
        }
        else if (status == VaultStatus.SNAPSHOTTED) {
            return snapshot;
        }
        else {
            revert("snapshot: Unexpected Status");
        }
    }

    /**
    * Report snapshot. Need to call snapshot() before.
    * NOTE: 
    * Does not turn into SNAPSHOTREPORTED status.
    * Allowing double execution. Just giving freedom to report again at additional cost.
    **/
    function reportSnapshot() virtual public payable onlyOwner {
        require(status == VaultStatus.SNAPSHOTTED, "reportSnapshotted: Not snapshotted yet.");

        if (chainId == primaryChainId) {
            _acceptSnapshot(chainId, snapshot);
        } else {
            bytes memory lzPayload = abi.encode(PT_REPORTSNAPSHOT, snapshot);
            _lzSend(primaryChainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
        }
    }

    function _clearPendingBuffer() internal {
        // Clear Pending
        RequestBuffer storage pending = _pendingReqs();
        require(pending.totalDepositAmount == 0, "expected totalDeposit = 0");
        require(pending.totalWithdrawAmount == 0, "expected totalWithdraw = 0");
        delete pending.depositRequestList;
        delete pending.withdrawRequestList;
    }

    function _takeSnapshot() internal virtual returns (Snapshot memory result){
        require(_stagedReqs().totalDepositAmount==0, "Still has processing requests");
        require(_stagedReqs().totalWithdrawAmount==0, "Still has processing requests");

        // Stage Requests: Pending --> Processing
        bufferFlag = !bufferFlag;

        // Make Report
        // PoC: Right now Stargate logic is hard-coded. Need to move to each protocol driver.
        uint256 _totalStablecoin = 0;

        // Add stablecoins remaining in this vault
        for (uint i = 0; i < acceptingTokens.length; i++) {
            _totalStablecoin = _totalStablecoin.add(IERC20(acceptingTokens[i]).balanceOf(address(this)));
        }

        // Add stablecoins staked in stargate using stargateDriver
        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        ProtocolDriver.ActionType _actionType = ProtocolDriver.ActionType.GetStakedAmount;
        bytes memory _payload;
        (bool success, bytes memory data) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_actionType), _payload));
        require(success, "Failed to delegate to ProtocolDriver in _takeSnapshot");
        (uint256 _amountStaked) = abi.decode(abi.decode(data, (bytes)), (uint256));
        _totalStablecoin = _totalStablecoin.add(_amountStaked);

        result.totalStargate = IERC20(stargateToken).balanceOf(address(this));

        // Right now we don't consider that the vault keep stablecoin as staked asset before the session.
        result.totalStablecoin = _totalStablecoin.sub(_stagedReqs().totalDepositAmount).sub(_pendingReqs().totalDepositAmount);
        result.depositRequestAmount = _stagedReqs().totalDepositAmount;
        result.withdrawRequestAmountMLP = _stagedReqs().totalWithdrawAmount;
        result.totalMozaicLp = MozaicLP(mozaicLp).totalSupply();
        snapshot = result;
    }

    //---------------------------------------------------------------------------
    // VIEWS

    //---------------------------------------------------------------------------
    // INTERNAL
    function _safeTransferFrom(
        address _token,
        address _from,
        address _to,
        uint256 _value
    ) private {
        // bytes4(keccak256(bytes('transferFrom(address,address,uint256)')));
        (bool success, bytes memory data) = _token.call(abi.encodeWithSelector(0x23b872dd, _from, _to, _value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Mozaic: TRANSFER_FROM_FAILED");
    }

    function _nonblockingLzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64 _nonce, bytes memory _payload) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_SETTLE_REQUESTS) {
            (, uint256 _mozaicLpPerStablecoinMil) = abi.decode(_payload, (uint16, uint256));
            _settleRequests(_mozaicLpPerStablecoinMil);
        } else if (packetType == PT_REPORTSNAPSHOT) {
            (, Snapshot memory _newSnapshot) = abi.decode(_payload, (uint16, Snapshot));
            _acceptSnapshot(_srcChainId, _newSnapshot);
        } else if (packetType == PT_SETTLED_REQUESTS) {
            vaultInfos[_srcChainId].vaultStatus = VaultStatus.IDLE;
            if (_allVaultsSettled()) {
                protocolStatus = ProtocolStatus.IDLE;
            }
        } else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }

    function _settleRequests(uint256 _mozaicLpPerStablecoinMil) internal {
        require(status == VaultStatus.SNAPSHOTTED, "_settleRequests: Unexpected status.");
        // for all dpeposit requests, mint MozaicLp
        // TODO: Consider gas fee reduction possible.
        MozaicLP mozaicLpContract = MozaicLP(mozaicLp);
        RequestBuffer storage _reqs = _stagedReqs();
        for (uint i = 0; i < _reqs.depositRequestList.length; i++) {
            DepositRequest memory request = _reqs.depositRequestList[i];
            uint256 _depositAmount = _reqs.depositRequestLookup[request.user][request.token][request.chainId];
            if (_depositAmount == 0) {
                continue;
            }
            uint256 _amountToMint = _depositAmount.mul(_mozaicLpPerStablecoinMil).div(1000000);
            mozaicLpContract.mint(request.user, _amountToMint);
            // Reduce Handled Amount from Buffer
            _reqs.totalDepositAmount = _reqs.totalDepositAmount.sub(_depositAmount);
            _reqs.depositAmountPerToken[request.token] = _reqs.depositAmountPerToken[request.token].sub(_depositAmount);
            _reqs.depositRequestLookup[request.user][request.token][request.chainId] = _reqs.depositRequestLookup[request.user][request.token][request.chainId].sub(_depositAmount);
        }
        require(_reqs.totalDepositAmount == 0, "Has unsettled deposit amount.");

        for (uint i = 0; i < _reqs.withdrawRequestList.length; i++) {
            WithdrawRequest memory request = _reqs.withdrawRequestList[i];
            uint256 _withdrawAmountMLP = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token];
            if (_withdrawAmountMLP == 0) {
                continue;
            }
            uint256 _cointToGive = _withdrawAmountMLP.mul(1000000).div(_mozaicLpPerStablecoinMil);
            uint256 _vaultBalance = IERC20(request.token).balanceOf(address(this));
            // Reduce Handled Amount from Buffer
            _reqs.totalWithdrawAmount = _reqs.totalWithdrawAmount.sub(_withdrawAmountMLP);
            _reqs.withdrawAmountPerToken[request.token] = _reqs.withdrawAmountPerToken[request.token].sub(_withdrawAmountMLP);
            _reqs.withdrawAmountPerUser[request.user] = _reqs.withdrawAmountPerUser[request.user].sub(_withdrawAmountMLP);
            _reqs.withdrawRequestLookup[request.user][request.chainId][request.token] = _reqs.withdrawRequestLookup[request.user][request.chainId][request.token].sub(_withdrawAmountMLP);
            if (_vaultBalance <= _cointToGive) {
                // The vault does not have enough balance. Only give as much as it has.
                // TODO: Check numerical logic.
                _withdrawAmountMLP = _withdrawAmountMLP.mul(_vaultBalance).div(_cointToGive);
                // Burn MLP
                mozaicLpContract.burn(request.user, _withdrawAmountMLP);
                // Give Stablecoin
                _giveStablecoin(request.user, request.token, _vaultBalance);
            }
            // Burn MLP
            mozaicLpContract.burn(request.user, _withdrawAmountMLP);
            // Give Stablecoin
            _giveStablecoin(request.user, request.token, _cointToGive);
        }
        require(_reqs.totalWithdrawAmount == 0, "Has unsettled withdrawal amount.");
        status = VaultStatus.IDLE;
    }

    function reportSettled() public payable {
        // TODO: Check vault status
        require(_stagedReqs().totalDepositAmount == 0, "Has unsettled deposit amount.");
        require(_stagedReqs().totalWithdrawAmount == 0, "Has unsettled withdrawal amount.");
        // report to primary vault
        bytes memory lzPayload = abi.encode(PT_SETTLED_REQUESTS);
        _lzSend(primaryChainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
    }

    function _giveStablecoin(address _user, address _token, uint256 _amountLD) internal {
        IERC20(_token).transfer(_user, _amountLD);
    }

    function registerVault(uint16 _chainId, address _vaultAddress) external onlyOwner {
        bool isNew = true;
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (chainIds[i] == _chainId) {
                isNew = false;
                break;
            }
        }
        if (isNew) {
            chainIds.push(_chainId);
            vaultInfos[_chainId] = VaultInfo(_vaultAddress, VaultStatus.IDLE);
        } else {
            vaultInfos[_chainId].vaultAddress = _vaultAddress;
            vaultInfos[_chainId].vaultStatus = VaultStatus.IDLE;
        }

        ProtocolDriver _driver = protocolDrivers[STG_DRIVER_ID];
        (bool success, ) = address(_driver).delegatecall(abi.encodeWithSignature("registerVault(uint16,address)", _chainId, _vaultAddress));
        require(success, "Failed to register vault to stg driver");

    }

    function getVaultsCount() external view returns (uint256) {
        return chainIds.length;
    }

    // Only for test
    function resetStatusAndBuffer() public virtual onlyOwner {
        status = VaultStatus.IDLE;
        bufferFlag = false;
        // clean left buffer
        for (uint256 i = 0; i < leftBuffer.depositRequestList.length; i++) {
            address _user = leftBuffer.depositRequestList[i].user;
            address _token = leftBuffer.depositRequestList[i].token;
            uint16 _chainId = leftBuffer.depositRequestList[i].chainId;
            delete leftBuffer.depositRequestLookup[_user][_token][_chainId];
            delete leftBuffer.depositAmountPerToken[_token];
            delete leftBuffer.depositRequestList[i];
            leftBuffer.totalDepositAmount = 0;
        }
        for (uint256 i = 0; i < leftBuffer.withdrawRequestList.length; i++) {
            address _user = leftBuffer.withdrawRequestList[i].user;
            uint16 _chainId = leftBuffer.withdrawRequestList[i].chainId;
            address _token = leftBuffer.withdrawRequestList[i].token;
            delete leftBuffer.withdrawRequestLookup[_user][_chainId][_token];
            delete leftBuffer.withdrawAmountPerUser[_user];
            delete leftBuffer.withdrawAmountPerToken[_token];
            delete leftBuffer.withdrawRequestList[i];
            leftBuffer.totalWithdrawAmount = 0;
        }
        // clean right buffer
        for (uint256 i = 0; i < rightBuffer.depositRequestList.length; i++) {
            address _user = rightBuffer.depositRequestList[i].user;
            address _token = rightBuffer.depositRequestList[i].token;
            uint16 _chainId = rightBuffer.depositRequestList[i].chainId;
            delete rightBuffer.depositRequestLookup[_user][_token][_chainId];
            delete rightBuffer.depositAmountPerToken[_token];
            delete rightBuffer.depositRequestList[i];
            rightBuffer.totalDepositAmount = 0;
        }
        for (uint256 i = 0; i < rightBuffer.withdrawRequestList.length; i++) {
            address _user = rightBuffer.withdrawRequestList[i].user;
            uint16 _chainId = rightBuffer.withdrawRequestList[i].chainId;
            address _token = rightBuffer.withdrawRequestList[i].token;
            delete rightBuffer.withdrawRequestLookup[_user][_chainId][_token];
            delete rightBuffer.withdrawAmountPerUser[_user];
            delete rightBuffer.withdrawAmountPerToken[_token];
            delete rightBuffer.withdrawRequestList[i];
            rightBuffer.totalWithdrawAmount = 0;
        }
    }

    // Only for Primary
    function initOptimizationSession() public onlyOwner {
        require(protocolStatus == ProtocolStatus.IDLE, "idle before optimizing");
        // reset
        mozaicLpPerStablecoinMil = 0;
        protocolStatus = ProtocolStatus.OPTIMIZING;
        for (uint i = 0; i < chainIds.length; i++) {
            vaultInfos[chainIds[i]].vaultStatus = VaultStatus.SNAPSHOTTING;
        }
    }

    function _acceptSnapshot(uint16 _srcChainId, Snapshot memory _newSnapshot) internal {
        require(vaultInfos[_srcChainId].vaultStatus == VaultStatus.SNAPSHOTTING, "Expect: prevStatus=SNAPSHOTTING");
        snapshotReported[_srcChainId] = _newSnapshot;
        vaultInfos[_srcChainId].vaultStatus = VaultStatus.SNAPSHOTTED;
        if (allVaultsSnapshotted()) {
            calculateMozLpPerStablecoinMil();
        }
    }

    function allVaultsSnapshotted() public view returns (bool) {
        for (uint i = 0; i < chainIds.length ; i++) {
            if (vaultInfos[chainIds[i]].vaultStatus != VaultStatus.SNAPSHOTTED) {
                return false;
            }
        }
        return true;
    }

    function calculateMozLpPerStablecoinMil() public {
        require(allVaultsSnapshotted(), "Some Snapshots not reached");
        uint256 _stargatePriceMil = _getStargatePriceMil();
        uint256 _totalStablecoinValue = 0;
        uint256 _mintedMozLp = 0;
        // _mintedMozLp - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        for (uint i = 0; i < chainIds.length ; i++) {
            Snapshot memory report = snapshotReported[chainIds[i]];
            _totalStablecoinValue = _totalStablecoinValue.add(report.totalStablecoin + _stargatePriceMil.mul(report.totalStargate).div(1000000));
            _mintedMozLp = _mintedMozLp.add(report.totalMozaicLp);
        }
        if (_totalStablecoinValue > 0) {
            mozaicLpPerStablecoinMil = _mintedMozLp.mul(1000000).div(_totalStablecoinValue);
        }
        else {
            mozaicLpPerStablecoinMil = INITIAL_MLP_PER_COIN_MIL;
        }
    }

    function _allVaultsSettled() internal view returns (bool) {
        for (uint i = 0; i < chainIds.length; i++) {
            if (vaultInfos[chainIds[i]].vaultStatus != VaultStatus.IDLE) {
                return false;
            }
        }
        return true;
    }

    function settleRequestsAllVaults() public payable {
        require(allVaultsSnapshotted(), "Settle-All: Requires all reports");
        require(mozaicLpPerStablecoinMil != 0, "mozaic lp-stablecoin ratio not ready");
        _settleRequests(mozaicLpPerStablecoinMil);
        vaultInfos[chainId].vaultStatus = VaultStatus.IDLE;
        for (uint256 i = 0; i < chainIds.length; i++) {
            if (chainIds[i] == primaryChainId)   continue;
            vaultInfos[chainIds[i]].vaultStatus = VaultStatus.SETTLING;
            bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, mozaicLpPerStablecoinMil);
            _lzSend(chainIds[i], lzPayload, payable(msg.sender), address(0x0), "", msg.value);
        }
    }

    function _getStargatePriceMil() internal returns (uint256) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        // KEVIN-TODO:
        return 1000000;
    }
}