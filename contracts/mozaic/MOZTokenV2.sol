// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
// pragma solidity =0.7.6;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IMOZTokenV2.sol";
import "../libraries/token/oft/v2/OFTV2.sol";

/// @title A LayerZero OmnichainFungibleToken example of BasedOFT
/// @notice Use this contract only on the BASE CHAIN. It locks tokens on source, on outgoing send(), and unlocks tokens when receiving from other chains.
/*
 * MOZ is Mozaic's native ERC20 token.
 * It has an hard cap and manages its own emissions and allocations.
 */
contract MOZTokenV2 is OFTV2, IMOZTokenV2 {
	using SafeMath for uint256;

	uint256 public constant MAX_EMISSION_RATE = 0.01 ether;
	uint256 public constant MAX_SUPPLY_LIMIT = 1000000000 ether;    // 1,000,000,000
	uint256 public elasticMaxSupply; // Once deployed, controlled through governance only
	uint256 public emissionRate; // Token emission per second

	uint256 public override lastEmissionTime;
	uint256 public masterReserve; // Pending rewards for the master

	uint256 public constant ALLOCATION_PRECISION = 100;
	// Allocations emitted over time. When < 100%, the rest is minted into the treasury (default 15%)
	uint256 public farmingAllocation = 50; // = 50%
	uint256 public legacyAllocation; // V1 holders allocation

	address public masterAddress;
	address public treasuryAddress;

	address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

  	constructor(address _layerZeroEndpoint, address _treasuryAddress, uint256 _maxSupply, uint256 _initialSupply, uint256 _initialEmissionRate, uint8 _sharedDecimals) OFTV2("Mozaic Token", "MOZ", _sharedDecimals, _layerZeroEndpoint) {
		require(_initialEmissionRate <= MAX_EMISSION_RATE, "invalid emission rate");
		require(_maxSupply <= MAX_SUPPLY_LIMIT, "invalid initial maxSupply");
		require(_initialSupply < _maxSupply, "invalid initial supply");
		require(_treasuryAddress != address(0), "invalid treasury address");

		elasticMaxSupply = _maxSupply;
		emissionRate = _initialEmissionRate;
		treasuryAddress = _treasuryAddress;

		_mint(msg.sender, _initialSupply);
    }

	/********************************************/
	/****************** EVENTS ******************/
	/********************************************/

	event ClaimMasterRewards(uint256 amount);
	event AllocationsDistributed(uint256 masterShare, uint256 treasuryShare);
	event InitializeMasterAddress(address masterAddress);
	event InitializeEmissionStart(uint256 startTime);
	event UpdateAllocations(uint256 farmingAllocation, uint256 legacyAllocation, uint256 treasuryAllocation);
	event UpdateEmissionRate(uint256 previousEmissionRate, uint256 newEmissionRate);
	event UpdateMaxSupply(uint256 previousMaxSupply, uint256 newMaxSupply);
	event UpdateTreasuryAddress(address previousTreasuryAddress, address newTreasuryAddress);

	/***********************************************/
	/****************** MODIFIERS ******************/
	/***********************************************/

	/*
	* @dev Throws error if called by any account other than the master
	*/
	modifier onlyMaster() {
		require(msg.sender == masterAddress, "MOZToken: caller is not the master");
		_;
	}


	/**************************************************/
	/****************** PUBLIC VIEWS ******************/
	/**************************************************/

	/**
	* @dev Returns total master allocation
	*/
	function masterAllocation() public view returns (uint256) {
		return farmingAllocation.add(legacyAllocation);
	}

	/**
	* @dev Returns master emission rate
	*/
	function masterEmissionRate() public view override returns (uint256) {
		return emissionRate.mul(farmingAllocation.add(legacyAllocation)).div(ALLOCATION_PRECISION);
	}

	/**
	* @dev Returns treasury allocation
	*/
	function treasuryAllocation() public view returns (uint256) {
		return uint256(ALLOCATION_PRECISION).sub(masterAllocation());
	}


	/*****************************************************************/
	/******************  EXTERNAL PUBLIC FUNCTIONS  ******************/
	/*****************************************************************/

	/**
	* @dev Mint rewards and distribute it between master and treasury
	*
	* Treasury share is directly minted to the treasury address
	* Master incentives are minted into this contract and claimed later by the master contract
	*/
	function emitAllocations() public {
		uint256 _circulatingSupply = totalSupply();
		uint256 __currentBlockTimestamp = _currentBlockTimestamp();

		uint256 _lastEmissionTime = lastEmissionTime; // gas saving
		uint256 _maxSupply = elasticMaxSupply; // gas saving

		// if already up to date or not started
		if (__currentBlockTimestamp <= _lastEmissionTime || _lastEmissionTime == 0) {
			return;
		}

		// if max supply is already reached or emissions deactivated
		if (_maxSupply <= _circulatingSupply || emissionRate == 0) {
			lastEmissionTime = __currentBlockTimestamp;
			return;
		}

		uint256 _newEmissions = __currentBlockTimestamp.sub(_lastEmissionTime).mul(emissionRate);

		// cap new emissions if exceeding max supply
		if(_maxSupply < _circulatingSupply.add(_newEmissions)) {
			_newEmissions = _maxSupply.sub(_circulatingSupply);
		}

		// calculate master and treasury shares from new emissions
		uint256 _masterShare = _newEmissions.mul(masterAllocation()).div(ALLOCATION_PRECISION);
		// sub to avoid rounding errors
		uint256 _treasuryShare = _newEmissions.sub(_masterShare);

		lastEmissionTime = __currentBlockTimestamp;

		// add master shares to its claimable reserve
		masterReserve = masterReserve.add(_masterShare);
		// mint shares
		_mint(address(this), _masterShare);
		_mint(treasuryAddress, _treasuryShare);

		emit AllocationsDistributed(_masterShare, _treasuryShare);
	}

	/**
	* @dev Sends to Master contract the asked "amount" from masterReserve
	*
	* Can only be called by the MasterContract
	*/
	function claimMasterRewards(uint256 _amount) external override onlyMaster returns (uint256 _effectiveAmount) {
		// update emissions
		emitAllocations();

		// cap asked amount with available reserve
		_effectiveAmount = Math.min(masterReserve, _amount);

		// if no rewards to transfer
		if (_effectiveAmount == 0) {
			return _effectiveAmount;
		}

		// remove claimed rewards from reserve and transfer to master
		masterReserve = masterReserve.sub(_effectiveAmount);
		_transfer(address(this), masterAddress, _effectiveAmount);
		emit ClaimMasterRewards(_effectiveAmount);
	}

	/**
	* @dev Burns "amount" of MOZ by sending it to BURN_ADDRESS
	*/
	function burn(uint256 _amount) external override {
		_transfer(msg.sender, BURN_ADDRESS, _amount);
	}

	/*****************************************************************/
	/****************** EXTERNAL OWNABLE FUNCTIONS  ******************/
	/*****************************************************************/

	/**
	* @dev Setup Master contract address
	*
	* Can only be initialized once
	* Must only be called by the owner
	*/
	function initializeMasterAddress(address _masterAddress) external onlyOwner {
		require(masterAddress == address(0), "initializeMasterAddress: master already initialized");
		require(_masterAddress != address(0), "initializeMasterAddress: master initialized to zero address");

		masterAddress = _masterAddress;
		emit InitializeMasterAddress(_masterAddress);
	}

	/**
	* @dev Set emission start time
	*
	* Can only be initialized once
	* Must only be called by the owner
	*/
	function initializeEmissionStart(uint256 _startTime) external onlyOwner {
		require(lastEmissionTime == 0, "initializeEmissionStart: emission start already initialized");
		require(_currentBlockTimestamp() < _startTime, "initializeEmissionStart: invalid");

		lastEmissionTime = _startTime;
		emit InitializeEmissionStart(_startTime);
	}

	/**
	* @dev Updates emission allocations between farming incentives, legacy holders and treasury (remaining share)
	*
	* Must only be called by the owner
	*/
	function updateAllocations(uint256 _farmingAllocation, uint256 _legacyAllocation) external onlyOwner {
		// apply emissions before changes
		emitAllocations();

		// total sum of allocations can't be > 100%
		uint256 totalAllocationsSet = _farmingAllocation.add(_legacyAllocation);
		require(totalAllocationsSet <= 100, "updateAllocations: total allocation is too high");

		// set new allocations
		farmingAllocation = _farmingAllocation;
		legacyAllocation = _legacyAllocation;

		emit UpdateAllocations(_farmingAllocation, _legacyAllocation, treasuryAllocation());
	}

	/**
	* @dev Updates MOZ emission rate per second
	*
	* Must only be called by the owner
	*/
	function updateEmissionRate(uint256 _emissionRate) external onlyOwner {
		require(_emissionRate <= MAX_EMISSION_RATE, "updateEmissionRate: can't exceed maximum");

		// apply emissions before changes
		emitAllocations();

		emit UpdateEmissionRate(emissionRate, _emissionRate);
		emissionRate = _emissionRate;
	}

	/**
	* @dev Updates MOZ max supply
	*
	* Must only be called by the owner
	*/
	function updateMaxSupply(uint256 _maxSupply) external onlyOwner {
		require(_maxSupply >= totalSupply(), "updateMaxSupply: can't be lower than current circulating supply");
		require(_maxSupply <= MAX_SUPPLY_LIMIT, "updateMaxSupply: invalid maxSupply");

		emit UpdateMaxSupply(elasticMaxSupply, _maxSupply);
		elasticMaxSupply = _maxSupply;
	}

	/**
	* @dev Updates treasury address
	*
	* Must only be called by owner
	*/
	function updateTreasuryAddress(address _treasuryAddress) external onlyOwner {
		require(_treasuryAddress != address(0), "updateTreasuryAddress: invalid address");

		emit UpdateTreasuryAddress(treasuryAddress, _treasuryAddress);
		treasuryAddress = _treasuryAddress;
	}


	/********************************************************/
	/****************** INTERNAL FUNCTIONS ******************/
	/********************************************************/

	/**
	* @dev Utility function to get the current block timestamp
	*/
	function _currentBlockTimestamp() internal view virtual returns (uint256) {
		/* solhint-disable not-rely-on-time */
		return block.timestamp;
	}
}
