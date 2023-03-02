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

    //---------------------------------------------------------------------------
    // VARIABLES
    ProtocolStatus public protocolStatus;

    // VaultDescriptor[] public secondaryVaults;
    mapping(uint16 => SecondaryVault.VaultStatus) public vaultStatus;

    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot

    uint256 public mozaicLpPerStablecoinMil = 0; // mozLP/stablecoinSD*1_000_000
    uint256 public constant INITIAL_MLP_PER_COIN_MIL = 1000000;
    
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
    }

    function initOptimizationSession() public onlyOwner {
        require(protocolStatus == ProtocolStatus.IDLE, "idle before optimizing");
        // reset
        mozaicLpPerStablecoinMil = 0;
        protocolStatus = ProtocolStatus.OPTIMIZING;
        for (uint i = 0; i < vaults.length; i++) {
            vaultStatus[vaults[i].chainId] = VaultStatus.SNAPSHOTTING;
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
            vaultStatus[_srcChainId] = VaultStatus.IDLE;
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
        require(vaultStatus[_srcChainId]==VaultStatus.SNAPSHOTTING, "Expect: prevStatus=SNAPSHOTTING");
        snapshotReported[_srcChainId] = _newSnapshot;
        vaultStatus[_srcChainId]=VaultStatus.SNAPSHOTTED;
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
        for (uint i = 0; i < vaults.length ; i++) {
            Snapshot memory report = snapshotReported[vaults[i].chainId];
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

    function allVaultsSnapshotted() public view returns (bool) {
        for (uint i = 0; i < vaults.length ; i++) {
            if (vaultStatus[vaults[i].chainId] != VaultStatus.SNAPSHOTTED) {
                return false;
            }
        }
        return true;
    }

    function _checkRequestsSettledAllVaults() internal view returns (bool) {
        for (uint i = 0; i < vaults.length; i++) {
            if (vaultStatus[vaults[i].chainId] != VaultStatus.IDLE) {
                return false;
            }
        }
        return true;
    }

    function settleRequestsAllVaults() public payable {
        require(allVaultsSnapshotted(), "Settle-All: Requires all reports");
        require(mozaicLpPerStablecoinMil != 0, "mozaic lp-stablecoin ratio not ready");
        _settleRequests(mozaicLpPerStablecoinMil);
        vaultStatus[chainId] = VaultStatus.IDLE;
        for (uint i = 0; i < vaults.length; i++) {
            if (vaults[i].chainId == primaryChainId)   continue;
            VaultDescriptor memory vd = vaults[i];
            vaultStatus[vd.chainId] = VaultStatus.SETTLING;
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
