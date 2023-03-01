import {ethers} from 'hardhat';
import {SignerWithAddress} from '@nomiclabs/hardhat-ethers/signers';
import { Bridge__factory, Factory__factory, LPStaking__factory, Pool, Pool__factory, Router__factory, StargateToken__factory, LZEndpointMock, LZEndpointMock__factory, MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, MockDex__factory, PancakeSwapDriver__factory, MockToken__factory, StargateDriver__factory, PrimaryVault, StargateFeeLibraryV02__factory} from '../../types/typechain';
import { StargateChainPath, StargateDeploymentOnchain, StargateDeployments, LayerZeroDeployments, StableCoinDeployments, MozaicDeployment, MozaicDeployments } from '../constants/types';
import { BigNumber } from 'ethers';
import exportData from '../constants';
const hre = require('hardhat');

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
    //   console.log("Deployed Router: chainId, address:", chainId, router.address);
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
    const pools = new Map<number, Pool>();
    const poolIds = exportData.localTestConstants.poolIds;
    for (const [coinname, coinAddress] of stablecoinDeployment) {
        await router.connect(owner).createPool(poolIds.get(coinname)!, coinAddress, 6, 18, coinname, coinname);
        const poolAddress = await factory.getPool(poolIds.get(coinname)!);
        const pool = poolFactory.attach(poolAddress);
        const poolId = poolIds.get(coinname)!;
        pools.set(poolId, pool);
    }
    stargateDeploymentOnchain.pools = pools;

    // Create and activate ChainPaths
    for (const chainPath of stargateChainPaths) {
        if (chainPath.sourceChainId != chainId) continue;
        await router.connect(owner).createChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId, chainPath.weight);
        await router.connect(owner).activateChainPath(chainPath.sourcePoolId, chainPath.destinationChainId, chainPath.destinationPoolId);
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
        BigNumber.from("4000000000000000000000000") // 4e24   minted to owner
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
        await lpStaking.connect(owner).add(poolId, pool.address);
    }
    stargateDeploymentOnchain.lpStakingContract = lpStaking;
    //   console.log("Deployed LPStaking: chainId, address, totalAllocPoint:", _chainId, lpStaking.address, await lpStaking.totalAllocPoint());

    stargateDeployments.set(chainId, stargateDeploymentOnchain);

    //bridge new stargate with each other
    await bridgeStargateEndpoints(owner, stargateDeployments);
    
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
    stablecoin: Map<string, string>,
) => {
    let vault, config;
    // Deploy MozaicLP
    const mozaicLpFactory = await ethers.getContractFactory('MozaicLP', owner) as MozaicLP__factory;
    // console.log("ETH(owner) before deploy MozaicLP", (await ethers.provider.getBalance(owner.address)).toString());
    const mozaicLp = await mozaicLpFactory.deploy("MozaicLP", "mLP", lzEndpoint);
    // console.log("ETH(owner) after deploy MozaicLP", (await ethers.provider.getBalance(owner.address)).toString());
    // console.log("Gas Price:", (await ethers.provider.getGasPrice()).toString());
    await mozaicLp.deployed();
    console.log("Deployed MozaicLP", mozaicLp.address);

    // Deploy Protocal Drivers
    // 1. Deploy PancakeSwapDriver
    const pancakeSwapDriverFactory = await ethers.getContractFactory('PancakeSwapDriver', owner) as PancakeSwapDriver__factory;
    const pancakeSwapDriver = await pancakeSwapDriverFactory.deploy();
    await pancakeSwapDriver.deployed();
    console.log("Deployed pancakeSwapDriver", pancakeSwapDriver.address);
    // 2. Deploy StargateDriver
    const stargateDriverFactory = await ethers.getContractFactory('StargateDriver', owner) as StargateDriver__factory;
    const stargateDriver = await stargateDriverFactory.deploy();
    await stargateDriver.deployed();
    console.log("Deployed stargateDriver", stargateDriver.address);

    // Deploy Vault
    if (chainId == primaryChainId) {
      // Deploy PrimaryVault
      const primaryVaultFactory = await ethers.getContractFactory('PrimaryVault', owner) as PrimaryVault__factory;
      const primaryVault = await primaryVaultFactory.deploy(lzEndpoint, chainId, primaryChainId, stgLPStaking, stgToken, mozaicLp.address);
      await primaryVault.deployed();
      console.log("Deployed PrimaryVault:", primaryVault.address);
      vault = primaryVault;
    }
    else {
      // Deploy SecondaryVault
      const secondaryVaultFactory = await ethers.getContractFactory('SecondaryVault', owner) as SecondaryVault__factory;
      const secondaryVault = await secondaryVaultFactory.deploy(lzEndpoint, chainId, primaryChainId, stgLPStaking, stgToken, mozaicLp.address);
      await secondaryVault.deployed();
      console.log("Deployed SecondaryVault:", secondaryVault.address);
      vault = secondaryVault;
    }
    // Set ProtocolDrivers to vault
    config = ethers.utils.defaultAbiCoder.encode(["address", "address"], [stgRouter, stgLPStaking]);
    await vault.connect(owner).setProtocolDriver(exportData.localTestConstants.stargateDriverId, stargateDriver.address, config);
    config = ethers.utils.defaultAbiCoder.encode(["address"], [protocols.get(chainId)!.get("PancakeSwapSmartRouter")!]);
    await vault.connect(owner).setProtocolDriver(exportData.localTestConstants.pancakeSwapDriverId, pancakeSwapDriver.address, config);
    // console.log("Set protocolDrivers to vault");

    // Set vault to MLP
    mozaicLp.connect(owner).setVault(vault.address);

    // Set Accepting Tokens
    for (const [_, token] of stablecoin) {
        await vault.connect(owner).addToken(token);
    }
    // console.log("Set accepting tokens");

    let mozaicDeployment : MozaicDeployment = {
        mozaicLp: mozaicLp,
        mozaicVault: vault,
    }

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

export const bridgeStargateEndpoints = async (owner: SignerWithAddress, stargateDeployments: StargateDeployments) => {
  for (const srcChainId of stargateDeployments.keys()!) {
    for (const dstChainId of stargateDeployments.keys()!) {
      if (srcChainId === dstChainId) continue;
      const stargateSrc = stargateDeployments.get(srcChainId)!;
      const stargateDst = stargateDeployments.get(dstChainId)!;

      const remoteBridge = await stargateSrc.bridgeContract.bridgeLookup(dstChainId);
      if (remoteBridge === "0x") {
        // set it if its not set
        await stargateSrc.bridgeContract.connect(owner).setBridge(dstChainId, stargateDst.bridgeContract.address);
      }

      // TODO: change the following logic to be optional.
      // LzEndpointMock: setDestLzEndpoint
      const destLzEndpoint = await stargateSrc.lzEndpoint.lzEndpointLookup(stargateDst.bridgeContract.address);
      if (destLzEndpoint === "0x0000000000000000000000000000000000000000") {
        // set it if its not set
        await stargateSrc.lzEndpoint.setDestLzEndpoint(stargateDst.bridgeContract.address, stargateDst.lzEndpoint.address);
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

export const deployAllToTestNet = async (
    owner: SignerWithAddress, 
    chainId: number,
) => {
    let protocols = new Map<number, Map<string, string>>();
    
    // Get router contract
    const routerFactory = (await ethers.getContractFactory('Router', owner)) as Router__factory;
    const router = routerFactory.attach(exportData.testnetTestConstants.routers.get(chainId)!);
    
    // Get bridge contract
    const bridgeFactory = (await ethers.getContractFactory('Bridge', owner)) as Bridge__factory;
    const bridge = bridgeFactory.attach(exportData.testnetTestConstants.bridges.get(chainId)!);

    // Get factory contract
    const factoryFactory = (await ethers.getContractFactory('Factory', owner)) as Factory__factory;
    const factory = factoryFactory.attach(exportData.testnetTestConstants.factories.get(chainId)!);

    // Get LzEndpoint contract
    const lzEndpoint = await bridge.layerZeroEndpoint();
    console.log("LZEndpoint", lzEndpoint);

    // Deploy Stargate Token
    const stgMainChainId = exportData.testnetTestConstants.stgMainChainId;
    const stargateTokenFactory = (await ethers.getContractFactory('StargateToken', owner)) as StargateToken__factory;
    const stargateToken = await stargateTokenFactory.deploy(
        'Stargate Token', 
        'STG', 
        lzEndpoint, 
        stgMainChainId, 
        BigNumber.from("90000000000000000000000") // 9e22
    );
    console.log("stargateToken");
    await stargateToken.deployed();
    console.log("Deployed StargateToken", stargateToken.address);
    
    // Deploy LPStaking
    const latestBlockNumber = await ethers.provider.getBlockNumber();
    const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
    const lpStaking = await lpStakingFactory.deploy(
        stargateToken.address, 
        BigNumber.from("100000"), 
        latestBlockNumber + 3, 
        latestBlockNumber + 3
    );
    await lpStaking.deployed();
    console.log("Deployed LPStaking", lpStaking.address);

    // Register pools to LPStaking
    const stablecoins = exportData.testnetTestConstants.stablecoins;
    const poolIds = exportData.testnetTestConstants.poolIds;
    const coins = stablecoins.get(chainId)!;
    for (const [coinName] of coins) {
        let poolId = poolIds.get(coinName)!;
        let poolAddr = await factory.getPool(poolId);
        await lpStaking.connect(owner).add(poolId, poolAddr);
        console.log("pool added to lpStaking: poolId %d, pool %s", poolId, poolAddr);
    }
    
    // Deploy MockDex and create protocol with it
    const mockDexFactory = await ethers.getContractFactory('MockDex', owner) as MockDex__factory;
    const mockDex = await mockDexFactory.deploy();
    await mockDex.deployed();
    console.log("Deployed MockDex", mockDex.address);
    protocols.set(chainId, new Map<string,string>([
        ["PancakeSwapSmartRouter", mockDex.address],
    ]));

    // Deploy Mozaic        
    const primaryChainId = exportData.testnetTestConstants.mozaicMainChainId;
    const stablecoin = exportData.testnetTestConstants.stablecoins.get(chainId)!;
    const mozaicDeployment = await deployMozaic(owner, chainId, primaryChainId, lzEndpoint, router.address, lpStaking.address, stargateToken.address, protocols, stablecoin);
    return mozaicDeployment;
    // initMozaics(owner, primaryChainId, mozaicDeployments);
}

export const deployAllToLocalNets = async (
    owner: SignerWithAddress, 
    primaryChainId: number,
    stablecoinDeployments: Map<number, Map<string, string>>,
    stargateDeployments: Map<number, StargateDeploymentOnchain>,
    mozaicDeployments: Map<number, MozaicDeployment>
) => {
    const stargateChainPaths = exportData.localTestConstants.stargateChainPaths;
    let protocols = new Map<number, Map<string, string>>();

    for (const chainId of exportData.localTestConstants.chainIds) {
        // Deploy stable coins
        let stablecoinDeployment = await deployStablecoin(owner, chainId, stablecoinDeployments);

        // Deploy Stargate
        let stargateDeployment = await deployStargate(owner, chainId, stablecoinDeployment, stargateChainPaths, stargateDeployments);
        
        // Deploy MockDex and create protocol with it
        let mockDexFactory = await ethers.getContractFactory('MockDex', owner) as MockDex__factory;
        let mockDex = await mockDexFactory.deploy();
        await mockDex.deployed();
        console.log("Deployed MockDex: chainid, mockDex:", chainId, mockDex.address);
        protocols.set(chainId, new Map<string,string>([["PancakeSwapSmartRouter", mockDex.address]]));

        // Deploy Mozaic
        let mozaicDeployment = await deployMozaic(owner, chainId, primaryChainId, stargateDeployment.lzEndpoint.address, stargateDeployment.routerContract.address, stargateDeployment.lpStakingContract.address, stargateDeployment.stargateToken.address, protocols, stablecoinDeployment);
        mozaicDeployments.set(chainId, mozaicDeployment);
    }

    initMozaics(primaryChainId, mozaicDeployments);

    // LZEndpointMock setDestLzEndpoint
    await lzEndpointMockSetDestEndpoints(getLayerzeroDeploymentsFromStargateDeployments(stargateDeployments), mozaicDeployments);

    // Set deltaparam
    for (const chainId of stargateDeployments.keys()!) {
        for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
            let router = stargateDeployments.get(chainId)!.routerContract;
            await router.connect(owner).setFees(poolId, 2);
            await router.connect(owner).setDeltaParam(
                poolId,
                true,
                500, // 5%
                500, // 5%
                true, //default
                true //default
            );
        }
    }

    // Update the chain path balances
    await equalize(owner, stargateDeployments);
}

// After deployed all vaults, register trustedRemote and secondaryVaults
export const initMozaics = async (
    primaryChainId: number,
    mozaicDeployments: Map<number, MozaicDeployment>, 
) => {
    let owner: SignerWithAddress;

    // Register TrustedRemote
    for (const [chainIdLeft] of mozaicDeployments) {
        // run the following code on the relevent network of chainIdLeft.
        // chainIdLeft : LayerZero chain id ---> global chain id
        const globalChainId = globalChainIdFromLzChainId(chainIdLeft);
        if (globalChainId) {
            // global chain id --> network name (by using hre.config.networks)
            const networkName = networkNameFromGlobalChainId(globalChainId);
            // switch to use the provider of the network
            hre.changeNetwork(networkName);
        }
        [owner] = await ethers.getSigners();
        for (const [chainIdRight] of mozaicDeployments) {
            if (chainIdLeft == chainIdRight) continue;
            console.log("left chain %d, left vault %s, right chain %d, right vault %s", chainIdLeft, mozaicDeployments.get(chainIdLeft)!.mozaicVault.address, chainIdRight, mozaicDeployments.get(chainIdRight)!.mozaicVault.address);
            let tx = await mozaicDeployments.get(chainIdLeft)!.mozaicVault.connect(owner).setTrustedRemote(chainIdRight, mozaicDeployments.get(chainIdRight)!.mozaicVault.address);
            await tx.wait();
            console.log("tx hash", tx.hash);
            console.log("left chain %d, left mLp %s, right chain %d, right mLp %s", chainIdLeft, mozaicDeployments.get(chainIdLeft)!.mozaicLp.address, chainIdRight, mozaicDeployments.get(chainIdRight)!.mozaicLp.address);
            let tx1 = await mozaicDeployments.get(chainIdLeft)!.mozaicLp.connect(owner).setTrustedRemote(chainIdRight, mozaicDeployments.get(chainIdRight)!.mozaicLp.address);
            await tx1.wait();
            console.log("tx1 hash", tx1.hash);
        }
    }
    console.log("Registerd TrustedRemote");

    // Register SecondaryVaults
    const globalChainId = globalChainIdFromLzChainId(primaryChainId);
    if (globalChainId) {
        const networkName = networkNameFromGlobalChainId(globalChainId);
        hre.changeNetwork(networkName);
    }
    [owner] = await ethers.getSigners();
    const primaryValut = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
    for (const [chainId, mozaicDeployment] of mozaicDeployments) {
        if (chainId == primaryChainId) continue;
        let tx = await primaryValut.connect(owner).setSecondaryVaults(
            chainId, 
            {
                chainId,
                vaultAddress: mozaicDeployment.mozaicVault.address,
            }
        );
        await tx.wait();
    }
    console.log("Registerd SecondaryVaults");
}

export const globalChainIdFromLzChainId = (lzChainId: number) => {
    let chainId = exportData.testnetTestConstants.lzToGlobalChainIds.get(lzChainId)!;
    return chainId;
}

export const networkNameFromGlobalChainId = (globalChainId: number) => {
    let networkName = "";
    const networks = hre.config.networks;
    for (const network in networks) {
        if (networks[network].chainId == globalChainId) {
            networkName = network;
        }
    }
    return networkName;
}