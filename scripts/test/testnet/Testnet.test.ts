import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, StargateToken__factory, MockToken__factory, PrimaryVault, SecondaryVault, LPStaking__factory } from '../../../types/typechain';
import { ActionTypeEnum, MozaicDeployment } from '../../constants/types';
// import { initMozaics } from '../../util/deployUtils';
import exportData from '../../constants/index';
import { BigNumber, Wallet } from 'ethers';
// import { ALCHEMY_API_KEY, GOERLI_PRIVATE_KEY } from '../../../hardhat.config';
const fs = require('fs');

describe('SecondaryVault.executeActions', () => {
    let owner: SignerWithAddress;
    let kevin: SignerWithAddress;
    let ben: SignerWithAddress;
    // let owner: Wallet;
    // let alchemyProvider;
    let mozaicDeployments: Map<number, MozaicDeployment>;
    let primaryChainId: number;
    let mozaicDeployment = {} as MozaicDeployment;
    // let network;
    let MockTokenFactory: MockToken__factory;
    let decimals: number;

    before(async () => {
        [owner, kevin, ben] = await ethers.getSigners();  // owner is control center
        // owner = await ethers.getSigner("0x5525631e49D781d5d6ee368c82B72ff7485C5B1F");
        
        // // Provider
        // alchemyProvider = new ethers.providers.AlchemyProvider(network="goerli", ALCHEMY_API_KEY);
        // // Signer
        // owner = new ethers.Wallet(GOERLI_PRIVATE_KEY, alchemyProvider)
        MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
        
        mozaicDeployments = new Map<number, MozaicDeployment>();
        const mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        const primaryValutFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        const secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        
        // Parse goerli deploy info
        let json = JSON.parse(fs.readFileSync('deployGoerliResult.json', 'utf-8'));
        let mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let primaryVault = primaryValutFactory.attach(json.mozaicVault);  // Because primaryChain is goerli now.
        mozaicDeployment = {
            mozaicLp: mozLp,
            mozaicVault: primaryVault
        }
        mozaicDeployments.set(json.chainId, mozaicDeployment);

        // Parse bsc deploy info
        json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
        mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let secondaryVault = secondaryVaultFactory.attach(json.mozaicVault);
        mozaicDeployment = {
            mozaicLp: mozLp,
            mozaicVault: secondaryVault
        }
        mozaicDeployments.set(json.chainId, mozaicDeployment);
        
        // Set primaryChainId
        primaryChainId = exportData.testnetTestConstants.mozaicMainChainId;

        decimals = 6;
    })
    beforeEach(async () => {
        
    })
    describe.only ('StargateDriver.execute', () => {
        it ("can stake token", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            // const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const coinContract = MockTokenFactory.attach(coinAddr);
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            
            // Mint USDC to SecondaryVault
            console.log("Before mint, SecondaryVault has token:", (await coinContract.connect(owner).balanceOf(secondaryVault.address)));
            let tx = await coinContract.connect(owner).mint(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            // console.log("tx hash", receipt.transactionHash);
            console.log("After mint, SecondaryVault has token:", (await coinContract.connect(owner).balanceOf(secondaryVault.address)));
            
            // Check LpTokens for vault in LpStaking
            let lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("Before stake: LpTokens for SecondaryVault in LpStaking is", lpStaked);

            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([stakeAction]);
            receipt = await tx.wait();
            // console.log("tx hash", receipt.transactionHash);
            console.log("After stake SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for vault in LpStaking
            lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After stake LpTokens for SecondaryVault in LpStaking is", lpStaked);
            expect(lpStaked).gt(BigNumber.from("0"));
        })
        it.only ("can unstake USDC", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            // const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const coinContract = MockTokenFactory.attach(coinAddr);
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            // const amountLD = BigNumber.from("1234567890123");
            
            // Mint USDC to SecondaryVault
            console.log("Before mint, SecondaryVault has token:", (await coinContract.connect(owner).balanceOf(secondaryVault.address)));
            let tx = await coinContract.connect(owner).mint(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            // console.log("tx hash", receipt.transactionHash);
            console.log("After mint, SecondaryVault has token:", (await coinContract.connect(owner).balanceOf(secondaryVault.address)));
            
            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };

            // Check LpTokens for vault in LpStaking
            let lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("Before stake: LpTokens for SecondaryVault in LpStaking is", lpStaked);

            tx = await secondaryVault.connect(owner).executeActions([stakeAction]);
            receipt = await tx.wait();
            // console.log("tx hash", receipt.transactionHash);
            console.log("After stake SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for vault in LpStaking
            lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After stake: LpTokens for SecondaryVault in LpStaking is", lpStaked);
            expect(lpStaked).gt(BigNumber.from("0"));

            // Unstake
            // SecondaryVault unstake LPToken
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [lpStaked, coinContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };

            tx = await secondaryVault.connect(owner).executeActions([unstakeAction]);
            receipt = await tx.wait();
            // console.log("tx hash", receipt.transactionHash);

            // Check USDC in secondaryVault
            console.log("After unstake SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));
            expect(await coinContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));

            // Check LpTokens for vault in LpStaking
            lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After unstake LpTokens for SecondaryVault in LpStaking is", lpStaked);
            expect(lpStaked).gt(BigNumber.from("0"));
        })
        it ("can swapRemote", async () => {
            const srcChainId = exportData.testnetTestConstants.chainIds[0];  // Ethereum
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            // const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const srcTokenAddr = exportData.testnetTestConstants.stablecoins.get(srcChainId)!.get("USDT")!;
            const srcToken = MockTokenFactory.attach(srcTokenAddr);
            const amountSrc = ethers.utils.parseUnits("30", decimals);
            const amountStakeSrc = ethers.utils.parseUnits("10", decimals);
            const amountSwap = ethers.utils.parseUnits("4", decimals);
            // const amountSrc = BigNumber.from("300000000000000000000");  // 300$
            // const amountStakeSrc = BigNumber.from("100000000000000000000");  // 100$
            // const amountSwap = BigNumber.from("40000000000000000000");   // 40$

            const dstChainId = exportData.testnetTestConstants.chainIds[1];  // BSC
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            const dstPoolId = exportData.testnetTestConstants.poolIds.get("USDT")!;   // ????
            const dstTokenAddr = exportData.testnetTestConstants.stablecoins.get(dstChainId)!.get("USDT")!;
            const dstToken = MockTokenFactory.attach(dstTokenAddr);
            const amountDst = ethers.utils.parseUnits("30", decimals);
            const amountStakeDst = ethers.utils.parseUnits("30", decimals);
            // const amountDst = BigNumber.from("300000000000000000000");  // 300$
            // const amountStakeDst = BigNumber.from("100000000000000000000");  // 100$

            // Mint srcToken to srcVault
            let tx = await srcToken.connect(owner).mint(srcVault.address, amountSrc);
            let receipt = await tx.wait();
            console.log("srcVault has srcToken:", (await srcToken.balanceOf(srcVault.address)));
            
            // srcVault stake srcToken
            const srcPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeSrc, srcToken.address]);
            const stakeActionSrc: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : srcPayload
            };
            tx = await srcVault.connect(owner).executeActions([stakeActionSrc]);
            receipt = await tx.wait();
            console.log("After src stake, srcValut has srcToken %d", (await srcToken.balanceOf(srcVault.address)));

            // Mint dstToken to dstVault
            tx = await dstToken.connect(owner).mint(dstVault.address, amountDst);
            receipt = await tx.wait();
            console.log("dstVault has dstToken:", (await dstToken.balanceOf(dstVault.address)));
            
            // dstVault stake dstToken
            const dstPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeDst, dstToken.address]);
            const stakeActionDst: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : dstPayload
            };
            tx = await dstVault.connect(owner).executeActions([stakeActionDst]);
            receipt = await tx.wait();
            console.log("After dst stake, dstVault has dstToken %d", (await dstToken.balanceOf(dstVault.address)));
            
            // SwapRemote: Ethereum USDT -> BSC USDT
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountSwap, srcToken.address, dstChainId, dstPoolId]);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            tx = await srcVault.connect(owner).executeActions([swapRemoteAction]);
            receipt = await tx.wait();

            // Check both tokens
            const amountSrcRemain = await srcToken.balanceOf(srcVault.address);
            const amountDstRemain = await dstToken.balanceOf(dstVault.address);
            console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain, amountDstRemain);
            // expect(amountSrcRemain).lessThan(amountSrc);
            // expect(amountDstRemain).greaterThan(amountDst);
        })
    })
    describe ('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            // const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const usdcCoin = MockTokenFactory.attach(usdcCoinAddr);
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            // const amountLD = BigNumber.from("100000000000000000000");   // 100$
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcCoinAddr, usdtCoinAddr]);
            
            // Mint USDC to SecondaryVault
            let tx = await usdcCoin.connect(owner).mint(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            console.log("SecondaryVault has USDC, USDT:", (await usdcCoin.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            
            // Swap USDC to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([swapAction]);
            receipt = await tx.wait();

            // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has USDC, USDT:", (await usdcCoin.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            expect(await usdtCoin.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swap STG->USDT", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Eth
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgTokenFactory = (await ethers.getContractFactory("StargateToken", owner)) as StargateToken__factory;
            const stgTokenAddr = await secondaryVault.stargateToken();
            const stgToken = stgTokenFactory.attach(stgTokenAddr);
            // const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            // const amountLD = BigNumber.from("100000000000000000000");   // 100$
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgTokenAddr, usdtCoinAddr]);
    
            // Send STG to SecondaryVault
            let tx = await stgToken.connect(owner).approve(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            tx = await stgToken.connect(owner).transfer(secondaryVault.address, amountLD);
            receipt = await tx.wait();
            console.log("SecondaryVault has STG, USDT:", (await stgToken.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            
            // Swap STG to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([swapAction]);
            receipt = await tx.wait();
    
            // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has STG, USDT:", (await stgToken.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            expect(await usdtCoin.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
    })
    describe ('Flow test', () => {
        it ('normal flow', async () => {
            const primaryChainId = exportData.testnetTestConstants.chainIds[0];
            const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
            const tokenAPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDC")!;
            const tokenAPrimary = MockTokenFactory.attach(tokenAPrimaryAddr);
            // const tokenBPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDT")!;
            // const tokenBPrimary = MockTokenFactory.attach(tokenBPrimaryAddr);
            
            const secondaryChainId = exportData.testnetTestConstants.chainIds[1];
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            const tokenBSecondaryAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDT")!;
            const tokenBSecondary = MockTokenFactory.attach(tokenBSecondaryAddr);
            const tokenCSecondaryAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("BUSD")!;
            const tokenCSecondary = MockTokenFactory.attach(tokenCSecondaryAddr);

            // Mint tokens
            await tokenAPrimary.connect(owner).mint(owner.address, BigNumber.from("100000000000000"));     // 100 * 1e12
            // await tokenBPrimary.mint(owner.address, BigNumber.from("200000000000000"));  // 200 * 1e12
            await tokenBSecondary.connect(owner).mint(kevin.address, BigNumber.from("300000000000000"));   // 300 * 1e12
            // await tokenCSecondary.connect(owner).mint(ben.address, BigNumber.from("400000000000000"));   // 400 * 1e12

            // ----------------------- First Round: ----------------------------
            // Algostory: ### 1. User Books Deposit

            await tokenAPrimary.connect(owner).approve(primaryVault.address, BigNumber.from("25000000000000")); // 25 * 1e12
            await primaryVault.connect(owner).addDepositRequest(BigNumber.from("25000000000000"), tokenAPrimary.address, primaryChainId);

            await tokenAPrimary.connect(owner).approve(primaryVault.address, BigNumber.from("25000000000000")); // 25 * 1e12
            await primaryVault.connect(owner).addDepositRequest(BigNumber.from("25000000000000"), tokenAPrimary.address, primaryChainId);
            

        })
    })
})