import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { SecondaryVault, MockToken__factory } from '../../../types/typechain';
import { deployAllToLocalNets } from '../../util/deployUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployment, MozaicDeployments, StargateDeploymentOnchain, ActionTypeEnum } from '../../constants/types'
import exportData from '../../constants/index';
import { BigNumber } from 'ethers';

describe('StargateDriver', () => {
    let owner: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;
    let primaryChainId: number;

    before (async () => {
        [owner] = await ethers.getSigners();  // owner is control center
        
        stablecoinDeployments = new Map<number, Map<string, string>>();
        stargateDeployments = new Map<number, StargateDeploymentOnchain>();
        mozaicDeployments = new Map<number, MozaicDeployment>();
        primaryChainId = exportData.localTestConstants.mozaicMainChainId;
        
        await deployAllToLocalNets(owner, primaryChainId, stablecoinDeployments, stargateDeployments, mozaicDeployments);
    })
    describe('StargateDriver.execute', () => {
        it ("can stake USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[1];  // BSC
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0])!);
            const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;
            const decimalsA = await usdcContract.decimals();
            const amountLD = ethers.utils.parseUnits("1", decimalsA);
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcContract.address]);

            // Mint USDC to SecondaryVault
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            await usdcContract.mint(secondaryVault.address, amountLD);
            console.log("After mint, SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);
            console.log("After stake, SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for owner in LpStaking
            const lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for SecondaryVault in LpStaking is", lpStaked);
            expect(lpStaked).gt(BigNumber.from("0"));
        })
        it ("can unstake USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[1];  // BSC
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0])!);
            const lpStaking = stargateDeployments.get(chainId)!.lpStakingContract;

            // Check LpTokens for owner in LpStaking
            let amountLPToken = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for owner in LpStaking is", amountLPToken);

            // Unstake
            // SecondaryVault unstake LPToken
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLPToken, usdcContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };
            await secondaryVault.connect(owner).executeActions([unstakeAction]);

            // Check LpTokens for owner in LpStaking
            amountLPToken = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After unstake LpTokens for owner in LpStaking is", amountLPToken);

            // Check USDC in secondaryVault
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            expect(await usdcContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swapRemote", async () => {
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const srcChainId = exportData.localTestConstants.chainIds[0];  // Ethereum
            const dstChainId = exportData.localTestConstants.chainIds[1];  // BSC
            const dstPoolId = exportData.localTestConstants.poolIds.get("USDT")!;
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            const srcToken = MockTokenFactory.attach(stablecoinDeployments.get(srcChainId)!.get(exportData.localTestConstants.stablecoins.get(srcChainId)![1])!);   // Ethereum USDT
            const dstToken = MockTokenFactory.attach(stablecoinDeployments.get(dstChainId)!.get(exportData.localTestConstants.stablecoins.get(dstChainId)![0])!);   // BSC USDT
            const amountSrc = BigNumber.from("300000000000000000000");  // 300$
            const amountDst = BigNumber.from("300000000000000000000");  // 300$
            const amountStakeSrc = BigNumber.from("100000000000000000000");  // 100$
            const amountStakeDst = BigNumber.from("100000000000000000000");  // 100$
            const amountSwap = BigNumber.from("40000000000000000000");   // 40$

            // Mint srcToken to srcVault
            await srcToken.mint(srcVault.address, amountSrc);
            console.log("srcVault has srcToken:", (await srcToken.balanceOf(srcVault.address)));
            
            // srcVault stake srcToken
            const srcPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeSrc, srcToken.address]);
            const stakeActionSrc: SecondaryVault.ActionStruct  = {
                driverId: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : srcPayload
            };
            await srcVault.connect(owner).executeActions([stakeActionSrc]);
            console.log("After src stake, srcVault has srcToken %d", (await srcToken.balanceOf(srcVault.address)));

            // Mint dstToken to dstVault
            await dstToken.mint(dstVault.address, amountDst);
            console.log("dstVault has dstToken:", (await dstToken.balanceOf(dstVault.address)));
            
            // dstVault stake dstToken
            const dstPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeDst, dstToken.address]);
            const stakeActionDst: SecondaryVault.ActionStruct  = {
                driverId: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : dstPayload
            };
            await dstVault.connect(owner).executeActions([stakeActionDst]);
            console.log("After dst stake, dstVault has dstToken %d", (await dstToken.balanceOf(dstVault.address)));
            
            // SwapRemote: Ethereum USDT -> BSC USDT
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountSwap, srcToken.address, dstChainId, dstPoolId]);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            await srcVault.connect(owner).executeActions([swapRemoteAction]);

            // Check both tokens
            const amountSrcRemain = await srcToken.balanceOf(srcVault.address);
            const amountDstRemain = await dstToken.balanceOf(dstVault.address);
            console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain, amountDstRemain);
            // expect(amountSrcRemain).lessThan(amountSrc);
            // expect(amountDstRemain).greaterThan(amountDst);
        })
    })
})