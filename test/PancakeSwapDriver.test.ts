import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20__factory, ERC20, MockToken, StargateToken, PancakeSwapDriver, PancakeSwapDriver__factory, SecondaryVault, MockDex, MockDex__factory } from '../types/typechain';
import { deployMozaic, deployStablecoins, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployments, ActionTypeEnum } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';
import { stargate } from '../types/typechain/contracts/libraries';
import { mozaic } from '../types/typechain/contracts';

describe('PancakeSwapDriver', () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;

    beforeEach(async () => {
        [owner, alice] = await ethers.getSigners();  // owner is control center
        // Deploy Stablecoins
        stablecoinDeployments = await deployStablecoins(owner, exportData.localTestConstants.stablecoins);
        console.log("Deployed stablecoins");
        
        // Deploy Stargate
        stargateDeployments = await deployStargate(owner, stablecoinDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChain, exportData.localTestConstants.stargateChainPaths);
        console.log("Deployed stargates");
        // Deploy MockDex and create protocols
        let mockDexs = new Map<number, string>(); 
        let protocols = new Map<number, Map<string, string>>();
        for (const chainId of exportData.localTestConstants.chainIds) {
            const mockDexFactory = await ethers.getContractFactory('MockDex', owner) as MockDex__factory;
            const mockDex = await mockDexFactory.deploy(chainId);
            await mockDex.deployed();
            mockDexs.set(chainId, mockDex.address);
            protocols.set(chainId, new Map<string,string>([["PancakeSwapSmartRouter", mockDex.address]]));
        }
        console.log("Deployed mockDexs");
        // Deploy Mozaic
        mozaicDeployments = await deployMozaic(owner, exportData.localTestConstants.mozaicPrimaryChain, stargateDeployments, getLayerzeroDeploymentsFromStargateDeployments(stargateDeployments), protocols);
        console.log("Deployed mozaics");
        // Set deltaparam
        for (const chainId of stargateDeployments.keys()!) {
            for (const [poolId, pool] of stargateDeployments.get(chainId)!.pools) {
                let router = stargateDeployments.get(chainId)!.routerContract;
                await router.setFees(poolId, 2);
                await router.setDeltaParam(
                    poolId,
                    true,
                    500, // 5%
                    500, // 5%
                    true, //default
                    true //default
                );
            }
        }
        console.log("Set deltaparam");
        // update the chain path balances
        await equalize(owner, stargateDeployments);
        console.log("Equalized");
        
    });
    describe('PancakeSwapDriver.execute', () => {
        it.only ("can swap USDC->USDT", async () => {
            const chainId = exportData.localTestConstants.chainIds[1];// Bsc
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const usdcContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0]) as MockToken;  // USDC in ETH
            const usdtContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1]) as MockToken;  // USDT in ETH
            //kevin
            const pancakeSwapDriverAddr = await mozaicDeployments.get(chainId)!.mozaicVault.protocolDrivers(1);
            const pancakeSwapDriverFactory = await ethers.getContractFactory('PancakeSwapDriver', owner) as PancakeSwapDriver__factory;
            let pancakeSwapDriver = pancakeSwapDriverFactory.attach(pancakeSwapDriverAddr);
            let protocol = await pancakeSwapDriver.connect(owner).protocol();
            console.log("pancakeSwapDriverAddr, Protocol:", pancakeSwapDriverAddr, protocol);
            //
            const amountLD = BigNumber.from("1234567890");
            
            // console.log("8");
            // const actionType = ActionTypeEnum.Swap;

            // Mint USDC to deployer
            // console.log("Mint USDC to owner:");
            // await usdcContract.connect(owner).mint(owner.address, amountLD);
            // console.log("Owner has USDC, USDT:", (await usdcContract.balanceOf(owner.address)), (await usdtContract.balanceOf(owner.address)));
            
            // Swap USDC to USDT
            console.log("Owner had USDC, USDT:", (await usdcContract.balanceOf(owner.address)), (await usdtContract.balanceOf(owner.address)));
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcContract.address, usdtContract.address]);
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

            console.log("pancakeSwapDriverAddr, Protocol:", pancakeSwapDriverAddr, protocol);
            
            // await pancakeSwapDriver.connect(owner).execute(actionType, payload);

             // Check USDT amount of deployer
            console.log("Now owner has USDC, USDT:", (await usdcContract.balanceOf(owner.address)), (await usdtContract.balanceOf(owner.address)));
            expect(await usdtContract.balanceOf(owner.address)).gt(BigNumber.from("0"));
        })
        it ("can swap STG->USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];
            const stgContract = stargateDeployments.get(chainId)!.stargateToken as StargateToken;
            const usdtContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1]) as MockToken;  // USDT in ETH
            const pancakeSwapDriverAddr = await mozaicDeployments.get(chainId)!.mozaicVault.protocolDrivers(0);;
            const pancakeSwapDriverFactory = await ethers.getContractFactory('PancakeSwapDriver', owner) as PancakeSwapDriver__factory;
            const pancakeSwapDriver = pancakeSwapDriverFactory.attach(pancakeSwapDriverAddr);
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgContract.address, usdtContract.address]);
            const actionType = ActionTypeEnum.Swap;

            // Transfer STG to deployer
            console.log("Transfer STG to deployer:");
            stgContract.connect(owner).approve(owner.address, amountLD);
            await stgContract.connect(owner).transfer(owner.address, amountLD);
            console.log("Owner has STG, USDT:", (await stgContract.balanceOf(owner.address)), (await usdtContract.balanceOf(owner.address)));

            expect(await pancakeSwapDriver.connect(owner).execute(actionType, payload)).gt(0);
        })
    })
})