import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {Bridge, Bridge__factory, contracts, ERC20, ERC20__factory, Factory, Factory__factory, LPStaking, LPStaking__factory, Pool, Pool__factory, Router, Router__factory, StargateToken, StargateToken__factory, LZEndpointMock, LZEndpointMock__factory } from '../types/typechain';
import { ERC20Mock } from '../types/typechain';
import { ERC20Mock__factory } from '../types/typechain';
import { StargateChainPath, StargateDeploymentOnchain, StargateDeployments, LayerZeroDeployments, StableCoinDeployments } from '../constants/types';
import { BigNumber } from 'ethers';
import exportData from '../constants';

export const deployStablecoins = async (owner: SignerWithAddress, stablecoins: Map<number, Array<string>>) => {
  let coinContracts : StableCoinDeployments = new Map<number, Map<string, ERC20>>([]);
  for (const chainId of stablecoins.keys()) {
    let contractsInChain = new Map<string, ERC20Mock>([]);
    for (const stablecoinname of stablecoins.get(chainId) || []) {
      const coinFactory = (await ethers.getContractFactory('ERC20Mock', owner)) as ERC20Mock__factory;
      const coin = await coinFactory.deploy(stablecoinname, stablecoinname, BigNumber.from("18"));
      await coin.deployed();
      console.log("Deployed coin: chainId, stablecoinname, address, totalSupply:", chainId, stablecoinname, coin.address, await coin.totalSupply());
      coin.connect(owner).mint(owner.address, exportData.localTestConstants.coinTotal); // 1000*1e18
      console.log("Minted coin to owner: chainId, owner, coin:", chainId, owner.address, await coin.balanceOf(owner.address));
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
    console.log("Deployed newStargateEndpoint: stargateDeployments size:", stargateDeployments.size);
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
        console.log("TestUtils.equalize: sendCredits: cp.dstChainId, poolId, cp.dstPoolId, owner.address:", cp.dstChainId, poolId, cp.dstPoolId.toNumber(), owner.address);
      }
    }
  }
}

export const bridgeStargateEndpoints = async (stargateDeployments: StargateDeployments) => {
  console.log("TestUtils.bridgeStargateEndpoints called");
  for (const srcChainId of stargateDeployments.keys()!) {
    for (const dstChainId of stargateDeployments.keys()!) {
      if (srcChainId === dstChainId) continue;
      const stargateSrc = stargateDeployments.get(srcChainId)!;
      const stargateDst = stargateDeployments.get(dstChainId)!;

      const remoteBridge = await stargateSrc.bridgeContract.bridgeLookup(dstChainId);
      if (remoteBridge === "0x") {
        // set it if its not set
        await stargateSrc.bridgeContract.setBridge(dstChainId, stargateDst.bridgeContract.address);
        console.log("TestUtils.bridgeStargateEndpoints: setBridge: ", srcChainId, dstChainId, stargateDst.bridgeContract.address);
      }

      const destLzEndpoint = await stargateSrc.lzEndpoint.lzEndpointLookup(stargateDst.bridgeContract.address);
      if (destLzEndpoint === "0x0000000000000000000000000000000000000000") {
        // set it if its not set
        await stargateSrc.lzEndpoint.setDestLzEndpoint(stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address);
        console.log("TestUtils.bridgeStargateEndpoints: setDestLzEndpoint: bridge, lzEndpoint:", stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address)
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
  console.log("TestUtils.newStargateEndpoint started: _chainId, stgMainchainId:", _chainId, stgMainChainId);

  // Deploy LzEndpoint
  const lzEndpointFactory = (await ethers.getContractFactory('LZEndpointMock', owner)) as LZEndpointMock__factory;
  const lzEndpoint = await lzEndpointFactory.deploy(_chainId);
  await lzEndpoint.deployed();
  console.log("Deployed LZEndpoint: chainId, address:", _chainId, lzEndpoint.address);
  stargateDeploymentOnchain.lzEndpoint = lzEndpoint;
  
  // Deploy Router
  const routerFactory = (await ethers.getContractFactory('Router', owner)) as Router__factory;
  const router = await routerFactory.deploy();
  await router.deployed();
  console.log("Deployed Router: chainId, address:", _chainId, router.address);
  stargateDeploymentOnchain.routerContract = router;

  // Deploy Bridge
  const bridgeFactory = (await ethers.getContractFactory('Bridge', owner)) as Bridge__factory;
  const bridge = await bridgeFactory.deploy(lzEndpoint.address, router.address);
  await bridge.deployed();
  console.log("Deployed Bridge: chainId, address:", _chainId, bridge.address);
  stargateDeploymentOnchain.bridgeContract = bridge;
  
  // Deploy Factory
  const factoryFactory = (await ethers.getContractFactory('Factory', owner)) as Factory__factory;
  const factory = await factoryFactory.deploy(router.address);
  await factory.deployed();
  console.log("Deployed Factory: chainId, address:", _chainId, factory.address);
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

  stargateDeployments.set(_chainId, stargateDeploymentOnchain);

  //bridge new stargate with each other
  await bridgeStargateEndpoints(stargateDeployments);
  
  return stargateDeploymentOnchain;
}