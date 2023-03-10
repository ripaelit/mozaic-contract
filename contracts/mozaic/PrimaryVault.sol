pragma solidity ^0.8.9;

// imports
import "./SecondaryVault.sol";

contract PrimaryVault is SecondaryVault {
    using SafeMath for uint256;
    //--------------------------------------------------------------------------
    // ENUMS
    enum ProtocolStatus {
        IDLE,
        OPTIMIZING
    }

    //---------------------------------------------------------------------------
    // VARIABLES
    ProtocolStatus public protocolStatus;
    mapping(uint16 => SecondaryVault.VaultStatus) public vaultStatus;
    mapping (uint16 => Snapshot) public snapshotReported; // chainId -> Snapshot
    uint256 public mozaicLpPerStablecoinMil; // mozLP/stablecoinSD*1_000_000
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
        mozaicLpPerStablecoinMil = 0;
    }

    function _nonblockingLzReceive(
        uint16 _srcChainId, 
        bytes memory _srcAddress, 
        uint64 _nonce, 
        bytes memory _payload
    ) internal virtual override {
        uint16 packetType;
        assembly {
            packetType := mload(add(_payload, 32))
        }

        if (packetType == PT_REPORTSNAPSHOT) {
            (, Snapshot memory _newSnapshot) = abi.decode(_payload, (uint16, Snapshot));
            _acceptSnapshotReport(_srcChainId, _newSnapshot);
        } 
        else if (packetType == PT_SETTLED_REPORT) {
            _acceptSettledReport(_srcChainId);
        }
        else {
            emit UnexpectedLzMessage(packetType, _payload);
        }
    }

    function _acceptSnapshotReport(uint16 _srcChainId, Snapshot memory _newSnapshot) internal {
        vaultStatus[_srcChainId] = VaultStatus.SNAPSHOTTED;
        snapshotReported[_srcChainId] = _newSnapshot;
        vaultStatus[_srcChainId]=VaultStatus.SNAPSHOTTED;
        if (allVaultsSnapshotted()) {
            calculateMozLpPerStablecoinMil();
        }
    }

    function _acceptSettledReport(uint16 _srcChainId) internal {
        vaultStatus[_srcChainId] = VaultStatus.IDLE;
        if (allVaultsSettled()) {
            protocolStatus = ProtocolStatus.IDLE;
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

    function allVaultsSettled() public view returns (bool) {
        for (uint i = 0; i < vaults.length ; ++i) {
            if (vaultStatus[vaults[i].chainId] != VaultStatus.IDLE) {
                return false;
            }
        }
        return true;
    }

    function calculateMozLpPerStablecoinMil() public {
        uint256 _stargatePriceMil = _getStargatePriceMil();
        uint256 _totalStablecoinMD = 0;
        uint256 _mintedMozLp = 0;
        // _mintedMozLp - This is actually not required to sync via LZ. Instead we can track the value in primary vault as alternative way.
        for (uint i = 0; i < vaults.length ; ++i) {
            Snapshot memory report = snapshotReported[vaults[i].chainId];
            _totalStablecoinMD = _totalStablecoinMD.add(report.totalStablecoin + _stargatePriceMil.mul(report.totalStargate).div(1000000));
            _mintedMozLp = _mintedMozLp.add(report.totalMozaicLp);
        }
        if (_totalStablecoinMD > 0) {
            mozaicLpPerStablecoinMil = _mintedMozLp.mul(1000000).div(_totalStablecoinMD);
        }
        else {
            mozaicLpPerStablecoinMil = INITIAL_MLP_PER_COIN_MIL;
        }
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

    function quoteLayerZeroFee(
        uint16 _chainId,
        uint16 _packetType
    ) public view virtual override returns (uint256 _nativeFee, uint256 _zroFee) {
        bytes memory payload = "";
        if (_packetType == PT_SETTLE_REQUESTS) {
            payload = abi.encode(PT_SETTLE_REQUESTS, mozaicLpPerStablecoinMil);
        } else if (_packetType == PT_TAKE_SNAPSHOT) {
            payload = abi.encode(PT_TAKE_SNAPSHOT);
        } else {
            revert("Vault: unsupported packet type");
        }

        bytes memory lzTxParamBuilt = "";
        bool useLayerZeroToken = false;
        return lzEndpoint.estimateFees(_chainId, address(this), payload, useLayerZeroToken, lzTxParamBuilt);
    }
}
