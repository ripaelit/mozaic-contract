pragma solidity ^0.8.0;

// imports
import "./SecondaryVault.sol";

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
    mapping(uint16 => SecondaryVault.VaultStatus) public secondaryVaultStatus;

    function secondaryChainIdsLength() public view returns (uint256) {
        return secondaryChainIds.length;
    }
    // mapping (uint16 => uint256) public secondaryVaultIndex; // chainId -> index in secondaryVaults

    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot

    uint256 public mozaicLpPerStablecoinMil=0; // mozLP/stablecoinSD*1_000_000
    uint256 public constant INITIAL_MLP_PER_COIN_MIL=1000000;
    
    //---------------------------------------------------------------------------
    // CONSTRUCTOR AND PUBLIC FUNCTIONS
    constructor(
        address _lzEndpoint,
        uint16 _chainId,
        uint16 _primaryChainId,
        address _stargateLpStaking,
        address _stargateToken,
        address _mozaicLp
    ) SecondaryVault(_lzEndpoint, _chainId, _primaryChainId, _stargateLpStaking, _stargateToken, _mozaicLp) {
        protocolStatus = ProtocolStatus.IDLE;
        // setMainChainId(_chainId);
    }

    function setSecondaryVaults(uint16 _chainId, VaultDescriptor calldata _vault) external onlyOwner {
        if (_chainId == chainId)    return;
        // require(_chainId != chainId, "Cannot be primary chainID");
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
    function reportSnapshot() virtual override public payable onlyOwner {
        // Processing Amount Should be Zero!
        require(status == VaultStatus.SNAPSHOTTED, "reportSnapshot: Not snapshotted yet.");
        // Send Report
        _acceptSnapshot(chainId, snapshot);
    }

    function _nonblockingLzReceive(uint16 _srcChainId, bytes memory _srcAddress, uint64 _nonce, bytes memory _payload) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_REPORTSNAPSHOT) {
            (, Snapshot memory _newSnapshot) = abi.decode(_payload, (uint16, Snapshot));
            _acceptSnapshot(_srcChainId, _newSnapshot);
        } 
        else if (packetType == PT_SETTLED_REQUESTS) {
            secondaryVaultStatus[_srcChainId] = VaultStatus.IDLE;
            if (_checkRequestsSettledAllVaults()) {
                _resetProtocolStatus();
            }
        }
        else {
            emit UnexpectedLzMessage(packetType, _payload);
            // super._nonblockingLzReceive(_srcChainId, _srcAddress, _nonce, _payload);
        }
    }

    function _acceptSnapshot(uint16 _srcChainId, Snapshot memory _newSnapshot) internal {
        require(secondaryVaultStatus[_srcChainId]==VaultStatus.SNAPSHOTTING, "Expect: prevStatus=SNAPSHOTTING");
        snapshotReported[_srcChainId] = _newSnapshot;
        secondaryVaultStatus[_srcChainId]=VaultStatus.SNAPSHOTTED;
        if (allVaultsSnapshotted()) {
            calculateMozLpPerStablecoinMil();
        }
    }

    function calculateMozLpPerStablecoinMil() public {
        require(allVaultsSnapshotted(), "Some Snapshots not reached");
        uint256 _stargatePriceMil = _getStargatePriceMil();
        uint256 _totalStablecoinValue = 0;
        uint256 _mintedMozLp = 0;
        // _mintedMozLp - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        for (uint i = 0; i < secondaryChainIds.length ; i++) {
            Snapshot memory report = snapshotReported[secondaryChainIds[i]];
            console.log("i = %d, report.totalMozaicLp = %d, report.totalStablecoin = %d", i, report.totalMozaicLp, report.totalStablecoin);
            _totalStablecoinValue = _totalStablecoinValue.add(report.totalStablecoin + _stargatePriceMil.mul(report.totalStargate).div(1000000));
            _mintedMozLp = _mintedMozLp.add(report.totalMozaicLp);
        }
        if (_totalStablecoinValue > 0) {
            console.log("mozaicLpPerStablecoinMil 1: _mintedMozLp:", _mintedMozLp);
            mozaicLpPerStablecoinMil = _mintedMozLp.mul(1000000).div(_totalStablecoinValue);
        }
        else {
            console.log("mozaicLpPerStablecoinMil 2:");
            mozaicLpPerStablecoinMil = INITIAL_MLP_PER_COIN_MIL;
        }
    }

    function allVaultsSnapshotted() public view returns (bool) {
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

    function _checkRequestsSettledAllVaults() internal view returns (bool) {
        for (uint i=0; i < secondaryChainIds.length; i++) {
            if (secondaryVaultStatus[secondaryChainIds[i]] != VaultStatus.IDLE) {
                return false;
            }
        }
        return true;
    }

    function settleRequestsAllVaults() public payable {
        require(allVaultsSnapshotted(), "Settle-All: Requires all reports");
        require(mozaicLpPerStablecoinMil != 0, "mozaic lp-stablecoin ratio not ready");
        console.log("settleRequestsAllVaults: mozaicLpPerStablecoinMil =", mozaicLpPerStablecoinMil);
        _settleRequests(mozaicLpPerStablecoinMil);
        secondaryVaultStatus[chainId] = VaultStatus.IDLE;
        for (uint i = 0; i < secondaryChainIds.length; i++) {
            VaultDescriptor memory vd = secondaryVaults[secondaryChainIds[i]];
            secondaryVaultStatus[secondaryChainIds[i]] = VaultStatus.SETTLING;
            bytes memory lzPayload = abi.encode(PT_SETTLE_REQUESTS, mozaicLpPerStablecoinMil);
            _lzSend(vd.chainId, lzPayload, payable(msg.sender), address(0x0), "", msg.value);
        }
    }

    function _resetProtocolStatus() internal {
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
        // KEVIN-TODO:
        return 1000000;
    }
}
