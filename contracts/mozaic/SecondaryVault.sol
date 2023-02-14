pragma solidity ^0.8.9;

// imports
import "../libraries/lzApp/NonblockingLzApp.sol";
import "../libraries/stargate/Router.sol";
import "../libraries/stargate/Pool.sol";
import "./OrderTaker.sol";
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
    uint16 public constant PT_ACCEPTREQUESTS = 10002;
    //---------------------------------------------------------------------------
    // STRUCTS
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
    }

    struct WithdrawRequest {
        address user;
        uint16 chainId;
        address token;
    }

    struct RequestBuffer {
        // deposit
        mapping (address => mapping (address => uint256)) depositRequestLookup; // [user][token] = amountSD
        DepositRequest[] depositRequestList;
        uint256 totalDepositRequestSD;
        // withdraw
        mapping (address => mapping (uint16 => mapping (address => uint256))) withdrawRequestLookup; // [user][chainId][token] = amountMLP
        WithdrawRequest[] withdrawRequestList;
        uint256 totalWithdrawRequestMLP;
    }


    //---------------------------------------------------------------------------
    // VARIABLES
    OrderTaker public orderTaker;
    address public stargateRouter;
    address public stargateLpStaking;
    address public stargateToken;
    address public mozaicLp;
    uint16 public primaryChainId=0;
    uint16 public chainId=0;
    
    bool public bufferFlag = false; // false ==> Left=pending Right=processing; true ==> Left=processing Right=pending
    RequestBuffer public leftBuffer;
    RequestBuffer public rightBuffer;

    function _getPendingRequestBuffer() internal view returns (RequestBuffer storage) {
        if (bufferFlag) {
            return leftBuffer;
        }
        else {
            return rightBuffer;
        }
    }

    function _getStagedRequestBuffer() internal view returns (RequestBuffer storage) {
        if (bufferFlag) {
            return rightBuffer;
        }
        else {
            return leftBuffer;
        }
    }

    //---------------------------------------------------------------------------
    // Constructor and Public Functions
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
    ) NonblockingLzApp(_lzEndpoint) {
        chainId = _chainId;
        stargateRouter = _stargateRouter;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
    }
    function setOrderTaker(OrderTaker _orderTaker) external onlyOwner {
        // TODO: contract type check
        orderTaker = _orderTaker;
    }
    function setMozLp(address _mozaicLp) public onlyOwner {
        // TODO: contract type check
        mozaicLp = _mozaicLp;
    }
    function setMainChainId(uint16 _chainId) public onlyOwner {
        primaryChainId = _chainId;
    }

    /**
     * Add Deposit Request
     */
    function addDepositRequest(uint256 _amountLD, address _token) public {
        address _depositor = msg.sender;
        require(primaryChainId > 0, "main chain is not set");
        // TODO: make sure we only accept in the unit of amountSD (shared decimals in Stargate) --> What stargate did in Router.swap()
        uint256 _poolId = getStargatePoolId(_token);
        Pool pool = Factory(Router(stargateRouter).factory()).getPool(_poolId);
        uint256 _amountSD =  _amountLD.div(pool.convertRate()); // pool.amountLDtoSD(_amountLD);
        uint256 _amountLDAccept = _amountSD.mul(pool.convertRate()); // pool.amountSDToLD(_amountSD);

        // transfer stablecoin
        _safeTransferFrom(_token, msg.sender, address(this), _amountLDAccept);
        RequestBuffer storage buffer = _getPendingRequestBuffer();

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
            buffer.depositRequestList.push(req);
        }

        // 2. Update depositRequestLookup
        buffer.depositRequestLookup[_depositor][_token] = buffer.depositRequestLookup[_depositor][_token].add(_amountSD);

        // 3. Update totalDepositRequestSD
        buffer.totalDepositRequestSD = buffer.totalDepositRequestSD.add(_amountSD);

        emit DepositRequestAdded(_depositor, _token, _amountSD);
    }

    function addWithdrawRequest(uint256 _amountMLP, address _token, uint16 _chainId) public {
        require(_chainId == chainId, "PoC restriction - withdraw onchain");
        require(primaryChainId > 0, "main chain should be set");
        address _withdrawer = msg.sender;
        RequestBuffer storage buffer;
        buffer = _getPendingRequestBuffer();
        // check if the user has enough balance
        require (buffer.withdrawRequestLookup[_withdrawer][_chainId][_token].add(_amountMLP) <= MozaicLP(mozaicLp).balanceOf(_withdrawer), "Withdraw amount > owned INMOZ");
        // check token


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
        require(_getStagedRequestBuffer().totalDepositRequestSD==0, "Still has processing requests");
        require(_getStagedRequestBuffer().totalWithdrawRequestMLP==0, "Still has processing requests");
        
        // Take Snapshot: Pending --> Processing
        bufferFlag = !bufferFlag;

        // Make Report
        SnapshotReport memory report;
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
        report.depositRequestAmountSD = _getStagedRequestBuffer().totalDepositRequestSD;
        report.withdrawRequestAmountMLP = _getStagedRequestBuffer().totalWithdrawRequestMLP;
        report.totalMozaicLp = MozaicLP(mozaicLp).totalSupply();
        
        // Send Report
        bytes memory lzPayload = abi.encode(PT_REPORTSNAPSHOT, report);
        _lzSend(primaryChainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
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

        if (packetType == PT_ACCEPTREQUESTS) {
            (, uint256 _smozaicLpPerStablecoinMil) = abi.decode(_payload, (uint16, uint256));
            acceptRequests(_smozaicLpPerStablecoinMil);
        } else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
    
    function acceptRequests(uint256 _smozaicLpPerStablecoinMil) public {
        // TODO: for all dpeposit requests, mint MozaicLp
        // TODO: for all withdraw reuqests, burn MozaicLp and give stablecoin.
    }

    /**
     * This function convert stablecoin token address to Stargate liquidity pool ID.
     * This function reverts when the pool ID is not found.
     * @dev marked as public view with concerns.
     * @param _token stablecoin token contract address
     * @return uint256 indicating Stargate Liquidity Pool
     */
    function getStargatePoolId(address _token) public view returns (uint256) {
        // TODO: resolve stargate liquidity pool ID, using Stargate protocol
        // TODO: revert when not found.
    }
}