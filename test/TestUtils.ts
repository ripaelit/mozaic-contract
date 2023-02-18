import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {Bridge, Bridge__factory, contracts, ERC20, ERC20__factory, Factory, Factory__factory, LPStaking, LPStaking__factory, Pool, Pool__factory, Router, Router__factory, StargateToken, StargateToken__factory, LZEndpointMock, LZEndpointMock__factory, MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, ILayerZeroEndpoint, MockDex__factory, PancakeSwapDriver__factory, MockToken, MockToken__factory } from '../types/typechain';
// import { ERC20Mock } from '../types/typechain';
// import { ERC20Mock__factory } from '../types/typechain';
import { StargateChainPath, StargateDeploymentOnchain, StargateDeployments, LayerZeroDeployments, StableCoinDeployments, MozaicDeployment } from '../constants/types';
import { BigNumber } from 'ethers';
import exportData from '../constants';

export const deployStablecoins = async (owner: SignerWithAddress, stablecoins: Map<number, Array<string>>) => {
  let coinContracts : StableCoinDeployments = new Map<number, Map<string, ERC20>>([]);
  for (const chainId of stablecoins.keys()) {
    let contractsInChain = new Map<string, MockToken>([]);
    for (const stablecoinname of stablecoins.get(chainId) || []) {
      const coinFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
      const coin = await coinFactory.deploy(stablecoinname, stablecoinname, BigNumber.from("18"));
      await coin.deployed();
      console.log("Deployed coin: chainId, stablecoinname, address, totalSupply:", chainId, stablecoinname, coin.address, await coin.totalSupply());
      contractsInChain.set(stablecoinname, coin);
    }
    coinContracts.set(chainId, contractsInChain);
  }
  return coinContracts;
}

export const deployStargate = async (
  owner: SignerWithAddress, 
  stablecoinDeployments: StableCoinDeployments, 
  poolIds: Map<string, number>, 
  stgMainChainId: number, 
  stargateChainPaths: Array<StargateChainPath>
  ) => {
  let stargateDeployments : StargateDeployments = new Map<number, StargateDeploymentOnchain>();
  for (const chainId of stablecoinDeployments.keys()!) {
    await newStargateEndpoint(chainId, owner, stargateDeployments, stablecoinDeployments, poolIds, stgMainChainId, stargateChainPaths);
  }

  return stargateDeployments;
}

export const equalize = async (owner: SignerWithAddress, stargateDeployments: StargateDeployments) => {
  for (const chainId of stargateDeployments.keys()!) {
    for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
      const chainPathsLength = await pool.getChainPathsLength();
      for (let i = 0; i < chainPathsLength.toNumber(); i++) {
        let cp = await pool.chainPaths(i);
        await stargateDeployments.get(chainId)!.routerContract.sendCredits(cp.dstChainId, poolId, cp.dstPoolId, owner.address);
      }
    }
  }
}

export const bridgeStargateEndpoints = async (stargateDeployments: StargateDeployments) => {
//   console.log("TestUtils.bridgeStargateEndpoints called");
  for (const srcChainId of stargateDeployments.keys()!) {
    for (const dstChainId of stargateDeployments.keys()!) {
      if (srcChainId === dstChainId) continue;
      const stargateSrc = stargateDeployments.get(srcChainId)!;
      const stargateDst = stargateDeployments.get(dstChainId)!;

      const remoteBridge = await stargateSrc.bridgeContract.bridgeLookup(dstChainId);
      if (remoteBridge === "0x") {
        // set it if its not set
        await stargateSrc.bridgeContract.setBridge(dstChainId, stargateDst.bridgeContract.address);
        // console.log("TestUtils.bridgeStargateEndpoints: setBridge: ", srcChainId, dstChainId, stargateDst.bridgeContract.address);
      }

      const destLzEndpoint = await stargateSrc.lzEndpoint.lzEndpointLookup(stargateDst.bridgeContract.address);
      if (destLzEndpoint === "0x0000000000000000000000000000000000000000") {
        // set it if its not set
        await stargateSrc.lzEndpoint.setDestLzEndpoint(stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address);
        // console.log("TestUtils.bridgeStargateEndpoints: setDestLzEndpoint: bridge, lzEndpoint:", stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address)
      }
    }
  }
}

export const newStargateEndpoint = async (
  _chainId: number, 
  owner: SignerWithAddress, 
  stargateDeployments: StargateDeployments, 
  stablecoinDeployments: StableCoinDeployments, 
  poolIds: Map<string, number>, 
  stgMainChainId: number, 
  stargateChainPaths: Array<StargateChainPath>) => {
  let stargateDeploymentOnchain = {} as StargateDeploymentOnchain;
//   console.log("TestUtils.newStargateEndpoint started: _chainId, stgMainchainId:", _chainId, stgMainChainId);

  // Deploy LzEndpoint
  const lzEndpointFactory = (await ethers.getContractFactory('LZEndpointMock', owner)) as LZEndpointMock__factory;
  const lzEndpoint = await lzEndpointFactory.deploy(_chainId);
  await lzEndpoint.deployed();
//   console.log("Deployed LZEndpoint: chainId, address:", _chainId, lzEndpoint.address);
  stargateDeploymentOnchain.lzEndpoint = lzEndpoint;
  
  // Deploy Router
  const routerFactory = (await ethers.getContractFactory('Router', owner)) as Router__factory;
  const router = await routerFactory.deploy();
  await router.deployed();
//   console.log("Deployed Router: chainId, address:", _chainId, router.address);
  stargateDeploymentOnchain.routerContract = router;

  // Deploy Bridge
  const bridgeFactory = (await ethers.getContractFactory('Bridge', owner)) as Bridge__factory;
  const bridge = await bridgeFactory.deploy(lzEndpoint.address, router.address);
  await bridge.deployed();
//   console.log("Deployed Bridge: chainId, address:", _chainId, bridge.address);
  stargateDeploymentOnchain.bridgeContract = bridge;
  
  // Deploy Factory
  const factoryFactory = (await ethers.getContractFactory('Factory', owner)) as Factory__factory;
  const factory = await factoryFactory.deploy(router.address);
  await factory.deployed();
//   console.log("Deployed Factory: chainId, address:", _chainId, factory.address);
  stargateDeploymentOnchain.factoryContract = factory;

  // Deploy FeeLibrary
  //...

  // Link Bridge and Factory to Router  //set deploy params
  await router.setBridgeAndFactory(bridge.address, factory.address);

  // Create Pools For each stablecoin
  const poolFactory = (await ethers.getContractFactory('Pool', owner)) as Pool__factory;
  const stablecoins = stablecoinDeployments.get(_chainId)!;
  const pools = new Map<number, Pool>();
  for (const [coinname, coincontract] of stablecoins) {
    await router.createPool(poolIds.get(coinname)!, coincontract.address, 6, 18, coinname, coinname);
    const poolAddress = await factory.getPool(poolIds.get(coinname)!);
    const pool = poolFactory.attach(poolAddress);
    const poolId = poolIds.get(coinname)!;
    pools.set(poolId, pool);
  }
  stargateDeploymentOnchain.pools = pools;

  // Create and activate ChainPaths
  for (const chainPath of stargateChainPaths) {
    if (chainPath.sourceChainId != _chainId) continue;
    await router.createChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId, chainPath.weight);
    await router.activateChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId);
  }

  // LPStaking and STG
  // Deploy Stargate Token
  const stargateTokenFactory = (await ethers.getContractFactory('StargateToken', owner));
  const stargateToken = await stargateTokenFactory.deploy(
    'Stargate Token', 
    'STG', 
    lzEndpoint.address,
    stgMainChainId, 
    BigNumber.from("4000000000000") // 4*1e12   minted to owner
  );
  await stargateToken.deployed();
  stargateDeploymentOnchain.stargateToken = stargateToken;
//   console.log("Deployed StargateToken: chainId, address, totalSupply:", _chainId, stargateToken.address, await stargateToken.totalSupply());

  // Deploy LPStaking contract
  const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner));
  const latestBlockNumber = await ethers.provider.getBlockNumber();
  const lpStaking = await lpStakingFactory.deploy(stargateToken.address, BigNumber.from("100000"), latestBlockNumber + 3, latestBlockNumber + 3);
  await lpStaking.deployed();
  stargateDeploymentOnchain.lpStakingContract = lpStaking;
//   console.log("Deployed LPStaking: chainId, address, totalAllocPoint:", _chainId, lpStaking.address, await lpStaking.totalAllocPoint());

  stargateDeployments.set(_chainId, stargateDeploymentOnchain);

  //bridge new stargate with each other
  await bridgeStargateEndpoints(stargateDeployments);
  
  return stargateDeploymentOnchain;
}

export const deployMozaic = async (owner: SignerWithAddress, primaryChainId: number, stargateDeployments: StargateDeployments, layerzeroDeployments: LayerZeroDeployments, protocols: Map<number, Map<string,string>>) => {
  let mozDeploys = new Map<number, MozaicDeployment>();
  for (const [chainId, stgDeploy] of stargateDeployments) {
    // Deploy MozaicLP
    const mozaicLpFactory = await ethers.getContractFactory('MozaicLP', owner) as MozaicLP__factory;
    console.log("ETH(owner) before deploy MozaicLP", (await ethers.provider.getBalance(owner.address)).toString());
    const mozaicLp = await mozaicLpFactory.deploy("MozaicLP", "mLP", layerzeroDeployments.get(chainId)!.address);
    console.log("ETH(owner) after deploy MozaicLP", (await ethers.provider.getBalance(owner.address)).toString());
    console.log("Gas Price:", (await ethers.provider.getGasPrice()).toString());
    await mozaicLp.deployed();

    // Deploy Protocal Drivers
    // Get protocol
    const protocol = protocols.get(chainId)!.get("PancakeSwapSmartRouter")!;
    const configProtocol = ethers.utils.defaultAbiCoder.encode(["address"], [protocol]);
    // 1. Deploy PancakeSwapDriver
    const pancakeSwapDriverFactory = await ethers.getContractFactory('PancakeSwapDriver', owner) as PancakeSwapDriver__factory;
    const pancakeSwapDriver = await pancakeSwapDriverFactory.deploy();
    await pancakeSwapDriver.deployed();
    console.log("TestUtils.deployMozaic: chainId, pancakeSwapDriver:", chainId, pancakeSwapDriver.address);

    // Deploy Vault
    let vault;
    if (chainId == primaryChainId) {
      // Deploy PrimaryVault
      const primaryVaultFactory = await ethers.getContractFactory('PrimaryVault', owner) as PrimaryVault__factory;
      const primaryVault = await primaryVaultFactory.deploy(layerzeroDeployments.get(chainId)!.address, chainId, primaryChainId, stgDeploy.routerContract.address, stgDeploy.lpStakingContract.address, stgDeploy.stargateToken.address, mozaicLp.address, {gasLimit:BigNumber.from("30000000")});
      await primaryVault.deployed();
      await primaryVault.setProtocolDriver(exportData.localTestConstants.pancakeSwapDriverId, pancakeSwapDriver.address, configProtocol);
      console.log("Deployed PrimaryVault:", primaryVault.address);
      vault = primaryVault;
    }
    else {
      // Deploy SecondaryVault
      const secondaryVaultFactory = await ethers.getContractFactory('SecondaryVault', owner) as SecondaryVault__factory;
      const secondaryVault = await secondaryVaultFactory.deploy(layerzeroDeployments.get(chainId)!.address, chainId, primaryChainId, stgDeploy.routerContract.address, stgDeploy.lpStakingContract.address, stgDeploy.stargateToken.address, mozaicLp.address)
      await secondaryVault.deployed();
    //   await secondaryVault.connect(owner).setMainChainId(primaryChain);
      await secondaryVault.setProtocolDriver(exportData.localTestConstants.pancakeSwapDriverId, pancakeSwapDriver.address, configProtocol);
      console.log("Deployed SecondaryVault:", secondaryVault.address);
      vault = secondaryVault;
    }
    
    let mozDeploy : MozaicDeployment = {
      mozaicLp: mozaicLp,
      mozaicVault: vault,
    }
    mozDeploys.set(chainId, mozDeploy);
  }
  // Register TrustedRemote
  for (const [chainIdLeft] of stargateDeployments) {
    for (const [chainIdRight] of stargateDeployments) {
      if (chainIdLeft == chainIdRight) continue;
      await mozDeploys.get(chainIdLeft)!.mozaicVault.connect(owner).setTrustedRemoteAddress(chainIdRight, mozDeploys.get(chainIdRight)!.mozaicVault.address);
      await mozDeploys.get(chainIdLeft)!.mozaicLp.connect(owner).setTrustedRemoteAddress(chainIdRight, mozDeploys.get(chainIdRight)!.mozaicLp.address);
    }
    // TODO: Transfer ownership of MozaicLP to Vault
    await mozDeploys.get(chainIdLeft)!.mozaicLp.connect(owner).transferOwnership(mozDeploys.get(chainIdLeft)!.mozaicVault.address);
  }
  return mozDeploys;  
}

export const getLayerzeroDeploymentsFromStargateDeployments = (stargateDeployments: StargateDeployments) => {
  const lzDeploys = new Map<number, LZEndpointMock>();
  for (const [chainId, stgDeploy] of stargateDeployments) {
    lzDeploys.set(chainId, stgDeploy.lzEndpoint);
  }
  return lzDeploys;
}