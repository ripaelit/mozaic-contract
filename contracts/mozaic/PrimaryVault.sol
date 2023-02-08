pragma solidity ^0.8.0;

// imports
import "../libraries/oft/OFTCore.sol";
import "../libraries/stargate/Router.sol";
import "../libraries/stargate/Pool.sol";
import "./SecondaryVault.sol";
import "./MozLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "hardhat/console.sol";

contract PrimaryVault is SecondaryVault {
    using SafeMath for uint256;
    //---------------------------------------------------------------------------
    // EVENTS

    //--------------------------------------------------------------------------
    // STRUCTS
    struct VaultDescriptor {
        uint16 chainId;
        address vaultAddress;
    }

    //---------------------------------------------------------------------------
    // VARIABLES

    uint16[] public secondaryChainIds;
    
    VaultDescriptor[] public secondaryVaults;
    mapping (uint16 => uint256) public secondaryVaultIndex; // chainId -> index in secondaryVaults

    mapping (uint16 => SnapshotReport) public snapshotReport; // chainId -> SnapshotReport
    mapping (uint16 => bool) public snapshotReportFlag; // true - arrived false - not arrived
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken
    ) SecondaryVault(_name, _symbol, _lzEndpoint, _chainId, _stargateRouter, _stargateLpStaking, _stargateToken) {
    }
    function addSecondaryVault(uint16 _chainId, address _vaultAddress) public onlyOwner {
        // TODO: prevent duplicate of (chainId)
        // TODO: prevent duplicate of (chainId, vaultAddress)
        secondaryChainIds.push(_chainId);
        VaultDescriptor memory newVault;
        newVault.chainId = _chainId;
        newVault.vaultAddress = _vaultAddress;
        secondaryVaultIndex[_chainId] = secondaryVaults.length;
        secondaryVaults.push(newVault);
    }

    /**
     * Call this with zero gas
     */
    function snapshotAndReport() virtual override public payable onlyOwner {
        require(!snapshotReportFlag[chainId], "Report is already ready");
        require(getProcessingTotalDepositRequestAmountLD()==0, "Still has processing requests");
        require(getProcessingTotalWithdrawRequestAmountMLP()==0, "Still has processing requests");

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
        report.depositRequestAmountLD = getProcessingTotalDepositRequestAmountLD();
        report.withdrawRequestAmountMLP = getProcessingTotalWithdrawRequestAmountMLP();
        report.totalInmoz = this.totalSupply();
        
        // Send Report
        _acceptSnapshotReport(chainId, report);
    }
    function _nonblockingLzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64 _nonce, bytes memory _payload) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_REPORTSNAPSHOT) {
            (, SnapshotReport memory _report) = abi.decode(_payload, (uint16, SnapshotReport));
            _acceptSnapshotReport(_srcChainId, _report);
        } else {
            super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
    function _acceptSnapshotReport(uint16 _srcChainId, SnapshotReport memory _report) internal {
        require(!snapshotReportFlag[_srcChainId], "Report is already ready");
        snapshotReport[_srcChainId] = _report;
        snapshotReportFlag[_srcChainId] = true;
    }
}
