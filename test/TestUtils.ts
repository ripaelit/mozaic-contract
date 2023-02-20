import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import {Bridge, Bridge__factory, contracts, ERC20, ERC20__factory, Factory, Factory__factory, LPStaking, LPStaking__factory, Pool, Pool__factory, Router, Router__factory, StargateToken, StargateToken__factory, LZEndpointMock, LZEndpointMock__factory, MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, ILayerZeroEndpoint, MockDex__factory, PancakeSwapDriver__factory, MockToken, MockToken__factory, StargateDriver, StargateDriver__factory, PrimaryVault, StargateFeeLibraryV02__factory} from '../types/typechain';
import { StargateChainPath, StargateDeploymentOnchain, StargateDeployments, LayerZeroDeployments, StableCoinDeployments, MozaicDeployment, MozaicDeployments } from '../constants/types';
import { BigNumber } from 'ethers';
import exportData from '../constants';

export const deployStablecoin = async (
    owner: SignerWithAddress, 
    chainId: number,
    stablecoinDeployments: StableCoinDeployments
) => {
    let coinDeployment = new Map<string, string>([]);
    let coin;
    const coinFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
    const stablecoins = exportData.localTestConstants.stablecoins;
    for (const coinName of stablecoins.get(chainId) || []) {
        coin = await coinFactory.deploy(coinName, coinName, BigNumber.from("18"));
        await coin.deployed();
        console.log("Deployed coin: chainId %d, coinName %s, address %s", chainId, coinName, coin.address);
        coinDeployment.set(coinName, coin.address);
    }
    stablecoinDeployments.set(chainId, coinDeployment);
    return coinDeployment;
}

export const deployStargate = async (
    owner: SignerWithAddress,
    chainId: number,
    stablecoinDeployment: Map<string, string>,
    stargateChainPaths: Array<StargateChainPath>,
    stargateDeployments: Map<number, StargateDeploymentOnchain>
) => {
    let stargateDeploymentOnchain = {} as StargateDeploymentOnchain;

    // Deploy LzEndpoint
    const lzEndpointFactory = (await ethers.getContractFactory('LZEndpointMock', owner)) as LZEndpointMock__factory;
    const lzEndpoint = await lzEndpointFactory.deploy(chainId);
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
    const feeLibraryFactory = (await ethers.getContractFactory('StargateFeeLibraryV02', owner)) as StargateFeeLibraryV02__factory;
    const feeLibrary = await feeLibraryFactory.deploy(factory.address);
    await feeLibrary.deployed();

    // Setup
    await factory.setDefaultFeeLibrary(feeLibrary.address);

    // Link Bridge and Factory to Router  //set deploy params
    await router.setBridgeAndFactory(bridge.address, factory.address);

    // Create Pools For each stablecoin
    const poolFactory = (await ethers.getContractFactory('Pool', owner)) as Pool__factory;
    // const stablecoins = stablecoinDeployment.get(chainId)!;
    const pools = new Map<number, Pool>();
    const poolIds = exportData.localTestConstants.poolIds;
    for (const [coinname, coinAddress] of stablecoinDeployment) {
        await router.createPool(poolIds.get(coinname)!, coinAddress, 6, 18, coinname, coinname);
        const poolAddress = await factory.getPool(poolIds.get(coinname)!);
        const pool = poolFactory.attach(poolAddress);
        const poolId = poolIds.get(coinname)!;
        pools.set(poolId, pool);
    }
    stargateDeploymentOnchain.pools = pools;

    // Create and activate ChainPaths
    for (const chainPath of stargateChainPaths) {
        if (chainPath.sourceChainId != chainId) continue;
        await router.createChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId, chainPath.weight);
        await router.activateChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId);
    }

    // LPStaking and STG
    // Deploy Stargate Token
    const stgMainChainId = exportData.localTestConstants.stgMainChainId;
    const stargateTokenFactory = (await ethers.getContractFactory('StargateToken', owner)) as StargateToken__factory;
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
    const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
    const latestBlockNumber = await ethers.provider.getBlockNumber();
    const lpStaking = await lpStakingFactory.deploy(stargateToken.address, BigNumber.from("100000"), latestBlockNumber + 3, latestBlockNumber + 3);
    await lpStaking.deployed();
    // Register pools to LPStaking
    for (const [poolId, pool] of pools) {
        lpStaking.add(poolId, pool.address);
    }
    stargateDeploymentOnchain.lpStakingContract = lpStaking;
    //   console.log("Deployed LPStaking: chainId, address, totalAllocPoint:", _chainId, lpStaking.address, await lpStaking.totalAllocPoint());

    stargateDeployments.set(chainId, stargateDeploymentOnchain);

    //bridge new stargate with each other
    await bridgeStargateEndpoints(stargateDeployments);
    
    return stargateDeploymentOnchain;
}

export const deployMozaic = async (
    owner: SignerWithAddress,
    chainId: number,
    primaryChainId: number,
    lzEndpoint: string,
    stgRouter: string,
    stgLPStaking: string,
    stgToken: string,
    protocols: Map<number, Map<string,string>>,
    stablecoinDeployment: Map<string, string>,
    mozaicDeployments: Map<number, MozaicDeployment>,
) => {
    let vault, config;
    // Deploy MozaicLP
    const mozaicLpFactory = await ethers.getContractFactory('MozaicLP', owner) as MozaicLP__factory;
    // console.log("ETH(owner) before deploy MozaicLP", (await ethers.provider.getBalance(owner.address)).toString());
    const mozaicLp = await mozaicLpFactory.deploy("MozaicLP", "mLP", lzEndpoint);
    // console.log("ETH(owner) after deploy MozaicLP", (await ethers.provider.getBalance(owner.address)).toString());
    // console.log("Gas Price:", (await ethers.provider.getGasPrice()).toString());
    await mozaicLp.deployed();

    // Deploy Protocal Drivers
    // 1. Deploy PancakeSwapDriver
    const pancakeSwapDriverFactory = await ethers.getContractFactory('PancakeSwapDriver', owner) as PancakeSwapDriver__factory;
    const pancakeSwapDriver = await pancakeSwapDriverFactory.deploy();
    await pancakeSwapDriver.deployed();
    console.log("Deployed pancakeSwapDriver: chainId, address:", chainId, pancakeSwapDriver.address);
    // 2. Deploy StargateDriver
    const stargateDriverFactory = await ethers.getContractFactory('StargateDriver', owner) as StargateDriver__factory;
    const stargateDriver = await stargateDriverFactory.deploy();
    await stargateDriver.deployed();
    console.log("Deployed stargateDriver: chainId, address:", chainId, stargateDriver.address);

    // Deploy Vault
    if (chainId == primaryChainId) {
      // Deploy PrimaryVault
      const primaryVaultFactory = await ethers.getContractFactory('PrimaryVault', owner) as PrimaryVault__factory;
      const primaryVault = await primaryVaultFactory.deploy(lzEndpoint, chainId, primaryChainId, stgRouter, stgLPStaking, stgToken, mozaicLp.address);
      await primaryVault.deployed();
      console.log("Deployed PrimaryVault:", primaryVault.address);
      vault = primaryVault;
    }
    else {
      // Deploy SecondaryVault
      const secondaryVaultFactory = await ethers.getContractFactory('SecondaryVault', owner) as SecondaryVault__factory;
      const secondaryVault = await secondaryVaultFactory.deploy(lzEndpoint, chainId, primaryChainId, stgRouter, stgLPStaking, stgToken, mozaicLp.address);
      await secondaryVault.deployed();
      console.log("Deployed SecondaryVault:", secondaryVault.address);
      vault = secondaryVault;
    }
    // Set ProtocolDrivers to vault
    config = ethers.utils.defaultAbiCoder.encode(["address", "address"], [stgRouter, stgLPStaking]);
    await vault.setProtocolDriver(exportData.localTestConstants.stargateDriverId, stargateDriver.address, config);
    config = ethers.utils.defaultAbiCoder.encode(["address"], [protocols.get(chainId)!.get("PancakeSwapSmartRouter")!]);
    await vault.setProtocolDriver(exportData.localTestConstants.pancakeSwapDriverId, pancakeSwapDriver.address, config);
    console.log("Set protocolDrivers to vault");

    // Set Accepting Tokens
    for (const [_, token] of stablecoinDeployment) {
        await vault.addToken(token);
    }
    console.log("Set accepting tokens");

    let mozaicDeployment : MozaicDeployment = {
        mozaicLp: mozaicLp,
        mozaicVault: vault,
    }
    mozaicDeployments.set(chainId, mozaicDeployment);

    return mozaicDeployment;
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

      // TODO: change the following logic to be optional.
      // LzEndpointMock: setDestLzEndpoint
      const destLzEndpoint = await stargateSrc.lzEndpoint.lzEndpointLookup(stargateDst.bridgeContract.address);
      if (destLzEndpoint === "0x0000000000000000000000000000000000000000") {
        // set it if its not set
        await stargateSrc.lzEndpoint.setDestLzEndpoint(stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address);
        // console.log("TestUtils.bridgeStargateEndpoints: setDestLzEndpoint: bridge, lzEndpoint:", stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address)
      }
    }
  }
}

export const getLayerzeroDeploymentsFromStargateDeployments = (stargateDeployments: StargateDeployments) => {
  const lzDeploys = new Map<number, LZEndpointMock>();
  for (const [chainId, stgDeploy] of stargateDeployments) {
    lzDeploys.set(chainId, stgDeploy.lzEndpoint);
  }
  return lzDeploys;
}

export const lzEndpointMockSetDestEndpoints = async (lzDeploys: LayerZeroDeployments, mozaicDeployments: MozaicDeployments) => {
  for (const chainId of lzDeploys.keys()!) {
    for (const destChainId of lzDeploys.keys()!) {
      if (chainId == destChainId) continue;
      const lzEndpoint = lzDeploys.get(chainId)!;
      const destLzEndpoint = lzDeploys.get(destChainId)!;
      const mozaicLp = mozaicDeployments.get(destChainId)!.mozaicLp;
      const mozaicVault = mozaicDeployments.get(destChainId)!.mozaicVault;
      await lzEndpoint.setDestLzEndpoint(mozaicLp.address, destLzEndpoint.address);
      await lzEndpoint.setDestLzEndpoint(mozaicVault.address, destLzEndpoint.address);
    }
  }
}

export const deployNew = async (contractName: string, params = []) => {
    const contractFactory = await ethers.getContractFactory(contractName);
    const contract = await contractFactory.deploy(...params);
    await contract.deployed();
    return contract;
}