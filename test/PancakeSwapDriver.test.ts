import { expect } from 'chai';
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MockToken, PrimaryVault, MockDex__factory, SecondaryVault, ERC20, StargateToken } from '../types/typechain';
import { deployMozaic, deployStablecoin, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments, lzEndpointMockSetDestEndpoints } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployment, MozaicDeployments, ProtocolStatus, VaultStatus, StargateDeploymentOnchain, ActionTypeEnum } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';
describe('PancakeSwapDriver', () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let ben: SignerWithAddress;
    let chris: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;
    let mockDexs: Map<number, string>;
    let protocols: Map<number, Map<string, string>>;

    beforeEach(async () => {
        [owner, alice, ben, chris] = await ethers.getSigners();  // owner is control center
        
        stablecoinDeployments = new Map<number, Map<string, ERC20>>();
        stargateDeployments = new Map<number, StargateDeploymentOnchain>();
        mozaicDeployments = new Map<number, MozaicDeployment>();
        mockDexs = new Map<number, string>(); 
        protocols = new Map<number, Map<string, string>>();
        const primaryChainId = exportData.localTestConstants.chainIds[0];   // Ethereum
        const stargateChainPaths = exportData.localTestConstants.stargateChainPaths;

        // Deploy contracts
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
            mockDexs.set(chainId, mockDex.address);
            protocols.set(chainId, new Map<string,string>([["PancakeSwapSmartRouter", mockDex.address]]));

            // Deploy Mozaic
            let mozaicDeployment = await deployMozaic(owner, chainId, primaryChainId, stargateDeployment, protocols, stablecoinDeployment, mozaicDeployments);

        }

        // Register TrustedRemote
        for (const [chainIdLeft] of mozaicDeployments) {
            for (const [chainIdRight] of mozaicDeployments) {
            if (chainIdLeft == chainIdRight) continue;
                await mozaicDeployments.get(chainIdLeft)!.mozaicVault.connect(owner).setTrustedRemote(chainIdRight, mozaicDeployments.get(chainIdRight)!.mozaicVault.address);
                await mozaicDeployments.get(chainIdLeft)!.mozaicLp.connect(owner).setTrustedRemote(chainIdRight, mozaicDeployments.get(chainIdRight)!.mozaicLp.address);
            }
            // TODO: Transfer ownership of MozaicLP to Vault
            await mozaicDeployments.get(chainIdLeft)!.mozaicLp.connect(owner).transferOwnership(mozaicDeployments.get(chainIdLeft)!.mozaicVault.address);
        }
        console.log("Registerd TrustedRemote");

        // Register SecondaryVaults
        for (const [chainId] of mozaicDeployments) {
            if (chainId == primaryChainId) continue;
            await (mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault).setSecondaryVaults(
                chainId, 
                {
                    chainId,
                    vaultAddress: mozaicDeployments.get(chainId)!.mozaicVault.address,
                }
            );
        }
        console.log("Registerd SecondaryVaults");

        // LZEndpointMock setDestLzEndpoint
        await lzEndpointMockSetDestEndpoints(getLayerzeroDeploymentsFromStargateDeployments(stargateDeployments), mozaicDeployments);

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

        // Update the chain path balances
        await equalize(owner, stargateDeployments);
    });
    describe('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];// Ethereum
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
            const chainId = exportData.localTestConstants.chainIds[1];// Bsc
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgContract = stargateDeployments.get(chainId)!.stargateToken as StargateToken;
            const usdtContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1]) as MockToken;  // USDT in ETH
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgContract.address, usdtContract.address]);

            // Send STG to SecondaryVault
            console.log("Send STG to SecondaryVault");
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