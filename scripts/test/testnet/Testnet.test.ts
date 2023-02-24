import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, StargateToken__factory, MockToken__factory, SecondaryVault, LPStaking__factory } from '../../../types/typechain';
import { ActionTypeEnum, MozaicDeployment } from '../../constants/types';
import { initMozaics } from '../../util/deployUtils';
import exportData from '../../constants/index';
import { BigNumber } from 'ethers';
const fs = require('fs');

describe('SecondaryVault.executeActions', () => {
    let owner: SignerWithAddress;
    let mozaicDeployments: Map<number, MozaicDeployment>;
    let primaryChainId: number;
    let mozaicDeployment = {} as MozaicDeployment;

    before(async () => {
        mozaicDeployments = new Map<number, MozaicDeployment>();
        const mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        const primaryValutFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        const secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        
        // Parse goerli deploy info
        let json = JSON.parse(fs.readFileSync('deployGoerliResult.json', 'utf-8'));
        mozaicDeployment = {
            mozaicLp: mozaicLpFactory.attach(json.mozaicLP),
            mozaicVault: primaryValutFactory.attach(json.mozaicVault),  // Because primaryChain is goerli now.
        }
        mozaicDeployments.set(json.chainId, mozaicDeployment);

        // Parse bsc deploy info
        json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
        mozaicDeployment = {
            mozaicLp: mozaicLpFactory.attach(json.mozaicLP),
            mozaicVault: secondaryVaultFactory.attach(json.mozaicVault),
        }
        mozaicDeployments.set(json.chainId, mozaicDeployment);
        
        // Set primaryChainId
        primaryChainId = await mozaicDeployment.mozaicVault.primaryChainId();
    })
    beforeEach(async () => {
        [owner] = await ethers.getSigners();
        await initMozaics(owner, primaryChainId, mozaicDeployments);
    })
    describe('StargateDriver.execute', () => {
        it ("can stake USDC", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;        // ???kevin
            const usdcContract = MockTokenFactory.attach(usdcAddr);
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = BigNumber.from("100000000000000000000");   // 100$
            
            // Mint USDC to SecondaryVault
            await usdcContract.connect(owner).mint(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);
            console.log("After stake SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for owner in LpStaking
            const lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for SecondaryVault in LpStaking is", lpStaked);
            expect(lpStaked).gt(BigNumber.from("0"));
        })
        it ("can unstake USDC", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const usdcContract = MockTokenFactory.attach(usdcAddr);
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = BigNumber.from("100000000000000000000");   // 100$
            
            // Stake
            // Mint USDC to SecondaryVault
            await usdcContract.connect(owner).mint(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            const payloadStake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payloadStake
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);
            console.log("After stake SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for owner in LpStaking
            const amountLPToken = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for SecondaryVault in LpStaking is", amountLPToken);
            expect(amountLPToken).gt(BigNumber.from("0"));

            // Unstake
            // SecondaryVault unstake LPToken
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLPToken, usdcContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };
            await secondaryVault.connect(owner).executeActions([unstakeAction]);

            // Check USDC in secondaryVault
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            expect(await usdcContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swapRemote", async () => {
            const srcChainId = exportData.testnetTestConstants.chainIds[0];  // Ethereum
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const srcTokenAddr = exportData.testnetTestConstants.stablecoins.get(srcChainId)!.get("USDT")!;
            const srcToken = MockTokenFactory.attach(srcTokenAddr);
            const amountSrc = BigNumber.from("300000000000000000000");  // 300$
            const amountStakeSrc = BigNumber.from("100000000000000000000");  // 100$
            const amountSwap = BigNumber.from("40000000000000000000");   // 40$

            const dstChainId = exportData.testnetTestConstants.chainIds[1];  // BSC
            const dstPoolId = exportData.localTestConstants.poolIds.get("USDT")!;   // ????
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            const dstTokenAddr = exportData.testnetTestConstants.stablecoins.get(dstChainId)!.get("USDT")!;
            const dstToken = MockTokenFactory.attach(dstTokenAddr);
            const amountDst = BigNumber.from("300000000000000000000");  // 300$
            const amountStakeDst = BigNumber.from("100000000000000000000");  // 100$

            // Mint srcToken to srcVault
            await srcToken.connect(owner).mint(srcVault.address, amountSrc);
            console.log("srcVault has srcToken:", (await srcToken.balanceOf(srcVault.address)));
            
            // srcVault stake srcToken
            const srcPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeSrc, srcToken.address]);
            const stakeActionSrc: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : srcPayload
            };
            await srcVault.connect(owner).executeActions([stakeActionSrc]);
            console.log("After src stake, srcValut has srcToken %d", (await srcToken.balanceOf(srcVault.address)));

            // Mint dstToken to dstVault
            await dstToken.connect(owner).mint(dstVault.address, amountDst);
            console.log("dstVault has dstToken:", (await dstToken.balanceOf(dstVault.address)));
            
            // dstVault stake dstToken
            const dstPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeDst, dstToken.address]);
            const stakeActionDst: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : dstPayload
            };
            await dstVault.connect(owner).executeActions([stakeActionDst]);
            console.log("After dst stake, dstVault has dstToken %d", (await dstToken.balanceOf(dstVault.address)));
            
            // SwapRemote: Ethereum USDT -> BSC USDT
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountSwap, srcToken.address, dstChainId, dstPoolId]);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
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
    describe('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const usdcCoin = MockTokenFactory.attach(usdcCoinAddr);
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const amountLD = BigNumber.from("100000000000000000000");   // 100$
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcCoinAddr, usdtCoinAddr]);
            
            // Mint USDC to SecondaryVault
            await usdcCoin.connect(owner).mint(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC, USDT:", (await usdcCoin.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            
            // Swap USDC to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

            // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has USDC, USDT:", (await usdcCoin.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            expect(await usdtCoin.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swap STG->USDT", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];// Eth
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgTokenFactory = (await ethers.getContractFactory("StargateToken", owner)) as StargateToken__factory;
            const stgTokenAddr = await secondaryVault.stargateToken();
            const stgToken = stgTokenFactory.attach(stgTokenAddr);
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const amountLD = BigNumber.from("100000000000000000000");   // 100$
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgTokenAddr, usdtCoinAddr]);
    
            // Send STG to SecondaryVault
            await stgToken.connect(owner).approve(secondaryVault.address, amountLD);
            await stgToken.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has STG, USDT:", (await stgToken.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            
            // Swap STG to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);
    
            // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has STG, USDT:", (await stgToken.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            expect(await usdtCoin.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
    })
})