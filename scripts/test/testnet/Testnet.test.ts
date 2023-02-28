import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, StargateToken__factory, MockToken__factory, PrimaryVault, SecondaryVault, LPStaking__factory, MozaicLP } from '../../../types/typechain';
import { ActionTypeEnum, ProtocolStatus, MozaicDeployment } from '../../constants/types';
import exportData from '../../constants/index';
import { BigNumber, Wallet } from 'ethers';
import { initMozaics } from '../../util/deployUtils';
// import "hardhat-change-network";
// import { ALCHEMY_API_KEY, GOERLI_PRIVATE_KEY } from '../../../hardhat.config';
const fs = require('fs');
const hre = require('hardhat');

describe('SecondaryVault.executeActions', () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let ben: SignerWithAddress;
    let mozaicDeployments: Map<number, MozaicDeployment>;
    let primaryChainId: number;
    let mozaicDeployment = {} as MozaicDeployment;
    let decimals: number;

    before(async () => {
        mozaicDeployments = new Map<number, MozaicDeployment>();
        
        // Parse bsctest deploy info
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
        let mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        let mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let primaryValutFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        let primaryVault = primaryValutFactory.attach(json.mozaicVault);  // Because primaryChain is goerli now.
        mozaicDeployment = {
            mozaicLp: mozLp,
            mozaicVault: primaryVault
        }
        mozaicDeployments.set(json.chainId, mozaicDeployment);

        // Parse fantom deploy info
        hre.changeNetwork('fantom');
        [owner] = await ethers.getSigners();
        json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
        mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        let secondaryVault = secondaryVaultFactory.attach(json.mozaicVault);
        mozaicDeployment = {
            mozaicLp: mozLp,
            mozaicVault: secondaryVault
        }
        mozaicDeployments.set(json.chainId, mozaicDeployment);
        
        // Set primaryChainId
        primaryChainId = exportData.testnetTestConstants.mozaicMainChainId;

        decimals = 6;

        initMozaics(primaryChainId, mozaicDeployments);
    })
    beforeEach(async () => {
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
    })
    describe ('StargateDriver.execute', () => {
        it ("can stake token", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const coinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinContract = MockTokenFactory.attach(coinAddr);
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            
            // Mint USDC to SecondaryVault
            console.log("Before mint, SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));
            let tx = await coinContract.connect(owner).mint(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            // console.log("tx hash", receipt.transactionHash);
            console.log("After mint, SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));
            
            // Check LpTokens for vault in LpStaking
            const amountLPStakedBefore = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("Before stake: LpTokens for SecondaryVault in LpStaking is", amountLPStakedBefore);

            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([stakeAction]);
            receipt = await tx.wait();
            console.log("After stake SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for vault in LpStaking
            const amountLPStakedAfter = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After stake LpTokens for SecondaryVault in LpStaking is", amountLPStakedAfter);
            expect(amountLPStakedAfter).gt(amountLPStakedBefore);
        })
        it ("can unstake USDC", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const coinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinContract = MockTokenFactory.attach(coinAddr);
            const lpStakingAddr = await secondaryVault.stargateLpStaking();
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            
            // Mint USDC to SecondaryVault
            console.log("Before mint, SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));
            let tx = await coinContract.connect(owner).mint(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            console.log("After mint, SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));
            
            // Check LpTokens for vault in LpStaking
            let lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("Before stake LpTokens for SecondaryVault in LpStaking is", lpStaked);

            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([stakeAction]);
            receipt = await tx.wait();
            console.log("After stake SecondaryVault has token:", (await coinContract.balanceOf(secondaryVault.address)));

            // Check LpTokens for vault in LpStaking
            lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After stake LpTokens for SecondaryVault in LpStaking is", lpStaked);

            const amountCoinBefore = await coinContract.balanceOf(secondaryVault.address);

            // Unstake
            // SecondaryVault unstake LPToken
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [lpStaked, coinContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };

            tx = await secondaryVault.connect(owner).executeActions([unstakeAction]);
            receipt = await tx.wait();

            // Check USDC in secondaryVault
            const amountCoinAfter = await coinContract.balanceOf(secondaryVault.address);
            console.log("After unstake SecondaryVault has token:", amountCoinAfter);
            expect(amountCoinAfter).gt(amountCoinBefore);

            // Check LpTokens for vault in LpStaking
            lpStaked = (await lpStaking.userInfo(BigNumber.from("0"), secondaryVault.address)).amount;
            console.log("After unstake LpTokens for SecondaryVault in LpStaking is", lpStaked);
        })
        it.only ("can swapRemote", async () => {
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const srcChainId = exportData.testnetTestConstants.chainIds[1];  // Bsc
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            const srcTokenAddr = exportData.testnetTestConstants.stablecoins.get(srcChainId)!.get("BUSD")!;
            const srcMockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const srcToken = srcMockTokenFactory.attach(srcTokenAddr);
            const amountSrc = ethers.utils.parseUnits("30", decimals);
            const amountStakeSrc = ethers.utils.parseUnits("10", decimals);
            const amountSwap = ethers.utils.parseUnits("4", decimals);

            // Mint srcToken to srcVault
            let tx = await srcToken.connect(owner).mint(srcVault.address, amountSrc);
            let receipt = await tx.wait();
            console.log("srcVault has srcToken:", (await srcToken.balanceOf(srcVault.address)));
            
            // srcVault stake srcToken
            const srcPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeSrc, srcToken.address]);
            const stakeActionSrc: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : srcPayload
            };
            tx = await srcVault.connect(owner).executeActions([stakeActionSrc]);
            receipt = await tx.wait();
            const amountSrcBefore = await srcToken.balanceOf(srcVault.address);
            console.log("After src stake, srcValut has srcToken %d", amountSrcBefore);

            hre.changeNetwork('fantom');
            [owner] = await ethers.getSigners();
            const dstChainId = exportData.testnetTestConstants.chainIds[2];  // Fantom
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            const dstPoolId = exportData.testnetTestConstants.poolIds.get("USDC")!;
            const dstTokenAddr = exportData.testnetTestConstants.stablecoins.get(dstChainId)!.get("USDC")!;
            const dstMockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const dstToken = dstMockTokenFactory.attach(dstTokenAddr);
            const amountDst = ethers.utils.parseUnits("30", decimals);
            const amountStakeDst = ethers.utils.parseUnits("20", decimals);

            // Mint dstToken to dstVault
            tx = await dstToken.connect(owner).mint(dstVault.address, amountDst);
            receipt = await tx.wait();
            console.log("dstVault has dstToken:", (await dstToken.balanceOf(dstVault.address)));
            
            // dstVault stake dstToken
            const dstPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeDst, dstToken.address]);
            const stakeActionDst: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : dstPayload
            };
            tx = await dstVault.connect(owner).executeActions([stakeActionDst]);
            receipt = await tx.wait();
            const amountDstBefore = await dstToken.balanceOf(dstVault.address);
            console.log("After dst stake, dstVault has dstToken %d", amountDstBefore);

            // SwapRemote: Ethereum USDT -> BSC USDT
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountSwap, srcToken.address, dstChainId, dstPoolId]);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            tx = await srcVault.connect(owner).executeActions([swapRemoteAction]);
            receipt = await tx.wait();

            // Check both tokens
            const amountSrcRemain = await srcToken.balanceOf(srcVault.address);
            hre.changeNetwork('fantom');
            const amountDstRemain = await dstToken.balanceOf(dstVault.address);
            console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain, amountDstRemain);
            expect(amountSrcRemain).lessThan(amountSrcBefore);
            expect(amountDstRemain).greaterThan(amountDstBefore);
        })
    })
    describe ('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const usdcCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const usdcCoin = MockTokenFactory.attach(usdcCoinAddr);
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcCoinAddr, usdtCoinAddr]);
            
            // Mint USDC to SecondaryVault
            let tx = await usdcCoin.connect(owner).mint(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            const amountUSDCBefore = await usdcCoin.balanceOf(secondaryVault.address);
            const amountUSDTBefore = await usdtCoin.balanceOf(secondaryVault.address)
            console.log("SecondaryVault has USDC, USDT:", amountUSDCBefore, amountUSDTBefore);
            
            // Swap USDC to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([swapAction]);
            receipt = await tx.wait();

            // Check USDT amount of SecondaryVault
            const amountUSDCAfter = await usdcCoin.balanceOf(secondaryVault.address);
            const amountUSDTAfter = await usdtCoin.balanceOf(secondaryVault.address)
            console.log("Now SecondaryVault has USDC, USDT:", amountUSDCAfter, amountUSDTAfter);
            expect(amountUSDCAfter).lt(amountUSDCBefore);
            expect(amountUSDTAfter).gt(amountUSDTBefore);
        })
        it ("can swap STG->USDT", async () => {
            const chainId = exportData.testnetTestConstants.chainIds[0];// Eth
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgTokenAddr = await secondaryVault.stargateToken();
            const stgTokenFactory = (await ethers.getContractFactory("StargateToken", owner)) as StargateToken__factory;
            const stgToken = stgTokenFactory.attach(stgTokenAddr);
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgTokenAddr, usdtCoinAddr]);
    
            // Send STG to SecondaryVault
            let tx = await stgToken.connect(owner).approve(secondaryVault.address, amountLD);
            let receipt = await tx.wait();
            tx = await stgToken.connect(owner).transfer(secondaryVault.address, amountLD);
            receipt = await tx.wait();
            const amountSTGBefore = await stgToken.balanceOf(secondaryVault.address);
            const amountUSDTBefore = await usdtCoin.balanceOf(secondaryVault.address)
            console.log("SecondaryVault has STG, USDT:", amountSTGBefore, amountUSDTBefore);
            
            // Swap STG to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            tx = await secondaryVault.connect(owner).executeActions([swapAction]);
            receipt = await tx.wait();
    
            // Check USDT amount of SecondaryVault
            const amountSTGAfter = await stgToken.balanceOf(secondaryVault.address);
            const amountUSDTAfter = await usdtCoin.balanceOf(secondaryVault.address)
            console.log("Now SecondaryVault has STG, USDT:", amountSTGAfter, amountUSDTAfter);
            expect(amountSTGAfter).lt(amountSTGBefore);
            expect(amountUSDTAfter).gt(amountUSDTBefore);
        })
    })
    describe ('Flow test', () => {
        it ('normal flow', async () => {
            const aliceTotalLD = ethers.utils.parseUnits("10", decimals);
            const aliceDeposit1LD = ethers.utils.parseUnits("3", decimals);
            const aliceDeposit2LD = ethers.utils.parseUnits("4", decimals);
            const benTotalLD = ethers.utils.parseUnits("20", decimals);
            const benDepositLD = ethers.utils.parseUnits("5", decimals);
            const benWithdrawMLP = ethers.utils.parseUnits("3", decimals);

            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            const primaryChainId = exportData.testnetTestConstants.chainIds[0];
            const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
            const tokenAPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDC")!;
            let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenAPrimary = MockTokenFactory.attach(tokenAPrimaryAddr);
            // Mint tokens
            let tx = await tokenAPrimary.connect(owner).mint(alice.address, aliceTotalLD);
            let receipt = await tx.wait();

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            const secondaryChainId = exportData.testnetTestConstants.chainIds[1];
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            const tokenBSecondaryAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDT")!;
            MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenBSecondary = MockTokenFactory.attach(tokenBSecondaryAddr);
            // Mint tokens
            tx = await tokenBSecondary.connect(owner).mint(ben.address, benTotalLD);
            receipt = await tx.wait();

            // ----------------------- First Round: ----------------------------
            console.log("First Round:");
            // Algostory: ### 1. User Books Deposit
            // Alice -> PrimaryVault Token A
            // Ben -> SecondaryVault Token B
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await tokenAPrimary.connect(alice).approve(primaryVault.address, aliceDeposit1LD);
            receipt = await tx.wait();
            tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenAPrimary.address, primaryChainId);
            receipt = await tx.wait();

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await tokenBSecondary.connect(ben).approve(secondaryVault.address, benDepositLD);
            receipt = await tx.wait();
            tx = await secondaryVault.connect(ben).addDepositRequest(benDepositLD, tokenBSecondary.address, secondaryChainId);
            receipt = await tx.wait();

            // Check Pending Request Buffer
            // const totalDepositRequest = await secondaryVault.getTotalDepositRequest(false);
            // console.log("totalDepositRequest", totalDepositRequest);
            // console.log("alice %d, ben %d", aliceDepositLD, benDepositLD);
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            expect(await primaryVault.getTotalDepositRequest(false)).to.eq(aliceDeposit1LD.add(benDepositLD));
            expect(await primaryVault.getDepositRequestAmount(false, alice.address, tokenAPrimary.address, primaryChainId)).to.eq(aliceDeposit1LD);

            // Algostory: #### 3-1. Session Start (Protocol Status: Idle -> Optimizing)
            tx = await primaryVault.connect(owner).initOptimizationSession();
            receipt = await tx.wait();
            // Protocol Status : IDLE -> OPTIMIZING
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // Algostory: #### 3-2. Take Snapshot and Report
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            console.log("ChainId %d, primaryVault %s", primaryChainId, primaryVault.address);
            tx = await primaryVault.connect(owner).takeSnapshot();
            receipt = await tx.wait();
            tx = await primaryVault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            receipt = await tx.wait();

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            console.log("ChainId %d, secondaryVault %s", secondaryChainId, secondaryVault.address);
            tx = await secondaryVault.connect(owner).takeSnapshot();
            receipt = await tx.wait();
            tx = await secondaryVault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            receipt = await tx.wait();
            
            // Alice adds to pending request pool, but this should not affect minted mLP amount.
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await tokenAPrimary.connect(alice).approve(primaryVault.address, aliceDeposit2LD);
            receipt = await tx.wait();
            tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit2LD, tokenAPrimary.address, primaryChainId);
            receipt = await tx.wait();

            // Pending/Staged Request Amounts
            expect(await primaryVault.getTotalDepositRequest(true)).to.eq(aliceDeposit1LD.add(benDepositLD));
            expect(await primaryVault.getTotalDepositRequest(false)).to.eq(aliceDeposit2LD);

            // Primary vault now has all snapshot reports.
            expect(await primaryVault.allVaultsSnapshotted()).to.eq(true);
            const mozaicLpPerStablecoin = await primaryVault.mozaicLpPerStablecoinMil();

            // Algostory: #### 3-3. Determine MLP per Stablecoin Rate
            // Initial rate is 1 mLP per USD
            expect(mozaicLpPerStablecoin).to.eq(1000000);

            // Stake
            // ...

            // Algostory: #### 5. Settle Requests
            // Alice, Ben receive mLP, Vaults receive coin
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).settleRequestsAllVaults();
            receipt = await tx.wait();
            expect(await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address)).to.eq(aliceDeposit1LD);  // mLP eq to SD

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).reportSettled();
            receipt = await tx.wait();
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address)).to.eq(benDepositLD);     // mLP eq to SD

            // Algostory: #### 6. Session Closes
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);

            // Second Round:
            console.log("Second Round:");
            // Alice's booked deposit request 4k now turns into staged from pending.
            // Ben books withdraw (half of his mLP)
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            const benMLPBefore = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benCoinBefore = await tokenBSecondary.balanceOf(ben.address);
            console.log("ben:", ben.address);
            console.log("benMLPBefore", benMLPBefore, "benCoinBefore", benCoinBefore);
            tx = await secondaryVault.connect(ben).addWithdrawRequest(benWithdrawMLP, tokenBSecondary.address, secondaryChainId);
            receipt = await tx.wait();
            
            // Settle Requests
            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).initOptimizationSession();
            receipt = await tx.wait();
            tx = await primaryVault.connect(owner).takeSnapshot();
            receipt = await tx.wait();
            tx = await primaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0")});
            receipt = await tx.wait();

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).takeSnapshot();
            receipt = await tx.wait();
            tx = await secondaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0.1")});
            receipt = await tx.wait();

            hre.changeNetwork('goerli');
            [owner, alice, ben] = await ethers.getSigners();
            console.log("before", await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address));
            tx = await primaryVault.settleRequestsAllVaults({value:ethers.utils.parseEther("0.1")});
            receipt = await tx.wait();
            console.log("after", await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address));

            expect(await primaryVault.getTotalDepositRequest(true)).to.eq(0);
            console.log(await primaryVault.getTotalDepositRequest(true));
            // console.log(txresult);
            // console.log("wait for settling");
            // await new Promise( resolve => setTimeout(resolve, 5000) );
            // console.log("settled");

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.reportSettled({value:ethers.utils.parseEther("0.1")});
            receipt = await tx.wait();
            const benMLPAfter = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benCoinAfter = await tokenBSecondary.balanceOf(ben.address);
            console.log("benMLPAfter", benMLPAfter, "benCoinAfter", benCoinAfter);
            expect(benMLPBefore.sub(benMLPAfter)).to.eq(benWithdrawMLP);
            expect(benCoinAfter.sub(benCoinBefore)).to.eq(benWithdrawMLP);
            // settle requests

        })
        it ('single chain flow', async () => {
            [alice, ben] = await ethers.getSigners();
            const chainId = exportData.testnetTestConstants.chainIds[0];
            const vault = mozaicDeployments.get(chainId)!.mozaicVault as PrimaryVault;
            const mozLp = mozaicDeployments.get(chainId)!.mozaicLp as MozaicLP;
            const tokenAPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenAPrimary = MockTokenFactory.attach(tokenAPrimaryAddr);
            const tokenBPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const tokenBPrimary = MockTokenFactory.attach(tokenBPrimaryAddr);
            
            const aliceTotalLD = ethers.utils.parseUnits("10", decimals);
            const aliceDeposit1LD = ethers.utils.parseUnits("3", decimals);
            const aliceDeposit2LD = ethers.utils.parseUnits("4", decimals);
            const benTotalLD = ethers.utils.parseUnits("20", decimals);
            const benDepositLD = ethers.utils.parseUnits("5", decimals);
            const benWithdrawMLP = ethers.utils.parseUnits("3", decimals);

            // Mint tokens
            let tx = await tokenAPrimary.connect(owner).mint(alice.address, aliceTotalLD);
            let receipt = await tx.wait();
            tx = await tokenBPrimary.connect(owner).mint(ben.address, benTotalLD);
            receipt = await tx.wait();

            // ----------------------- First Round: ----------------------------
            console.log("First Round:");
            // Algostory: ### 1. User Books Deposit
            // Alice -> PrimaryVault Token A
            // Ben -> PrimaryVault Token B
            let totalDepositRequestPendingBefore = await vault.getTotalDepositRequest(false);
            let depositRequestPendingBefore = await vault.getDepositRequestAmount(false, alice.address, tokenAPrimary.address, chainId);

            tx = await tokenAPrimary.connect(alice).approve(vault.address, aliceDeposit1LD);
            receipt = await tx.wait();
            tx = await vault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenAPrimary.address, chainId);
            receipt = await tx.wait();

            tx = await tokenBPrimary.connect(ben).approve(vault.address, benDepositLD);
            receipt = await tx.wait();
            tx = await vault.connect(ben).addDepositRequest(benDepositLD, tokenBPrimary.address, chainId);
            receipt = await tx.wait();

            // Check Pending Request Buffer
            let totalDepositRequestPending = await vault.getTotalDepositRequest(false);
            console.log("totalDepositRequestPending %d, totalDepositRequestPendingBefore %d, aliceDeposit1LD %d, benDepositLD %d", totalDepositRequestPending, totalDepositRequestPendingBefore, aliceDeposit1LD, benDepositLD);
            expect(totalDepositRequestPending.sub(totalDepositRequestPendingBefore)).to.eq(aliceDeposit1LD.add(benDepositLD));
            let depositRequestPending = await vault.getDepositRequestAmount(false, alice.address, tokenAPrimary.address, chainId);
            console.log("depositRequestPending %d, depositRequestPendingBefore %d, aliceDeposit1LD %d", depositRequestPending, depositRequestPendingBefore, aliceDeposit1LD);
            expect(depositRequestPending.sub(depositRequestPendingBefore)).to.eq(aliceDeposit1LD);

            // Algostory: #### 3-1. Session Start (Protocol Status: Idle -> Optimizing)
            tx = await vault.connect(owner).initOptimizationSession();
            receipt = await tx.wait();
            // Protocol Status : IDLE -> OPTIMIZING
            expect(await vault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // Algostory: #### 3-2. Take Snapshot and Report
            console.log("ChainId %d, Vault %s", chainId, vault.address);
            tx = await vault.connect(owner).takeSnapshot();
            receipt = await tx.wait();
            tx = await vault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            receipt = await tx.wait();

            // Alice adds to pending request pool, but this should not affect minted mLP amount.
            let totalDepositRequestStagedBefore = await vault.getTotalDepositRequest(true);
            totalDepositRequestPendingBefore = await vault.getTotalDepositRequest(false);

            tx = await tokenAPrimary.connect(alice).approve(vault.address, aliceDeposit2LD);
            receipt = await tx.wait();
            tx = await vault.connect(alice).addDepositRequest(aliceDeposit2LD, tokenAPrimary.address, chainId);
            receipt = await tx.wait();

            // Pending/Staged Request Amounts
            let totalDepositRequestStaged = await vault.getTotalDepositRequest(true);
            totalDepositRequestPending = await vault.getTotalDepositRequest(false);
            console.log("totalDepositRequestStaged %d, totalDepositRequestStagedBefore %d, aliceDeposit1LD %d, benDepositLD %d", totalDepositRequestStaged, totalDepositRequestStagedBefore, aliceDeposit1LD, benDepositLD);
            expect(totalDepositRequestStaged.sub(totalDepositRequestStagedBefore)).to.eq(aliceDeposit1LD.add(benDepositLD));
            console.log("totalDepositRequestPending %d, totalDepositRequestPendingBefore %d, aliceDeposit2LD %d", totalDepositRequestPending, totalDepositRequestPendingBefore, aliceDeposit2LD);
            expect(totalDepositRequestPending.sub(totalDepositRequestPendingBefore)).to.eq(aliceDeposit2LD);

            // Primary vault now has all snapshot reports.
            expect(await vault.allVaultsSnapshotted()).to.eq(true);
            const mozaicLpPerStablecoin = await vault.mozaicLpPerStablecoinMil();

            // Algostory: #### 3-3. Determine MLP per Stablecoin Rate
            // Initial rate is 1 mLP per USD
            console.log("mozaicLpPerStablecoin %d", mozaicLpPerStablecoin);
            expect(mozaicLpPerStablecoin).to.eq(1000000);

            // Stake
            // ...

            // Algostory: #### 5. Settle Requests
            // Alice, Ben receive mLP, Vaults receive coin
            tx = await vault.settleRequestsAllVaults();
            receipt = await tx.wait();
            
            let aliceDepositRequestStaged = await vault.getDepositRequestAmount(true, alice.address, tokenAPrimary.address, chainId);
            console.log("aliceDepositRequestStaged %d", aliceDepositRequestStaged);
            expect(await mozLp.balanceOf(alice.address)).to.eq(aliceDepositRequestStaged);  // mLP eq to SD
            let benDepositRequestStaged = await vault.getDepositRequestAmount(true, ben.address, tokenBPrimary.address, chainId);
            console.log("benDepositRequestStaged %d", benDepositRequestStaged);
            expect(await mozLp.balanceOf(ben.address)).to.eq(benDepositRequestStaged);     // mLP eq to SD

            // Algostory: #### 6. Session Closes
            expect(await vault.protocolStatus()).to.eq(ProtocolStatus.IDLE);

            // Second Round:
            console.log("Second Round:");

            // Alice's booked deposit2 request now turns into staged from pending.
            // Ben books withdraw (half of his mLP)
            const benMLPBefore = await mozLp.balanceOf(ben.address);
            const benCoinBefore = await tokenBPrimary.balanceOf(ben.address);
            console.log("ben:", ben.address);
            console.log("benMLPBefore", benMLPBefore, "benCoinBefore", benCoinBefore);
            tx = await vault.connect(ben).addWithdrawRequest(benWithdrawMLP, tokenBPrimary.address, chainId);
            receipt = await tx.wait();

            // Settle Requests
            tx = await vault.connect(owner).initOptimizationSession();
            receipt = await tx.wait();
            tx = await vault.connect(owner).takeSnapshot();
            receipt = await tx.wait();
            tx = await vault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            receipt = await tx.wait();
            // console.log("before", await mozLp.balanceOf(alice.address));
            tx = await vault.settleRequestsAllVaults();
            receipt = await tx.wait();
            console.log("alice has mozLp %d, aliceDepositRequestStaged %d, aliceDeposit2LD %d", await mozLp.balanceOf(alice.address), aliceDepositRequestStaged, aliceDeposit2LD);
            expect(await mozLp.balanceOf(alice.address)).to.eq(aliceDepositRequestStaged.add(aliceDeposit2LD));  // mLP eq to SD
            console.log("getTotalDepositRequestStaged %d", await vault.getTotalDepositRequest(true));
            expect(await vault.getTotalDepositRequest(true)).to.eq(0);
            
            // await vault.reportSettled({value:ethers.utils.parseEther("0.1")});
            const benMLPAfter = await mozLp.balanceOf(ben.address);
            const benCoinAfter = await tokenBPrimary.balanceOf(ben.address);
            console.log("benMLPAfter", benMLPAfter, "benCoinAfter", benCoinAfter);

            expect(benMLPBefore.sub(benMLPAfter)).to.eq(benWithdrawMLP);
            expect(benCoinAfter.sub(benCoinBefore)).to.eq(benWithdrawMLP);
            // settle requests
        })
    })
})