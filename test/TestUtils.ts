import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {Bridge, Bridge__factory, contracts, ERC20, ERC20__factory, Factory, Factory__factory, LPStaking, LPStaking__factory, Pool, Pool__factory, Router, Router__factory, StargateToken, StargateToken__factory, LZEndpointMock, LZEndpointMock__factory } from '../types/typechain';
// import { LZEndpointMock, LZEndpointMock__factory } from '../types/typechain';
import { ERC20Mock } from '../types/typechain/contracts/mocks';
import { ERC20Mock__factory } from '../types/typechain/factories/contracts/mocks';
// import consts from '../constants';
import { ChainPath, StargateDeploymentOnchain, StargateDeployments, LayerZeroDeployments, StableCoinDeployments } from '../constants/types';
import { BigNumber } from 'ethers';


export const deployStablecoins = async (owner: SignerWithAddress, stablecoins: Map<number, Array<string>>) => {
  let coinContracts : StableCoinDeployments = new Map<number, Map<string, ERC20>>([]);
  for (const chainId of stablecoins.keys()) {
    let contractsInChain = new Map<string, ERC20Mock>([]);
    for (const stablecoinname of stablecoins.get(chainId) || []) {
      const coinFactory = (await ethers.getContractFactory('ERC20Mock', owner)) as ERC20Mock__factory;
      const coin = await coinFactory.deploy(stablecoinname, stablecoinname, BigNumber.from("18"));
      await coin.deployed();
      coin.connect(owner).mint(owner.address, BigNumber.from("1000000000000000000000000000")); // 10 ** 9 (total supply) ** 18 (decimals)
      contractsInChain.set(stablecoinname, coin);
    }
    coinContracts.set(chainId, contractsInChain);
  }
  return coinContracts;
}

export const deployLzEndpoints = async (owner: SignerWithAddress, chainIds: number[]) => {
  let lzEndpointMocks = new Map<number, LZEndpointMock>();
  for (const chainId of chainIds) {
    const lzEndpointMockFactory = (await ethers.getContractFactory('LZEndpointMock', owner)) as LZEndpointMock__factory;
    const lzEndpointMock = await lzEndpointMockFactory.deploy(chainId);
    await lzEndpointMock.deployed();
    lzEndpointMocks.set(chainId, lzEndpointMock);
  }
  return lzEndpointMocks;
}

export const deployStargate = async (owner: SignerWithAddress, stablecoinDeployments: StableCoinDeployments, layerzeroDeployments: LayerZeroDeployments, poolIds: Map<string, number>, stgMainChainId: number, stargateChainPaths: Array<ChainPath>) => {
  let stargateDeployments : StargateDeployments = new Map<number, StargateDeploymentOnchain>();
  let lzEndpointMocks = new Map<number, LZEndpointMock>();
  for (const chainId of stablecoinDeployments.keys()!) {
    let stargateDeploymentOnchain = {} as StargateDeploymentOnchain;
    
    // Deploy Router
    const routerFactory = (await ethers.getContractFactory('Router', owner)) as Router__factory;
    const router = await routerFactory.deploy();
    await router.deployed();
    stargateDeploymentOnchain.routerContract = router;

    // Deploy Factory
    const factoryFactory = (await ethers.getContractFactory('Factory', owner)) as Factory__factory;
    const factory = await factoryFactory.deploy(router.address);
    await factory.deployed();
    stargateDeploymentOnchain.factoryContract = factory;
    
    // Deploy Bridge
    const bridgeFactory = (await ethers.getContractFactory('Bridge', owner)) as Bridge__factory;
    const bridge = await bridgeFactory.deploy(layerzeroDeployments.get(chainId)!.address, router.address);
    await bridge.deployed();
    stargateDeploymentOnchain.bridgeContract = bridge;

    // Link Bridge and Factory to Router
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

    // Create ChainPaths
    for (const chainPath of stargateChainPaths) {
      if (chainPath.sourceChainId != chainId) continue;
      await router.createChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId, chainPath.weight);
    }

    // Deploy Stargate Token
    const stargateTokenFactory = (await ethers.getContractFactory('StargateToken', owner)) as StargateToken__factory;
    const stargateToken = await stargateTokenFactory.deploy(
      'Stargate Token', 
      'STG', 
      layerzeroDeployments.get(chainId)!.address, 
      stgMainChainId, 
      BigNumber.from("1000000000000000000000000000") // 10 ** 9 (total supply) ** 18 (decimals)
    );
    await stargateToken.deployed();
    stargateDeploymentOnchain.stargateToken = stargateToken;

    // Deploy LPStaking contract
    const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
    const latestBlockNumber = await ethers.provider.getBlockNumber();
    const lpStaking = await lpStakingFactory.deploy(stargateToken.address, BigNumber.from("1000000"), latestBlockNumber + 3, latestBlockNumber + 3); // 
    await lpStaking.deployed();
    stargateDeploymentOnchain.lpStakingContract = lpStaking;
    stargateDeployments.set(chainId, stargateDeploymentOnchain);
  }

  return stargateDeployments;
}