pragma solidity ^0.8.0;

// imports
import "../libraries/stargate/Router.sol";
import "./SecondaryVault.sol";
import "./MozaicLP.sol";

// libraries
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

contract PrimaryVault is SecondaryVault {
    using SafeMath for uint256;
    //---------------------------------------------------------------------------
    // EVENTS
    
    //--------------------------------------------------------------------------
    // ENUMS
    enum ProtocolStatus {
        IDLE,
        OPTIMIZING
    }
    enum VaultStatus {
        IDLE,
        SNAPSHOTTING,
        SNAPSHOTTED,
        SETTLING,
        SETTLED
    }

    //--------------------------------------------------------------------------
    // STRUCTS
    struct VaultDescriptor {
        uint16 chainId;
        address vaultAddress;
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    ProtocolStatus public protocolStatus;

    uint16[] public secondaryChainIds;
    mapping(uint16 => VaultDescriptor) public secondaryVaults;
    mapping(uint16 => VaultStatus) public secondaryVaultStatus;

    function secondaryChainIdsLength() public view returns (uint256) {
        return secondaryChainIds.length;
    }
    // mapping (uint16 => uint256) public secondaryVaultIndex; // chainId -> index in secondaryVaults

    mapping (uint16 => SnapshotReport) public snapshotReport; // chainId -> SnapshotReport

    uint256 public mozaicLpPerStablecoinMil=0; // mozLP/stablecoinSD*1_000_000
    uint256 public constant INITIAL_MLP_PER_COIN_MIL=1000000;
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        uint16 _primaryChainId,
        address _stargateRouter,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) SecondaryVault(_lzEndpoint, _chainId, _primaryChainId, _stargateRouter, _stargateLpStaking, _stargateToken, _mozaicLp) {
        protocolStatus = ProtocolStatus.IDLE;
        // setMainChainId(_chainId);
    }
    function setSecondaryVaults(uint16 _chainId, VaultDescriptor calldata _vault) external onlyOwner {
        require(_chainId != chainId, "Cannot be primary chainID");
        bool _already = false;
        for (uint i = 0; i < secondaryChainIds.length; i++) {
            if (secondaryChainIds[i]==_chainId) {
                _already = true;
                break;
            }
        }
        if (!_already) {
            secondaryChainIds.push(_chainId);
        }
        secondaryVaults[_chainId]=_vault;
    }

    function initOptimizationSession() public onlyOwner {
        require(protocolStatus == ProtocolStatus.IDLE, "idle before optimizing");
        // reset
        mozaicLpPerStablecoinMil = 0;
        protocolStatus = ProtocolStatus.OPTIMIZING;
        secondaryVaultStatus[chainId] = VaultStatus.SNAPSHOTTING;
        for (uint i = 0; i < secondaryChainIds.length; i++) {
            secondaryVaultStatus[secondaryChainIds[i]] = VaultStatus.SNAPSHOTTING;
        }
    }

    /**
     * Call this with zero gas
     */
    function snapshotAndReport() virtual override public payable onlyOwner {
        // Processing Amount Should be Zero!
        require(_stagedReqs().totalDepositRequest==0, "Still has processing requests");
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
        } 
        else if (packetType == PT_SETTLED_REQUESTS) {
            secondaryVaultStatus[_srcChainId] = VaultStatus.SETTLED;
            if (checkRequestsSettledAllVaults()) {
                _resetProtocolStatus();
            }
        }
        else {
            emit UnexpectedLzMessage(packetType, _payload);
            // super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }
    function _acceptSnapshotReport(uint16 _srcChainId, SnapshotReport memory _report) internal {
        require(secondaryVaultStatus[_srcChainId]==VaultStatus.SNAPSHOTTING, "Expect: prevStatus=SNAPSHOTTING");
        snapshotReport[_srcChainId] = _report;
        secondaryVaultStatus[_srcChainId]=VaultStatus.SNAPSHOTTED;
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
        console.log("total mLP: %d / total$: %d * kk = %d", _totalStablecoinValue, _mintedMozLp, mozaicLpPerStablecoinMil);
    }
    function checkAllSnapshotReportReady() public view returns (bool) {
        if (secondaryVaultStatus[chainId]!=VaultStatus.SNAPSHOTTED) {
            return false;
        }
        for (uint i = 0; i < secondaryChainIds.length ; i++) {
            if (secondaryVaultStatus[secondaryChainIds[i]]!=VaultStatus.SNAPSHOTTED) {
                return false;
            }
        }
        return true;
    }
    function checkRequestsSettledAllVaults() public view returns (bool) {
        for (uint i=0; i < secondaryChainIds.length; i++) {
            if (secondaryVaultStatus[secondaryChainIds[i]] != VaultStatus.SETTLED) {
                return false;
            }
        }
        return true;
    }

    function settleRequestsAllVaults() public payable {
        require(checkAllSnapshotReportReady(), "Settle-All: Requires all reports");
        require(mozaicLpPerStablecoinMil != 0, "mozaic lp-stablecoin ratio not ready");
        _settleRequests(mozaicLpPerStablecoinMil);
        secondaryVaultStatus[chainId] = VaultStatus.SETTLED;
        for (uint i = 0; i < secondaryChainIds.length; i++) {
            VaultDescriptor memory vd = secondaryVaults[secondaryChainIds[i]];
            secondaryVaultStatus[secondaryChainIds[i]] = VaultStatus.SETTLING;
            bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, mozaicLpPerStablecoinMil);
            _lzSend(vd.chainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
        }
    }

    function _resetProtocolStatus() internal {
        for (uint i=0; i < secondaryChainIds.length; i++) {
            secondaryVaultStatus[secondaryChainIds[i]] = VaultStatus.IDLE;
        }
        protocolStatus = ProtocolStatus.IDLE;
    }
    //---------------------------------------------------------------------------
    // INTERNAL

    /**
    * NOTE: PoC: need to move to StargateDriver in next phase of development.
     */
    function _getStargatePriceMil() internal returns (uint256) {
        // PoC: right now deploy to TestNet only. We work with MockSTG token and Mocked Stablecoins.
        // And thus we don't have real DEX market.
        return 1000000;
    }
}
