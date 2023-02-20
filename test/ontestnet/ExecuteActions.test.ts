import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StargateToken__factory, MockToken__factory, SecondaryVault, LPStaking__factory } from '../../types/typechain';
import { ActionTypeEnum, MozaicDeployments, MozaicDeployment } from '../../constants/types';
import { deployAllToTestNet, initMozaics } from '../TestUtils';
import exportData from '../../constants/index';
import { BigNumber } from 'ethers';

describe('SecondaryVault.executeActions', () => {
    let owner: SignerWithAddress;
    let mozaicDeployments: MozaicDeployments;

    beforeEach(async () => {
        [owner] = await ethers.getSigners();

        mozaicDeployments = new Map<number, MozaicDeployment>();
 
        await deployAllToTestNet(owner, 10121, mozaicDeployments);
        // await deployAllToTestNet(owner, 10102, mozaicDeployments);
        await initMozaics(owner, mozaicDeployments);
    })
    describe('StargateDriver.execute', () => {
        it.only ("can stake USDC", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const usdcContract = MockTokenFactory.attach(usdcAddr);
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcAddr]);
            
            // Send USDC to SecondaryVault
            // console.log("Send USDC to SecondaryVault");
            await usdcContract.connect(owner).approve(secondaryVault.address, amountLD);
            await usdcContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            // console.log("SecondaryVault stake USDC");
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);

            // Check LpTokens for owner in LpStaking
            // console.log("Check LpTokens for owner in LpStaking");
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
            const amountLD = BigNumber.from("1234567890");
            
            // Stake
            // Send USDC to SecondaryVault
            // console.log("Send USDC to SecondaryVault");
            await usdcContract.connect(owner).approve(secondaryVault.address, amountLD);
            await usdcContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            // console.log("SecondaryVault stake USDC");
            const payloadStake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, usdcAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payloadStake
            };
            await secondaryVault.connect(owner).executeActions([stakeAction]);

            // Check LpTokens for owner in LpStaking
            // console.log("Check LpTokens for owner in LpStaking");
            const amountLPToken = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("LpTokens for SecondaryVault in LpStaking is", amountLPToken);
            expect(amountLPToken).gt(BigNumber.from("0"));

            // Unstake
            // SecondaryVault unstake LPToken
            // console.log("SecondaryVault unstake LPToken");
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLPToken, usdcContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };
            await secondaryVault.connect(owner).executeActions([unstakeAction]);

            // Check USDC in secondaryVault
            // console.log("Check USDC in secondaryVault");
            console.log("SecondaryVault has USDC:", (await usdcContract.balanceOf(secondaryVault.address)));
            expect(await usdcContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swapRemote", async () => {
            const firstChainId = exportData.testnetTestConstants.chainIds[0];  // Ethereum
            const firstVault = mozaicDeployments.get(firstChainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcAddr = exportData.testnetTestConstants.stablecoins.get(firstChainId)!.get("USDC")!;
            const usdcContract = MockTokenFactory.attach(usdcAddr);
            const amountUSDC = BigNumber.from("1000000000000000");  // 1000$
            
            const secondChainId = exportData.testnetTestConstants.chainIds[1];  // BSC
            const secondVault = mozaicDeployments.get(secondChainId)!.mozaicVault;
            const usdtAddr = exportData.testnetTestConstants.stablecoins.get(secondChainId)!.get("USDT")!;
            const usdtContract = MockTokenFactory.attach(usdtAddr);
            const poolIdSecondary = exportData.localTestConstants.poolIds.get("USDT")!;
            const amountUSDT = BigNumber.from("3000000000000000");  // 3000$

            // Mint USDC to firstVault and USDT to secondVault
            await usdcContract.connect(owner).mint(firstVault.address, amountUSDC);
            await usdtContract.connect(owner).mint(secondVault.address, amountUSDT);
            
            // SwapRemote
            console.log("SwapRemote");
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint16"], [amountUSDC, usdcContract.address, secondChainId, poolIdSecondary]);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            await firstVault.connect(owner).executeActions([swapRemoteAction]);

            // Check both tokens
            const usdcRemain = await usdcContract.balanceOf(firstVault.address);
            const usdtRemain = await usdtContract.balanceOf(secondVault.address);
            console.log("USDC, USDT", usdcRemain, usdtRemain);
            expect(usdcRemain).to.eq(BigNumber.from("0"));
            // expect(usdtRemain).gt(amountUSDT);
        })
    })
    describe('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const usdcContract = MockTokenFactory.attach(usdcAddr);
            const usdtAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtContract = MockTokenFactory.attach(usdtAddr);
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcAddr, usdtAddr]);
            
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
            const stgTokenFactory = (await ethers.getContractFactory("StargateToken", owner)) as StargateToken__factory;
            const stgTokenAddr = await secondaryVault.stargateToken();
            const stgToken = stgTokenFactory.attach(stgTokenAddr);
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdtAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtContract = MockTokenFactory.attach(usdtAddr);
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgTokenAddr, usdtAddr]);
    
            // Send STG to SecondaryVault
            console.log("Send STG to SecondaryVault");
            await stgToken.connect(owner).approve(secondaryVault.address, amountLD);
            await stgToken.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has STG, USDT:", (await stgToken.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            
            // Swap STG to USDT
            console.log("Swap STG to USDT");
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);
    
                // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has STG, USDT:", (await stgToken.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            expect(await usdtContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
    })
})