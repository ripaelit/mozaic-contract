import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MockToken, StargateToken, SecondaryVault, MockDex, MockDex__factory } from '../types/typechain';
import { deployMozaic, deployStablecoins, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployments, ActionTypeEnum } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';

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
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcContract.address, usdtContract.address]);
            
            // Send USDC to SecondaryVault
            console.log("Send USDC to SecondaryVault");
            await usdcContract.connect(owner).approve(secondaryVault.address, amountLD);
            await usdcContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC, USDT:", (await usdcContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            
            // Swap USDC to USDT
            console.log("Swap USDC to USDT");
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

             // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has USDC, USDT:", (await usdcContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            expect(await usdtContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swap STG->USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgContract = stargateDeployments.get(chainId)!.stargateToken as StargateToken;
            const usdtContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1]) as MockToken;  // USDT in ETH
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgContract.address, usdtContract.address]);

            // Send STG to SecondaryVault
            console.log("Send USDC to SecondaryVault");
            await stgContract.connect(owner).approve(secondaryVault.address, amountLD);
            await stgContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has STG, USDT:", (await stgContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            
            // Swap STG to USDT
            console.log("Swap STG to USDT");
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

             // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has STG, USDT:", (await stgContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            expect(await usdtContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
    })
})