pragma solidity ^0.8.9;

// imports
import "../libraries/lzApp/NonblockingLzApp.sol";
import "../libraries/stargate/Router.sol";
import "../libraries/stargate/Pool.sol";
import "../libraries/stargate/LPStaking.sol";
import "./ProtocolDriver.sol";
import "./MozaicLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract SecondaryVault is NonblockingLzApp {
    using SafeMath for uint256;
    //--------------------------------------------------------------------------
    // EVENTS
    event UnexpectedLzMessage(uint16 packetType, bytes payload);

    event DepositRequestAdded (
        address indexed depositor,
        address indexed token,
        uint16 indexed chainId,
        uint256 amountLD,
        uint256 amountSD
    );

    event WithdrawRequestAdded (
        address indexed withdrawer,
        address indexed token,
        uint16 indexed chainId,
        uint256 amountMLP
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
    //---------------------------------------------------------------------------
    // STRUCTS
    struct Action {
        uint256 driverIndex;
        ProtocolDriver.ActionType actionType;
        bytes payload;
    }

    struct SnapshotReport {
        uint256 depositRequestAmountSD;
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
        uint256 totalDepositRequestSD;
        // withdraw
        mapping (address => mapping (uint16 => mapping (address => uint256))) withdrawRequestLookup; // [user][chainId][token] = amountMLP
        WithdrawRequest[] withdrawRequestList;
        mapping (address => uint256) withdrawForUserMLP; // [user] = amountMLP
        uint256 totalWithdrawRequestMLP;
    }


    //---------------------------------------------------------------------------
    // VARIABLES
    mapping (uint256=>ProtocolDriver) public protocolDrivers;
    address public stargateRouter;
    address public stargateLpStaking;
    address public stargateToken;
    address public mozaicLp;
    uint16 public primaryChainId=0;
    uint16 public chainId=0;
    
    bool public bufferFlag = false; // false ==> Left=pending Right=processing; true ==> Left=processing Right=pending
    RequestBuffer public leftBuffer;
    RequestBuffer public rightBuffer;

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

    function getDepositRequestAmount(bool _staged, address _user, address _token, uint16 _chainId) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().depositRequestLookup[_user][_token][_chainId];
        }
        else {
            return _pendingReqs().depositRequestLookup[_user][_token][_chainId];
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

    function getTotalDepositRequestSD(bool _staged) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().totalDepositRequestSD;
        }
        else {
            return _pendingReqs().totalDepositRequestSD;
        }
    }

    function getWithdrawRequestAmount(bool _staged, address _user, uint16 _chainId, address _token) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().withdrawRequestLookup[_user][_chainId][_token];
        }
        else {
            return _pendingReqs().withdrawRequestLookup[_user][_chainId][_token];
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

    function getTotalWithdrawRequestMLP(bool _staged) public view returns (uint256) {
        if (_staged) {
            return _stagedReqs().totalWithdrawRequestMLP;
        }
        else {
            return _pendingReqs().totalWithdrawRequestMLP;
        }
    }

    //---------------------------------------------------------------------------
    // Constructor and Public Functions
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        uint16 _primaryChainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) NonblockingLzApp(_lzEndpoint) {
        chainId = _chainId;
        primaryChainId = _primaryChainId;
        stargateRouter = _stargateRouter;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
        mozaicLp = _mozaicLp;
    }
    function setProtocolDriver(uint256 _driverId, ProtocolDriver _driver, bytes calldata _config) public onlyOwner {
        protocolDrivers[_driverId] = _driver;
        // 0x0db03cba = bytes4(keccak256(bytes('configDriver(bytes)')));
        (bool _success, bytes memory _response) = address(_driver).delegatecall(abi.encodeWithSelector(0x0db03cba, _config));
        require(_success, "Failed to access configDriver in setProtocolDriver");
    }
    // function setMozaicLp(address _mozaicLp) public onlyOwner {
    //     // TODO: contract type check
    //     mozaicLp = _mozaicLp;
    // }
    // function setMainChainId(uint16 _chainId) public onlyOwner {
    //     console.log("setMainChainId:", _chainId);
    //     console.log("selfChainId:", chainId);
    //     primaryChainId = _chainId;
    // }

    function executeActions(Action[] calldata _actions) external onlyOwner {
        for (uint i = 0; i < _actions.length ; i++) {
            Action calldata _action = _actions[i];
            console.log("SecondaryVault.executeActions: _action.driverIndex:", _action.driverIndex);
            ProtocolDriver _driver = protocolDrivers[_action.driverIndex];
            console.log("SecondaryVault.executeActions: protocolDriver:", address(_driver));
            (bool success, bytes memory data) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_action.actionType), _action.payload));
            require(success, "Failed to delegate to ProtocolDriver");
        }
    }
    /**
     * Add Deposit Request
     */
    function addDepositRequest(uint256 _amountLD, address _token, uint16 _chainId) public {
        address _depositor = msg.sender;
        require(primaryChainId > 0, "primary chain is not set");
        require(_chainId == chainId, "only onchain mint in PoC");
        // TODO: make sure we only accept in the unit of amountSD (shared decimals in Stargate) --> What stargate did in Router.swap()
        
        console.log("SecondaryVault.addDepositRequest: _amountLD", _amountLD);
        ////////    ???????
        (bool _success, bytes memory _returnData) =  address(protocolDrivers[STG_DRIVER_ID]).delegatecall(abi.encodeWithSelector(SELECTOR_CONVERTLDTOSD, _token, _amountLD));
        require(_success, "Failed to access convertLDtoSD in addDepositRequest");
        uint256 _amountSD = abi.decode(_returnData, (uint256));
        console.log("_amountSD", _amountSD);
        
        (_success, _returnData) = address(protocolDrivers[STG_DRIVER_ID]).delegatecall(abi.encodeWithSelector(SELECTOR_CONVERTSDTOLD, _token, _amountSD));
        require(_success, "Failed to access convertSDtoLD in addDepositRequest");
        uint256 _amountLDAccept = abi.decode(_returnData, (uint256));
        console.log("_amountLDAccept", _amountLDAccept);
        ///////   ???????

        // transfer stablecoin
        _safeTransferFrom(_token, msg.sender, address(this), _amountLDAccept);
        RequestBuffer storage buffer = _pendingReqs();

        // book request
        // 1. Update depositRequestList
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

        // 2. Update depositRequestLookup
        buffer.depositRequestLookup[_depositor][_token][_chainId] = buffer.depositRequestLookup[_depositor][_token][_chainId].add(_amountSD);

        // 3. Update totalDepositRequestSD
        buffer.totalDepositRequestSD = buffer.totalDepositRequestSD.add(_amountSD);

        emit DepositRequestAdded(_depositor, _token, _chainId, _amountLDAccept, _amountSD);
    }

    function addWithdrawRequest(uint256 _amountMLP, address _token, uint16 _chainId) public {
        require(_chainId == chainId, "PoC restriction - withdraw onchain");
        require(primaryChainId > 0, "main chain should be set");
        address _withdrawer = msg.sender;
        RequestBuffer storage buffer;
        buffer = _pendingReqs();
        RequestBuffer storage stagedBuffer;
        stagedBuffer = _stagedReqs();
        // check if the user has enough balance
        buffer.withdrawForUserMLP[_withdrawer] = buffer.withdrawForUserMLP[_withdrawer].add(_amountMLP);
        console.log("buffer.withdrawForUserMLP[_withdrawer]", buffer.withdrawForUserMLP[_withdrawer]);
        console.log("stagedBuffer.withdrawForUserMLP[_withdrawer]", stagedBuffer.withdrawForUserMLP[_withdrawer]);
        require (buffer.withdrawForUserMLP[_withdrawer].add(stagedBuffer.withdrawForUserMLP[_withdrawer]) <= MozaicLP(mozaicLp).balanceOf(_withdrawer), "Withdraw amount > owned mLP");
        
        // book request
        // 1. Update withdrawRequestList
        bool _exists = false;
        for (uint i = 0; i < buffer.withdrawRequestList.length; i++) {
            WithdrawRequest memory req = buffer.withdrawRequestList[i];
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
            buffer.withdrawRequestList.push(req);
        }

        // 2. Update withdrawRequestLookup
        buffer.withdrawRequestLookup[_withdrawer][_chainId][_token] = buffer.withdrawRequestLookup[_withdrawer][_chainId][_token].add(_amountMLP);

        // 3. Update totalWithdrawRequestMLP
        buffer.totalWithdrawRequestMLP = buffer.totalWithdrawRequestMLP.add(_amountMLP);

        emit WithdrawRequestAdded(_withdrawer, _token, _chainId, _amountMLP);
    }

    /// Take snapshot and report to primary vault
    function snapshotAndReport() public virtual payable onlyOwner {
        require(primaryChainId > 0, "main chain is not set");
        // Processing Amount Should be Zero!
        require(_stagedReqs().totalDepositRequestSD==0, "Still has processing requests");
        require(_stagedReqs().totalWithdrawRequestMLP==0, "Still has processing requests");
        SnapshotReport memory report = _snapshot();
        // Send Report
        bytes memory lzPayload = abi.encode(PT_REPORTSNAPSHOT, report);
        _lzSend(primaryChainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
    }
    function _clearPendingBuffer() internal {
        // Clear Pending
        RequestBuffer storage pending = _pendingReqs();
        require(pending.totalDepositRequestSD == 0, "expected totalDeposit = 0");
        require(pending.totalDepositRequestSD == 0, "expected totalWithdraw = 0");
        delete pending.depositRequestList;
        delete pending.withdrawRequestList;
    }
    function _snapshot() internal virtual returns (SnapshotReport memory report){
        // Take Snapshot: Pending --> Processing
        bufferFlag = !bufferFlag;

        // Make Report
        uint256 _totalStablecoin = 0;
        for (uint i = 0; i < LPStaking(stargateLpStaking).poolLength(); i++) {
            // 1. Collect pending STG rewards
            LPStaking(stargateLpStaking).withdraw(i, 0);
            // 2. Check total stablecoin
            Pool _pool = Pool(address(LPStaking(stargateLpStaking).getPoolInfo(i))); // TODO: Check type conv
            uint256 _lpAmount = _pool.balanceOf(address(this));
            _totalStablecoin = _totalStablecoin.add(_pool.totalLiquidity().mul(_lpAmount).div(_pool.totalSupply()));
            _totalStablecoin = _totalStablecoin.add(IERC20(_pool.token()).balanceOf(address(this))); // Just in case
        }
        report.totalStargate = IERC20(stargateToken).balanceOf(address(this));
        report.totalStablecoin = _totalStablecoin;
        report.depositRequestAmountSD = _stagedReqs().totalDepositRequestSD;
        report.withdrawRequestAmountMLP = _stagedReqs().totalWithdrawRequestMLP;
        report.totalMozaicLp = MozaicLP(mozaicLp).totalSupply();
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
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Stargate: TRANSFER_FROM_FAILED");
    }
    
    function _nonblockingLzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64 _nonce, bytes memory _payload) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_SETTLE_REQUESTS) {
            (, uint256 _mozaicLpPerStablecoinMil) = abi.decode(_payload, (uint16, uint256));
            _settleRequests(_mozaicLpPerStablecoinMil);
        } else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
    
    function _settleRequests(uint256 _mozaicLpPerStablecoinMil) internal {
        // for all dpeposit requests, mint MozaicLp
        // TODO: Consider gas fee reduction possible.
        MozaicLP mozaicLpContract = MozaicLP(mozaicLp);
        RequestBuffer storage reqs = _stagedReqs();
        for (uint i = 0; i < reqs.depositRequestList.length; i++) {
            DepositRequest memory request = reqs.depositRequestList[i];
            uint256 _depositAmount = reqs.depositRequestLookup[request.user][request.token][request.chainId];
            uint256 _amountToMint = _depositAmount.mul(_mozaicLpPerStablecoinMil).div(1000000);
            mozaicLpContract.mint(request.user, _amountToMint);
            // Reduce Handled Amount from Buffer
            reqs.totalDepositRequestSD = reqs.totalDepositRequestSD.sub(_depositAmount);
            reqs.depositRequestLookup[request.user][request.token][request.chainId] = reqs.depositRequestLookup[request.user][request.token][request.chainId].sub(_depositAmount);
        }

        for (uint i = 0; i < reqs.withdrawRequestList.length; i++) {
            WithdrawRequest memory request = reqs.withdrawRequestList[i];
            uint256 _withdrawAmountMLP = reqs.withdrawRequestLookup[request.user][request.chainId][request.token];
            (bool success, bytes memory returnData) = address(protocolDrivers[STG_DRIVER_ID]).delegatecall(abi.encodeWithSelector(SELECTOR_CONVERTSDTOLD,request.token,  _withdrawAmountMLP.div(_mozaicLpPerStablecoinMil).mul(1000000)));
            require(success, "Failed to access convertSDtoLD in _settleRequests");
            uint256 _coinToGiveLD = abi.decode(returnData, (uint256));
            uint256 _vaultBalance = IERC20(request.token).balanceOf(address(this));
            // Reduce Handled Amount from Buffer
            reqs.totalWithdrawRequestMLP = reqs.totalWithdrawRequestMLP.sub(_withdrawAmountMLP);
            reqs.withdrawForUserMLP[request.user] = reqs.withdrawForUserMLP[request.user].sub(_withdrawAmountMLP);
            reqs.withdrawRequestLookup[request.user][request.chainId][request.token] = reqs.withdrawRequestLookup[request.user][request.chainId][request.token].sub(_withdrawAmountMLP);
            if (_vaultBalance <= _coinToGiveLD) {
                // The vault does not have enough balance. Only give as much as it has.
                // TODO: Check numerical logic.
                _withdrawAmountMLP = _withdrawAmountMLP.mul(_vaultBalance).div(_coinToGiveLD);
                // Burn MLP
                mozaicLpContract.burn(request.user, _withdrawAmountMLP);
                // Give Stablecoin
                _giveStablecoin(request.user, request.token, _vaultBalance);
            }
            // Burn MLP
            mozaicLpContract.burn(request.user, _withdrawAmountMLP);
            // Give Stablecoin
            _giveStablecoin(request.user, request.token, _coinToGiveLD);
        }
    }

    function reportSettled() public payable {
        require(_stagedReqs().totalDepositRequestSD==0);
        require(_stagedReqs().totalWithdrawRequestMLP==0);
        // report to primary vault
        bytes memory lzPayload = abi.encode(PT_SETTLED_REQUESTS);
        _lzSend(primaryChainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
    }

    function _giveStablecoin(address _user, address _token, uint256 _amountLD) internal {
        IERC20(_token).transfer(_user, _amountLD);
    }
}