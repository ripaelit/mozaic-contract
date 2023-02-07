pragma solidity ^0.8.0;

// imports
import "../libraries/oft/OFT.sol";
import "../libraries/stargate/Router.sol";
import "./OrderTaker.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract Vault is OFT, OrderTaker {
    // Events
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

    // Variables
    // Variables : Pending Requests
    /// depositRequest[user_address][poolId] = amountLD
    mapping(address => mapping(uint256 => uint256)) public pendingDepositRequest;
    /// withdrawRequest[user_address][poolId] = amountIM
    mapping(address => mapping(uint256 => uint256)) public pendingWithdrawRequest;
    mapping(address => uint256) public pendingWithdrawRequestAmountIM;

    // Variables : Processing Requests
    /// depositRequest[user_address][poolId] = amountLD
    mapping(address => mapping(uint256 => uint256)) public proccessingDepositRequest;
    /// withdrawRequest[user_address][poolId] = amountIM
    mapping(address => mapping(uint256 => uint256)) public proccessingWithdrawRequest;
    mapping(address => uint256) public proccessingWithdrawRequestAmountIM;


    // Constructor and Public Functions
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint _initialSupply,
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
    ) OFT(_name, _symbol, _lzEndpoint, _initialSupply) OrderTaker(_chainId, _stargateRouter, _stargateLpStaking, _stargateToken) {

    }

    /**
     * Add Deposit Request
     */
    function addDepositRequest(uint256 _poolId, uint256 _amountLD) public {
        // TODO: make sure we only accept in the unit of amountSD (shared decimals in Stargate) --> What stargate did in Router.swap()
        address _token = Router(stargateRouter).factory().getPool(_poolId).token();
        // transfer stablecoin
        _safeTransferFrom(_token, msg.sender, address(this), _amountLD);
        // book request
        pendingDepositRequest[msg.sender][_poolId] += _amountLD;
        emit DepositRequestAdded(msg.sender, _poolId, _amountLD);
    }

    function addWithdrawRequest(uint256 _poolId, uint256 _amountIM) public {
        // check if the user has enough balance
        require (pendingWithdrawRequestAmountIM[msg.sender] + proccessingWithdrawRequestAmountIM[msg.sender] + _amountIM <= balanceOf(msg.sender), "Withdraw amount > owned INMOZ");
        // book request
        pendingWithdrawRequest[msg.sender][_poolId] += _amountIM;
        pendingWithdrawRequestAmountIM[msg.sender] += _amountIM;
        emit WithdrawRequestAdded(msg.sender, _poolId, _amountIM);
    }

    // Private Functions
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