import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MockToken, SecondaryVault, MockDex__factory, MockContract, MockContract__factory } from '../types/typechain';
import { deployMozaic, deployStablecoins, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments, lzEndpointMockSetDestEndpoints } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployments, ActionTypeEnum } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';

describe('StargateDriver', () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;
    // let mockContractDeployments: Map<number, MockContract>;

    beforeEach(async () => {
        [owner, alice] = await ethers.getSigners();  // owner is control center

        // Deploy Stablecoins
        stablecoinDeployments = await deployStablecoins(owner, exportData.localTestConstants.stablecoins);
        
        // Deploy Stargate
        stargateDeployments = await deployStargate(owner, stablecoinDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChainId, exportData.localTestConstants.stargateChainPaths);

        // Deploy MockDex and create protocols
        let mockDexs = new Map<number, string>(); 
        let protocols = new Map<number, Map<string, string>>();
        for (const chainId of exportData.localTestConstants.chainIds) {
            const mockDexFactory = await ethers.getContractFactory('MockDex', owner) as MockDex__factory;
            const mockDex = await mockDexFactory.deploy();
            await mockDex.deployed();
            // console.log("Deployed MockDex: chainid, mockDex:", chainId, mockDex.address);
            mockDexs.set(chainId, mockDex.address);
            protocols.set(chainId, new Map<string,string>([["PancakeSwapSmartRouter", mockDex.address]]));
        }
        // console.log("Deployed mockDexs");

        // Deploy Mozaic
        mozaicDeployments = await deployMozaic(owner, exportData.localTestConstants.mozaicPrimaryChainId, stargateDeployments, getLayerzeroDeploymentsFromStargateDeployments(stargateDeployments), protocols, stablecoinDeployments);
        console.log("Deployed mozaics");
        
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
    describe('StargateDriver.execute', () => {
        it ("can stake USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];  // Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const usdcContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0]) as MockToken;  // USDC in ETH
            const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
            console.log("LPStaking is on %s", lpStaking.address);
            const pool = stargateDeployments.get(chainId)!.pools.get(1)!;   // USDC PoolId = 1
            lpStaking.add(1, pool.address); // Only for local test, manually add. For testnet, it doesn't need.
            const amountLD = BigNumber.from("123456789012345");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcContract.address]);

            // Send USDC to SecondaryVault
            console.log("Send USDC to SecondaryVault");
            await usdcContract.connect(owner).approve(secondaryVault.address, amountLD);
            await usdcContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            console.log("SecondaryVault stake USDC");
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);

            // Check LpTokens for owner in LpStaking
            console.log("Check LpTokens for owner in LpStaking");
            const lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for owner in LpStaking is", lpStaked);
            expect(lpStaked).gt(BigNumber.from("0"));
        })
        it ("can unstake USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];  // Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const usdcContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0]) as MockToken;  // USDC in ETH
            const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
            console.log("LPStaking is on %s", lpStaking.address);
            const pool = stargateDeployments.get(chainId)!.pools.get(1)!;   // USDC PoolId = 1
            const amountLD = BigNumber.from("123456789012345");

            // Stake
            // Send USDC of amountLD to SecondaryVault
            console.log("Send USDC to SecondaryVault");
            await usdcContract.connect(owner).approve(secondaryVault.address, amountLD);
            await usdcContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC of amountLD
            console.log("SecondaryVault stake USDC");
            const payloadStake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcContract.address]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payloadStake
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);

            // Check LpTokens for owner in LpStaking
            console.log("Check LpTokens for owner in LpStaking");
            const amountLPToken = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for owner in LpStaking is", amountLPToken);
            expect(amountLPToken).gt(BigNumber.from("0"));

            // Unstake
            // SecondaryVault unstake LPToken
            console.log("SecondaryVault unstake LPToken");
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLPToken, usdcContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };
            await secondaryVault.connect(owner).executeActions([unstakeAction]);

            // Check USDC in secondaryVault
            console.log("Check USDC in secondaryVault");
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            expect(await usdcContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it.only ("can swapRemote", async () => {
            const primaryChainId = exportData.localTestConstants.chainIds[0];  // Ethereum
            const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault;
            const usdcContract = stablecoinDeployments.get(primaryChainId)!.get(exportData.localTestConstants.stablecoins.get(primaryChainId)![0]) as MockToken;  // USDC in ETH
            const amountUSDC = BigNumber.from("1000000000000000");  // 1000$
            
            const secondaryChainId = exportData.localTestConstants.chainIds[1];  // BSC
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault;
            const usdtContract = stablecoinDeployments.get(secondaryChainId)!.get(exportData.localTestConstants.stablecoins.get(secondaryChainId)![0]) as MockToken;  // USDT in BSC
            const poolIdSecondary = exportData.localTestConstants.poolIds.get("USDT")!;
            const amountUSDT = BigNumber.from("3000000000000000");  // 3000$

            // Mint USDC to primaryVault and USDT to secondaryVault
            await usdcContract.connect(owner).mint(primaryVault.address, amountUSDC);
            await usdtContract.connect(owner).mint(secondaryVault.address, amountUSDT);
            
            // SwapRemote
            console.log("SwapRemote");
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint16"], [amountUSDC, usdcContract.address, secondaryChainId, poolIdSecondary]);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            await primaryVault.connect(owner).executeActions([swapRemoteAction]);

            // Check both tokens
            const usdcRemain = await usdcContract.balanceOf(primaryVault.address);
            const usdtRemain = await usdtContract.balanceOf(secondaryVault.address);
            console.log("USDC, USDT", usdcRemain, usdtRemain);
            expect(usdcRemain).to.eq(BigNumber.from("0"));
            // expect(usdtRemain).gt(amountUSDT);
        })
    })
})