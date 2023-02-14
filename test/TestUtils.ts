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
      coin.connect(owner).mint(owner.address, exportData.localTestConstants.coinTotal); // 10 ** 9 (total supply) ** 18 (decimals)
      contractsInChain.set(stablecoinname, coin);
    }
    coinContracts.set(chainId, contractsInChain);
  }
  return coinContracts;
}

export const deployStargate = async (
  owner: SignerWithAddress, 
  stablecoinDeployments: StableCoinDeployments, 
  // layerzeroDeployments: LayerZeroDeployments, 
  poolIds: Map<string, number>, 
  stgMainChainId: number, 
  stargateChainPaths: Array<StargateChainPath>
  ) => {
  let stargateDeployments : StargateDeployments = new Map<number, StargateDeploymentOnchain>();
  // let lzEndpointMocks = new Map<number, LZEndpointMock>();
  for (const chainId of stablecoinDeployments.keys()!) {
    let stargateDeploymentOnchain = {} as StargateDeploymentOnchain;

    // Deploy LzEndpoint
    const lzEndpointFactory = (await ethers.getContractFactory('LZEndpointMock', owner)) as LZEndpointMock__factory;
    const lzEndpoint = await lzEndpointFactory.deploy(chainId);
    await lzEndpoint.deployed();
    stargateDeploymentOnchain.lzEndpoint = lzEndpoint;
    
    // Deploy Router
    const routerFactory = (await ethers.getContractFactory('Router', owner)) as Router__factory;
    const router = await routerFactory.deploy();
    await router.deployed();
    stargateDeploymentOnchain.routerContract = router;

    // Deploy Bridge
    const bridgeFactory = (await ethers.getContractFactory('Bridge', owner)) as Bridge__factory;
    const bridge = await bridgeFactory.deploy(lzEndpoint.address, router.address);
    await bridge.deployed();
    stargateDeploymentOnchain.bridgeContract = bridge;
    
    // Deploy Factory
    const factoryFactory = (await ethers.getContractFactory('Factory', owner)) as Factory__factory;
    const factory = await factoryFactory.deploy(router.address);
    await factory.deployed();
    stargateDeploymentOnchain.factoryContract = factory;

    // Deploy FeeLibrary

    // Link Bridge and Factory to Router  //set deploy params
    await router.setBridgeAndFactory(bridge.address, factory.address);
    
    // Create Pools For each stablecoin
    const poolFactory = (await ethers.getContractFactory('Pool', owner)) as Pool__factory;
    const stablecoins = stablecoinDeployments.get(chainId)!;
    const pools = new Map<number, Pool>();
    for (const [coinname, coincontract] of stablecoins) {
      await router.createPool(poolIds.get(coinname)!, coincontract.address, 6, 18, coinname, coinname);
      const poolAddress = await factory.getPool(poolIds.get(coinname)!);
      const pool = poolFactory.attach(poolAddress);
      const poolId = poolIds.get(coinname)!;
      pools.set(poolId, pool);
    }
    stargateDeploymentOnchain.pools = pools;

    // Deploy Stargate Token
    const stargateTokenFactory = (await ethers.getContractFactory('StargateToken', owner)) as StargateToken__factory;
    const stargateToken = await stargateTokenFactory.deploy(
      'Stargate Token', 
      'STG', 
      lzEndpoint.address, 
      stgMainChainId, 
      exportData.localTestConstants.STGs // 10**9 (total supply) 10** 18 (decimals)
    );
    await stargateToken.deployed();
    stargateDeploymentOnchain.stargateToken = stargateToken;

    // Deploy LPStaking contract
    const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
    const latestBlockNumber = await ethers.provider.getBlockNumber();
    const lpStaking = await lpStakingFactory.deploy(stargateToken.address, BigNumber.from("1000000"), latestBlockNumber + 3, latestBlockNumber + 3);
    await lpStaking.deployed();
    
    // Add Stargate Liquidity Pools
    for (const [poolId, pool] of pools) {
      await lpStaking.add(BigNumber.from("10000"), pool.address);
    }
    stargateDeploymentOnchain.lpStakingContract = lpStaking;

    // Create and activate ChainPaths
    for (const chainPath of stargateChainPaths) {
      if (chainPath.sourceChainId != chainId) continue;
      await router.createChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId, chainPath.weight);
      await router.activateChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId);
    }

    stargateDeployments.set(chainId, stargateDeploymentOnchain);

    //bridge new stargate with each other
    await bridgeStargateEndpoints(stargateDeployments);
  }

  return stargateDeployments;
}

export const equalize = async (owner: SignerWithAddress, stargateDeployments: StargateDeployments) => {
  for (const chainId of stargateDeployments.keys()!) {
    for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
      const chainPathsLength = await pool.getChainPathsLength();
      for (let i = 0; i < chainPathsLength.toNumber(); i++) {
        let cp = await pool.chainPaths(i);
        await stargateDeployments.get(chainId)!.routerContract.sendCredits(cp.dstChainId, poolId, cp.dstPoolId, owner.address)
      }
    }
  }
}

async function bridgeStargateEndpoints(stargateDeployments: StargateDeployments) {
  for (const srcChainId of stargateDeployments.keys()!) {
    for (const dstChainId of stargateDeployments.keys()!) {
      if (srcChainId === dstChainId) continue;
      const stargateSrc = stargateDeployments.get(srcChainId)!;
      const stargateDst = stargateDeployments.get(dstChainId)!;

      const remoteBridge = await stargateSrc.bridgeContract.bridgeLookup(dstChainId);
      if (remoteBridge === "0x") {
        // set it if its not set
        console.log("TestUtils.bridgeStargateEndpoints: schChainId, srcBridge, dstChainId, dstBridge", srcChainId, stargateSrc.bridgeContract.address, dstChainId, stargateDst.bridgeContract.address);
        await stargateSrc.bridgeContract.setBridge(dstChainId, stargateDst.bridgeContract.address);
      }

      const destLzEndpoint = await stargateSrc.lzEndpoint.lzEndpointLookup(stargateDst.bridgeContract.address);
      if (destLzEndpoint === "0x0000000000000000000000000000000000000000") {
        // set it if its not set
        await stargateSrc.lzEndpoint.setDestLzEndpoint(stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address);
      }
    }
  }
}
