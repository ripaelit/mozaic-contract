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
    /// @title: Action Parameters for Each Type:
    /// - Stake (amountCoin, poolIndex)
    /// - Unstake: (amountLP, poolIndex)
    /// - Swap (amountSrc, srcPoolIndex, dstPoolIndex)
    /// - Swap Remote(amountSrc, srcPoolIndex, dstChainId, dstPoolIndex)
    /// - Sell(amountSTG, StgPoolIndex)
    /// @note: every pool index is the index in Stargate Factory
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
        uint256 totalWithdrawRequestMLP;
    }


    //---------------------------------------------------------------------------
    // VARIABLES
    mapping (uint256=>ProtocolDriver) public protocolDrivers;
    address public stargateRouter;
    address public stargateLpStaking;
    address public stargateToken;
    MozaicLP public mozaicLp;
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
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) NonblockingLzApp(_lzEndpoint) {
        chainId = _chainId;
        stargateRouter = _stargateRouter;
        stargateLpStaking = _stargateLpStaking;
        stargateToken = _stargateToken;
        mozaicLp = MozaicLP(_mozaicLp);
    }
    function setProtocolDriver(uint256 _driverId, ProtocolDriver _driver) public onlyOwner returns (uint256) {
        console.log("SecondaryVault.setProtocolDriver: _driverId, ProtocolDriver", _driverId, address(_driver));
        protocolDrivers[_driverId] = _driver;
    }
    function setMozaicLp(MozaicLP _mozaicLp) public onlyOwner {
        // TODO: contract type check
        mozaicLp = _mozaicLp;
    }
    function setMainChainId(uint16 _chainId) public onlyOwner {
        console.log("setMainChainId:", _chainId);
        console.log("selfChainId:", chainId);
        primaryChainId = _chainId;
    }

    function executeActions(Action[] calldata _actions) external onlyOwner {
        console.log("SecondaryVault.executeActions: Actions size:", _actions.length);
        for (uint i = 0; i < _actions.length ; i++) {
            // NOTE: PoC: stake and unstake is handled by self. Move to StargateDriver after PoC
            Action calldata _action = _actions[i];
            if (_action.actionType == ProtocolDriver.ActionType.StargateStake) {
                (uint256 _amountLD, address _token) = abi.decode(_action.payload, (uint256, address));
                _stake(_amountLD, _token);
            }
            else if (_action.actionType == ProtocolDriver.ActionType.StargateUnstake) {
                (uint256 _amountSD, address _token) = abi.decode(_action.payload, (uint256, address));
                _unstake(_amountSD, _token);
            }
            else if (_action.actionType == ProtocolDriver.ActionType.SwapRemote) {
                (uint256 _amountLD, address _srcToken, uint16 _dstChainId, address _dstToken) = abi.decode(_action.payload, (uint256, address, uint16, address));
                _swapRemote(_amountLD, _srcToken, _dstChainId, _dstToken);
            }
            else {
                console.log("SecondaryVault.executeActions: _action.driverIndex:", _action.driverIndex);
                ProtocolDriver _driver = protocolDrivers[_action.driverIndex];
                console.log("SecondaryVault.executeActions: ProtocolDriver address:", address(_driver));
                (bool success, bytes memory data) = address(_driver).delegatecall(abi.encodeWithSignature("execute(uint8,bytes)", uint8(_action.actionType), _action.payload));
                require(success, "Failed to delegate to ProtocolDriver");
            }
        }
    }
    /**
     * Add Deposit Request
     */
    function addDepositRequest(uint256 _amountLD, address _token, uint16 _chainId) public {
        address _depositor = msg.sender;
        require(primaryChainId > 0, "main chain is not set");
        require(_chainId == chainId, "only onchain mint in PoC");
        // TODO: make sure we only accept in the unit of amountSD (shared decimals in Stargate) --> What stargate did in Router.swap()
        Pool pool = _getStargatePoolFromToken(_token);
        uint256 _amountSD =  _convertLDtoSD(_token, _amountLD);
        console.log("_amountSD", _amountSD);
        uint256 _amountLDAccept = _convertSDtoLD(_token, _amountSD);
        console.log("_amountLDAccept", _amountLDAccept);


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

        emit DepositRequestAdded(_depositor, _token, _amountSD);
    }

    function addWithdrawRequest(uint256 _amountMLP, address _token, uint16 _chainId) public {
        require(_chainId == chainId, "PoC restriction - withdraw onchain");
        require(primaryChainId > 0, "main chain should be set");
        address _withdrawer = msg.sender;
        RequestBuffer storage buffer;
        buffer = _pendingReqs();
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
        require(_stagedReqs().totalDepositRequestSD==0, "Still has processing requests");
        require(_stagedReqs().totalWithdrawRequestMLP==0, "Still has processing requests");
        
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
        report.depositRequestAmountSD = _stagedReqs().totalDepositRequestSD;
        report.withdrawRequestAmountMLP = _stagedReqs().totalWithdrawRequestMLP;
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
            (, uint256 _mozaicLpPerStablecoinMil) = abi.decode(_payload, (uint16, uint256));
            settleRequests(_mozaicLpPerStablecoinMil);
        } else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }
    
    function settleRequests(uint256 _mozaicLpPerStablecoinMil) public {
        // for all dpeposit requests, mint MozaicLp
        // TODO: Consider gas fee reduction possible.
        RequestBuffer storage reqs = _stagedReqs();
        for (uint i = 0; i < reqs.depositRequestList.length; i++) {
            DepositRequest memory request = reqs.depositRequestList[i];
            uint256 _depositAmount = reqs.depositRequestLookup[request.user][request.token][request.chainId];
            uint256 _amountToMint = _depositAmount.mul(_mozaicLpPerStablecoinMil).div(1000000);
            mozaicLp.mint(request.user, _amountToMint);
        }
        // TODO: for all withdraw reuqests, burn MozaicLp and give stablecoin.
        for (uint i = 0; i < reqs.withdrawRequestList.length; i++) {
            WithdrawRequest memory request = reqs.withdrawRequestList[i];
            uint256 _withdrawAmountLP = reqs.withdrawRequestLookup[request.user][request.chainId][request.token];
            uint256 _coinToGiveLD = _convertSDtoLD(request.token, _withdrawAmountLP.div(_mozaicLpPerStablecoinMil).mul(1000000));
            _giveStablecoin(request.user, request.token, _coinToGiveLD);
        }
    }

    /**
     * This function return stargate Pool contract address for related stablecoin token address.
     * This function reverts when the pool is not found.
     * @dev marked as public view with concerns.
     * @param _token stablecoin token contract address
     * @return uint256 indicating Stargate Liquidity Pool
     */
    function _getStargatePoolFromToken(address _token) public view returns (Pool) {
        for (uint i = 0; i < Factory(Router(stargateRouter).factory()).allPoolsLength(); i++) {
            Pool _pool = Pool(Factory(Router(stargateRouter).factory()).allPools(i));
            if (_pool.token() == _token) {
                return _pool;
            }
        }
        // revert when not found.
        revert("Pool not found for token");
    }

    function _convertSDtoLD(address _token, uint256 _amountSD) internal view returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        Pool pool = _getStargatePoolFromToken(_token);
        return  _amountSD.mul(pool.convertRate()); // pool.amountSDtoLD(_amountSD);
    }

    function _convertLDtoSD(address _token, uint256 _amountLD) internal view returns (uint256) {
        // TODO: gas fee optimization by avoiding duplicate calculation.
        Pool pool = _getStargatePoolFromToken(_token);
        console.log(pool.convertRate());
        return  _amountLD.div(pool.convertRate()); // pool.amountLDtoSD(_amountLD);
    }

    function _giveStablecoin(address _user, address _token, uint256 _amountLD) internal {
        IERC20(_token).transfer(_user, _amountLD);
    }

    // NOTE: also move to stargate protocol driver after PoC
    function _getPool(uint256 _poolId) internal view returns (Pool) {
        return Router(stargateRouter).factory().getPool(_poolId);
    }
    // NOTE: also move to stargate protocol driver after PoC
    function _getPoolIndexInFarming(uint256 _poolId) internal view returns (bool, uint256) {
        Pool pool = _getPool(_poolId);
        
        for (uint i = 0; i < LPStaking(stargateLpStaking).poolLength(); i++ ) {
            if (address(LPStaking(stargateLpStaking).getPoolInfo(i)) == address(pool)) {
                return (true, i);
            }
        }
        // not found
        return (false, 0);
    }
    /**
    * NOTE: Need to move to protocol driver after PoC.
     */
    function _stake(uint256 _amountLD, address _token ) private {
        require (_amountLD > 0, "Cannot stake zero amount");
        Pool _pool = _getStargatePoolFromToken(_token);
        uint256 _poolId = _pool.poolId();
        // Approve coin transfer from OrderTaker to STG.Pool
        IERC20 coinContract = IERC20(_pool.token());
        coinContract.approve(stargateRouter, _amountLD);
        // Stake coin from OrderTaker to STG.Pool
        uint256 balancePre = _pool.balanceOf(address(this));
        Router(stargateRouter).addLiquidity(_poolId, _amountLD, address(this));
        uint256 balanceAfter = _pool.balanceOf(address(this));
        uint256 amountLPToken = balanceAfter - balancePre;
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = _getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");
        // Approve LPToken transfer from OrderTaker to LPStaking
        _pool.approve(stargateLpStaking, amountLPToken);
        // Stake LPToken from OrderTaker to LPStaking
        LPStaking(stargateLpStaking).deposit(stkPoolIndex, amountLPToken);
    }

    /**
    * NOTE: Need to move to protocol driver after PoC.
    */
    function _unstake(uint256 _amountLPToken, address _token) private {
        require (_amountLPToken > 0, "Cannot unstake zero amount");
        Pool _pool = _getStargatePoolFromToken(_token);
        uint256 _poolId = _pool.poolId();
        // Find the Liquidity Pool's index in the Farming Pool.
        (bool found, uint256 stkPoolIndex) = _getPoolIndexInFarming(_poolId);
        require(found, "The LP token not acceptable.");

        // Unstake LPToken from LPStaking to OrderTaker
        LPStaking(stargateLpStaking).withdraw(stkPoolIndex, _amountLPToken);
        
        // Unstake coin from STG.Pool to OrderTaker
        Router(stargateRouter).instantRedeemLocal(uint16(_poolId), _amountLPToken, address(this));
        
        IERC20 _coinContract = IERC20(_pool.token());
        uint256 _userToken = _coinContract.balanceOf(address(this));
    }

    function _swapRemote(uint256 _amountLD, address _srcToken, uint16 _dstChainId, address _dstToken) private {
        require (_amountLD > 0, "Cannot stake zero amount");
        uint256 _srcPoolId = _getStargatePoolFromToken(_srcToken).poolId();
        uint256 _dstPoolId = _getStargatePoolFromToken(_dstToken).poolId();

        IERC20(_srcToken).approve(stargateRouter, _amountLD);
        Router(stargateRouter).swap(_dstChainId, _srcPoolId, _dstPoolId, payable(msg.sender), _amountLD, 0, IStargateRouter.lzTxObj(0, 0, "0x"), abi.encodePacked(msg.sender), bytes(""));
    }

}