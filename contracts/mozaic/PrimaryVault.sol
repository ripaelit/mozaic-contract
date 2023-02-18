pragma solidity ^0.8.0;

// imports
import "../libraries/oft/OFTCore.sol";
import "../libraries/stargate/Router.sol";
import "../libraries/stargate/Pool.sol";
import "./SecondaryVault.sol";
import "./MozaicLP.sol";
import "./OrderTaker.sol";

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
    function secondaryVaultsLength() public view returns (uint256) {
        return secondaryVaults.length;
    }
    mapping (uint16 => uint256) public secondaryVaultIndex; // chainId -> index in secondaryVaults

    mapping (uint16 => SnapshotReport) public snapshotReport; // chainId -> SnapshotReport
    mapping (uint16 => bool) public snapshotReportFlag; // true - arrived false - not arrived

    uint256 public mozaicLpPerStablecoinMil=0; // mozLP/stablecoinSD*1_000_000
    uint256 public constant INITIAL_MLP_PER_COIN_MIL=1000000;
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) SecondaryVault(_lzEndpoint, _chainId, _stargateRouter, _stargateLpStaking, _stargateToken, _mozaicLp) {
        setMainChainId(_chainId);
    }
    function addSecondaryVaults(VaultDescriptor calldata _vault) external onlyOwner {
        // TODO: prevent duplicate of (chainId)
        // TODO: prevent duplicate of (chainId, vaultAddress)
        secondaryVaults.push(_vault);
    }

    function initOptimizationSession() public onlyOwner {
        // reset
        mozaicLpPerStablecoinMil = 0;
        // TODO: reset snapshotReport, snapshotReportFlag;
        // Check staged ...
        require(_stagedReqs().totalWithdrawRequestMLP == 0, "Staged request should be all processessed");
        require(_stagedReqs().totalDepositRequestSD == 0, "Staged request should be all processessed");
    }

    /**
     * Call this with zero gas
     */
    function snapshotAndReport() virtual override public payable onlyOwner {
        require(!snapshotReportFlag[chainId], "Report is already ready");
        // Processing Amount Should be Zero!
        require(_stagedReqs().totalDepositRequestSD==0, "Still has processing requests");
        require(_stagedReqs().totalWithdrawRequestMLP==0, "Still has processing requests");
        SnapshotReport memory report = _snapshot();
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
            emit UnexpectedLzMessage(packetType, _payload);
            // super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
    function _acceptSnapshotReport(uint16 _srcChainId, SnapshotReport memory _report) internal {
        require(!snapshotReportFlag[_srcChainId], "Report is already ready");
        snapshotReport[_srcChainId] = _report;
        snapshotReportFlag[_srcChainId] = true;
        if (checkAllSnapshotReportReady()) {
            calculateMozLpPerStablecoinMil();
        }
    }
    function calculateMozLpPerStablecoinMil() public {
        require(checkAllSnapshotReportReady(), "Some SnapshotReports not reached");
        uint256 _stargatePriceMil = _getStargatePriceMil();
        uint256 _totalStablecoinValue = 0;
        uint256 _mintedMozLp = 0;
        // _mintedMozLp - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        for (uint i = 0; i < secondaryChainIds.length ; i++) {
            SnapshotReport memory report = snapshotReport[secondaryChainIds[i]];
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
    function checkAllSnapshotReportReady() public view returns (bool) {
        if (!snapshotReportFlag[chainId]) {
            return false;
        }
        for (uint i = 0; i < secondaryChainIds.length ; i++) {
            if (!snapshotReportFlag[secondaryChainIds[i]]) {
                return false;
            }
        }
        return true;
    }

    function settleRequestsAllVaults() public payable {
        require(mozaicLpPerStablecoinMil != 0, "mozaic lp-stablecoin ratio not ready");
        settleRequests(mozaicLpPerStablecoinMil);
        for (uint i = 0; i < secondaryVaults.length; i++) {
            VaultDescriptor memory vd = secondaryVaults[i];
            bytes memory lzPayload = abi.encode(PT_ACCEPTREQUESTS, mozaicLpPerStablecoinMil);
            _lzSend(vd.chainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
        }
    }

    //---------------------------------------------------------------------------
    // INTERNAL
    function _getStargatePriceMil() internal returns (uint256) {
        return 0;
    }
}
