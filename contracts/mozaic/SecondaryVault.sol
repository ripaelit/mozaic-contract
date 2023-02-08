pragma solidity ^0.8.0;

// imports
import "../libraries/oft/OFTCore.sol";
import "../libraries/stargate/Router.sol";
import "../libraries/stargate/Pool.sol";
import "./OrderTaker.sol";
import "./MozLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract SecondaryVault is MozLP, OrderTaker {
    using SafeMath for uint256;
    //--------------------------------------------------------------------------
    // CONSTANTS
    uint16 public constant PT_REPORTSNAPSHOT = 10001;
    //---------------------------------------------------------------------------
    // STRUCTS
    struct SnapshotReport {
        uint256 depositRequestAmountLD;
        uint256 withdrawRequestAmountIM;
        uint256 totalStargate;
        uint256 totalStablecoin;
        uint256 totalInmoz; // INMOZ = Mozaic "LP"
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    uint16 public primaryChainId=0;
    bool public bucketFlag = false; // false ==> Left=pending Right=processing; true ==> Left=processing Right=pending
    // Pending | Processing Requests - Bucket Left
    mapping(address => mapping(uint256 => uint256)) public depositRequestLeft;
    uint256 public totalDepositRequestAmountLDLeft;
    mapping(address => mapping(uint256 => uint256)) public withdrawRequestLeft;
    mapping(address => uint256) public withdrawRequestAmountIMLeft;
    uint256 public totalWithdrawRequestAmountIMLeft;

    // Pending | Processing Requests - Bucket Right
    mapping(address => mapping(uint256 => uint256)) public depositRequestRight;
    uint256 public totalDepositRequestAmountLDRight;
    mapping(address => mapping(uint256 => uint256)) public withdrawRequestRight;
    mapping(address => uint256) public withdrawRequestAmountIMRight;
    uint256 public totalWithdrawRequestAmountIMRight;

    function getPendingDepositRequest(address _user, uint256 _pid) private view returns (uint256) {
        if (bucketFlag) {
            return depositRequestRight[_user][_pid];
        }
        else {
            return depositRequestLeft[_user][_pid];
        }
    }
    function setPendingDepositRequest(address _user, uint256 _pid, uint256 _amountLD) private {
        if (bucketFlag) {
            depositRequestRight[_user][_pid] = _amountLD;
        }
        else {
            depositRequestLeft[_user][_pid] = _amountLD;
        }
    }
    function getProcessingDepositRequest(address _user, uint256 _pid) public view returns (uint256) {
        if (!bucketFlag) {
            return depositRequestRight[_user][_pid];
        }
        else {
            return depositRequestLeft[_user][_pid];
        }
    }
    function setProcessingDepositRequest(address _user, uint256 _pid, uint256 _amountLD) private {
        if (!bucketFlag) {
            depositRequestRight[_user][_pid] = _amountLD;
        }
        else {
            depositRequestLeft[_user][_pid] = _amountLD;
        }
    }
    function getPendingWithdrawRequest(address _user, uint256 _pid) private view returns (uint256) {
        if (bucketFlag) {
            return withdrawRequestRight[_user][_pid];
        }
        else {
            return withdrawRequestLeft[_user][_pid];
        }
    }
    function setPendingWithdrawRequest(address _user, uint256 _pid, uint256 _amountLD) private {
        if (bucketFlag) {
            withdrawRequestRight[_user][_pid] = _amountLD;
        }
        else {
            withdrawRequestLeft[_user][_pid] = _amountLD;
        }
    }
    function getProcessingWithdrawRequest(address _user, uint256 _pid) public view returns (uint256) {
        if (!bucketFlag) {
            return withdrawRequestRight[_user][_pid];
        }
        else {
            return withdrawRequestLeft[_user][_pid];
        }
    }
    function setProcessingWithdrawRequest(address _user, uint256 _pid, uint256 _amountLD) private {
        if (!bucketFlag) {
            withdrawRequestRight[_user][_pid] = _amountLD;
        }
        else {
            withdrawRequestLeft[_user][_pid] = _amountLD;
        }
    }
    function getPendingWithdrawRequestAmountIM(address _user) private view returns (uint256) {
        if (bucketFlag) {
            return withdrawRequestAmountIMRight[_user];
        }
        else {
            return withdrawRequestAmountIMLeft[_user];
        }
    }
    function setPendingWithdrawRequestAmountIM(address _user, uint256 _amountIM) private {
        if (bucketFlag) {
            withdrawRequestAmountIMRight[_user] = _amountIM;
        }
        else {
            withdrawRequestAmountIMLeft[_user] = _amountIM;
        }
    }
    function getProcessingWithdrawRequestAmountIM(address _user) private view returns (uint256) {
        if (!bucketFlag) {
            return withdrawRequestAmountIMRight[_user];
        }
        else {
            return withdrawRequestAmountIMLeft[_user];
        }
    }
    function setProcessingWithdrawRequestAmountIM(address _user, uint256 _amountIM) private {
        if (!bucketFlag) {
            withdrawRequestAmountIMRight[_user] = _amountIM;
        }
        else {
            withdrawRequestAmountIMLeft[_user] = _amountIM;
        }
    }
    
    function getPendingTotalDepositRequestAmountLD() public view returns (uint256) {
        if (bucketFlag) {
            return totalDepositRequestAmountLDRight;
        }
        else {
            return totalDepositRequestAmountLDLeft;
        }
    }
    function setPendingTotalDepositRequestAmountLD(uint256 _value) public {
        if (bucketFlag) {
            totalDepositRequestAmountLDRight = _value;
        }
        else {
            totalDepositRequestAmountLDLeft = _value;
        }
    }
    function getProcessingTotalDepositRequestAmountLD() public view returns (uint256) {
        if (!bucketFlag) {
            return totalDepositRequestAmountLDRight;
        }
        else {
            return totalDepositRequestAmountLDLeft;
        }
    }
    function setProcessingTotalDepositRequestAmountLD(uint256 _value) public {
        if (!bucketFlag) {
            totalDepositRequestAmountLDRight = _value;
        }
        else {
            totalDepositRequestAmountLDLeft = _value;
        }
    }
    function getPendingTotalWithdrawRequestAmountIM() public view returns (uint256) {
        if (bucketFlag) {
            return totalWithdrawRequestAmountIMRight;
        }
        else {
            return totalWithdrawRequestAmountIMLeft;
        }
    }
    function setPendingTotalWithdrawRequestAmountIM(uint256 _value) public {
        if (bucketFlag) {
            totalWithdrawRequestAmountIMRight = _value;
        }
        else {
            totalWithdrawRequestAmountIMLeft = _value;
        }
    }
    function getProcessingTotalWithdrawRequestAmountIM() public view returns (uint256) {
        if (!bucketFlag) {
            return totalWithdrawRequestAmountIMRight;
        }
        else {
            return totalWithdrawRequestAmountIMLeft;
        }
    }
    function setProcessingTotalWithdrawRequestAmountIM(uint256 _value) public {
        if (!bucketFlag) {
            totalWithdrawRequestAmountIMRight = _value;
        }
        else {
            totalWithdrawRequestAmountIMLeft = _value;
        }
    }
    
    

    //---------------------------------------------------------------------------
    // EVENTS
    event DepositRequestAdded (
        address indexed requestor,
        uint256 indexed poolId,
        uint256 amountLD
    );
    event WithdrawRequestAdded (
        address indexed requestor,
        uint256 indexed poolId,
        uint256 amountIM
    );

    // Constructor and Public Functions
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
    ) MozLP(_name, _symbol, _lzEndpoint) OrderTaker(_chainId, _stargateRouter, _stargateLpStaking, _stargateToken) {

    }
    function setMainChainId(uint16 _chainId) public onlyOwner {
        primaryChainId = _chainId;
    }

    /**
     * Add Deposit Request
     */
    function addDepositRequest(uint256 _poolId, uint256 _amountLD) public {
        require(primaryChainId > 0, "main chain is not set");
        // TODO: make sure we only accept in the unit of amountSD (shared decimals in Stargate) --> What stargate did in Router.swap()
        address _token = Router(stargateRouter).factory().getPool(_poolId).token();
        // transfer stablecoin
        _safeTransferFrom(_token, msg.sender, address(this), _amountLD);
        // book request
        setPendingDepositRequest(msg.sender, _poolId, getPendingDepositRequest(msg.sender, _poolId).add(_amountLD));
        setPendingTotalDepositRequestAmountLD(getPendingTotalDepositRequestAmountLD().add(_amountLD));
        emit DepositRequestAdded(msg.sender, _poolId, _amountLD);
    }

    function addWithdrawRequest(uint256 _poolId, uint256 _amountIM) public {
        require(primaryChainId > 0, "main chain is not set");
        // check if the user has enough balance
        require (getPendingWithdrawRequestAmountIM(msg.sender).add(getProcessingWithdrawRequestAmountIM(msg.sender)).add(_amountIM) <= balanceOf(msg.sender), "Withdraw amount > owned INMOZ");
        // book request
        setPendingWithdrawRequest(msg.sender, _poolId, getPendingWithdrawRequest(msg.sender, _poolId).add(_amountIM));
        setPendingWithdrawRequestAmountIM(msg.sender, getPendingWithdrawRequestAmountIM(msg.sender).add(_amountIM));
        setPendingTotalWithdrawRequestAmountIM(getPendingTotalWithdrawRequestAmountIM().add(_amountIM));
        emit WithdrawRequestAdded(msg.sender, _poolId, _amountIM);
    }

    /// Take snapshot and report to primary vault
    function snapshotAndReport() public payable onlyOwner {
        require(primaryChainId > 0, "main chain is not set");
        // Processing Amount Should be Zero!
        require(getProcessingTotalDepositRequestAmountLD()==0, "Still has processing requests");
        require(getProcessingTotalWithdrawRequestAmountIM()==0, "Still has processing requests");
        
        // Take Snapshot: Pending --> Processing
        bucketFlag = !bucketFlag;

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
        report.depositRequestAmountLD = getProcessingTotalDepositRequestAmountLD();
        report.withdrawRequestAmountIM = getProcessingTotalWithdrawRequestAmountIM();
        report.totalInmoz = this.totalSupply();
        
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
}