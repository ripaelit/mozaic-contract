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

    before(async () => {
        mozaicDeployments = new Map<number, MozaicDeployment>();
        
        // Parse bsctest deploy info
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
        let mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        let mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        let primaryVault = primaryvaultFactory.attach(json.mozaicVault);  // Because primaryChain is goerli now.
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

        await initMozaics(primaryChainId, mozaicDeployments);
    })
    beforeEach(async () => {
        // hre.changeNetwork('bsctest');
        // [owner] = await ethers.getSigners();
    })
    describe ('StargateDriver.execute', () => {
        it ("can stake token", async () => {
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const chainId = exportData.testnetTestConstants.chainIds[1];// Bsc
            const vault = mozaicDeployments.get(chainId)!.mozaicVault;
            const coinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinContract = MockTokenFactory.attach(coinAddr);
            const lpStakingAddr = await vault.stargateLpStaking();
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const decimals = await coinContract.decimals();
            console.log("bsctest USDT decimals", decimals);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            
            // Mint USDC to SecondaryVault
            console.log("Before mint, SecondaryVault has token:", (await coinContract.balanceOf(vault.address)).toString());
            let tx = await coinContract.connect(owner).mint(vault.address, amountLD);
            await tx.wait();
            console.log("After mint, SecondaryVault has token:", (await coinContract.balanceOf(vault.address)).toString());
            
            // Check LpTokens for vault in LpStaking
            const amountLPStakedBefore = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount; // pool index in bsctest: 0 USDT, 1 BUSD
            console.log("Before stake: LpTokens for SecondaryVault in LpStaking is", amountLPStakedBefore.toString());

            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            console.log("payloadStake", payload);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            tx = await vault.connect(owner).executeActions([stakeAction]);
            await tx.wait();
            console.log("After stake SecondaryVault has token:", (await coinContract.balanceOf(vault.address)).toString());

            // Check LpTokens for vault in LpStaking
            const amountLPStakedAfter = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount;
            console.log("After stake LpTokens for SecondaryVault in LpStaking is", amountLPStakedAfter.toString());
            expect(amountLPStakedAfter).gt(amountLPStakedBefore);
        })
        it ("can unstake USDC", async () => {
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const chainId = exportData.testnetTestConstants.chainIds[1];// Bsc
            const vault = mozaicDeployments.get(chainId)!.mozaicVault;
            const coinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinContract = MockTokenFactory.attach(coinAddr);
            const lpStakingAddr = await vault.stargateLpStaking();
            const lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const lpStaking = lpStakingFactory.attach(lpStakingAddr);
            const decimals = await coinContract.decimals();
            console.log("bsctest USDT decimals", decimals);
            const amountLD = ethers.utils.parseUnits("1", decimals);
            
            // Mint USDC to SecondaryVault
            console.log("Before mint, SecondaryVault has token:", (await coinContract.balanceOf(vault.address)).toString());
            let tx = await coinContract.connect(owner).mint(vault.address, amountLD);
            await tx.wait();
            console.log("After mint, SecondaryVault has token:", (await coinContract.balanceOf(vault.address)).toString());
            
            // Check LpTokens for vault in LpStaking
            const amountLPStakedBefore = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount; // pool index in bsctest: 0 USDT, 1 BUSD
            console.log("Before stake: LpTokens for SecondaryVault in LpStaking is", amountLPStakedBefore.toString());

            // SecondaryVault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            tx = await vault.connect(owner).executeActions([stakeAction]);
            await tx.wait();
            console.log("After stake SecondaryVault has token:", (await coinContract.balanceOf(vault.address)).toString());

            // Check LpTokens for vault in LpStaking
            let amountLPStaked = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount;
            console.log("After stake LpTokens for SecondaryVault in LpStaking is", amountLPStaked.toString());

            const amountCoinBefore = await coinContract.balanceOf(vault.address);

            // Unstake
            // SecondaryVault unstake LPToken
            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLPStaked, coinContract.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };

            tx = await vault.connect(owner).executeActions([unstakeAction]);
            await tx.wait();

            // Check USDC in secondaryVault
            const amountCoinAfter = await coinContract.balanceOf(vault.address);
            console.log("After unstake SecondaryVault has token:", amountCoinAfter.toString());
            expect(amountCoinAfter).gt(amountCoinBefore);

            // Check LpTokens for vault in LpStaking
            amountLPStaked = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount;
            console.log("After unstake LpTokens for SecondaryVault in LpStaking is", amountLPStaked);
        })
        it.only ("can swapRemote", async () => {
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const srcChainId = exportData.testnetTestConstants.chainIds[1];  // Bsc
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            console.log("srcVault", srcChainId, srcVault.address);
            const srcTokenAddr = exportData.testnetTestConstants.stablecoins.get(srcChainId)!.get("USDT")!;
            const srcMockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const srcToken = srcMockTokenFactory.attach(srcTokenAddr);
            const decimalsSrc = await srcToken.decimals();
            const amountSrc = ethers.utils.parseUnits("30", decimalsSrc);
            const amountStakeSrc = ethers.utils.parseUnits("10", decimalsSrc);
            const amountSwap = ethers.utils.parseUnits("4", decimalsSrc);

            // Mint srcToken to srcVault
            let tx = await srcToken.connect(owner).mint(srcVault.address, amountSrc);
            await tx.wait();
            let amountMinted = await srcToken.balanceOf(srcVault.address);
            console.log("srcVault has srcToken:", amountMinted.toString());
            
            // srcVault stake srcToken
            const srcPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeSrc, srcToken.address]);
            const stakeActionSrc: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : srcPayload
            };
            tx = await srcVault.connect(owner).executeActions([stakeActionSrc]);
            await tx.wait();
            const amountSrcBefore = await srcToken.balanceOf(srcVault.address);
            console.log("After src stake, srcvault has srcToken %d", amountSrcBefore.toString());

            hre.changeNetwork('fantom');
            [owner] = await ethers.getSigners();
            const dstChainId = exportData.testnetTestConstants.chainIds[2];  // Fantom
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            console.log("dstVault", dstChainId, dstVault.address);
            const dstPoolId = exportData.testnetTestConstants.poolIds.get("USDC")!;
            const dstTokenAddr = exportData.testnetTestConstants.stablecoins.get(dstChainId)!.get("USDC")!;
            const dstMockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const dstToken = dstMockTokenFactory.attach(dstTokenAddr);
            const decimalsDst = await dstToken.decimals();
            const amountDst = ethers.utils.parseUnits("30", decimalsDst);
            const amountStakeDst = ethers.utils.parseUnits("20", decimalsDst);

            // Mint dstToken to dstVault
            tx = await dstToken.connect(owner).mint(dstVault.address, amountDst);
            await tx.wait();
            amountMinted = await dstToken.balanceOf(dstVault.address);
            console.log("dstVault has dstToken:", amountMinted.toString());
            
            // dstVault stake dstToken
            const dstPayload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStakeDst, dstToken.address]);
            const stakeActionDst: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : dstPayload
            };
            tx = await dstVault.connect(owner).executeActions([stakeActionDst]);
            await tx.wait();
            const amountDstBefore = await dstToken.balanceOf(dstVault.address);
            console.log("After dst stake, dstVault has dstToken %d", amountDstBefore.toString());

            // SwapRemote: Ethereum USDT -> BSC USDT
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountSwap, srcToken.address, dstChainId, dstPoolId]);
            console.log("payloadSwapRemote", payloadSwapRemote);
            console.log("owner", owner.address);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            const fee = ethers.utils.parseEther("0.3");
            await srcVault.connect(owner).receiveNativeToken({value: fee});
            tx = await srcVault.connect(owner).executeActions([swapRemoteAction]);
            await tx.wait();
            console.log("executeActions tx hash", tx.hash);

            // Check both tokens
            const amountSrcRemain = await srcToken.balanceOf(srcVault.address);
            hre.changeNetwork('fantom');
            const amountDstRemain = await dstToken.balanceOf(dstVault.address);
            console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain.toString(), amountDstRemain.toString());
            expect(amountSrcRemain).lessThan(amountSrcBefore);
            expect(amountDstRemain).greaterThan(amountDstBefore);
        })
    })
    describe ('PancakeSwapDriver.execute', () => {
        it ("can swap BUSD->USDT", async () => {
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const chainId = exportData.testnetTestConstants.chainIds[1];// bsc
            const vault = mozaicDeployments.get(chainId)!.mozaicVault;
            const busdCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("BUSD")!;
            const MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const busdCoin = MockTokenFactory.attach(busdCoinAddr);
            const usdtCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const usdtCoin = MockTokenFactory.attach(usdtCoinAddr);
            const decimalsBUSD = await busdCoin.decimals();
            const amountLD = ethers.utils.parseUnits("1", decimalsBUSD); 
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, busdCoinAddr, usdtCoinAddr]);
            
            // Mint BUSD to vault
            console.log("Before mint, vault has token:", (await busdCoin.balanceOf(vault.address)).toString());
            let tx = await busdCoin.connect(owner).mint(vault.address, amountLD);
            await tx.wait();
            console.log("After mint, vault has token:", (await busdCoin.balanceOf(vault.address)).toString());

            const amountBUSDBefore = await busdCoin.balanceOf(vault.address);
            const amountUSDTBefore = await usdtCoin.balanceOf(vault.address)
            console.log("Before swap, vault has BUSD, USDT:", amountBUSDBefore.toString(), amountUSDTBefore.toString());
            
            // Swap BUSD to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            tx = await vault.connect(owner).executeActions([swapAction]);
            await tx.wait();

            // Check USDT amount of vault
            const amountBUSDAfter = await busdCoin.balanceOf(vault.address);
            const amountUSDTAfter = await usdtCoin.balanceOf(vault.address)
            console.log("Now vault has BUSD, USDT:", amountBUSDAfter.toString(), amountUSDTAfter.toString());
            expect(amountBUSDAfter).lt(amountBUSDBefore);
            expect(amountUSDTAfter).gt(amountUSDTBefore);
        })
        it ("can swap STG->USDC", async () => {
            hre.changeNetwork('fantom');
            [owner] = await ethers.getSigners();
            const chainId = exportData.testnetTestConstants.chainIds[2];// fantom
            const vault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgTokenAddr = await vault.stargateToken();
            const stgTokenFactory = (await ethers.getContractFactory("StargateToken", owner)) as StargateToken__factory;
            const stgToken = stgTokenFactory.attach(stgTokenAddr);
            const usdcCoinAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const usdcCoin = MockTokenFactory.attach(usdcCoinAddr);
            const decimals = await stgToken.decimals();
            const amountLD = ethers.utils.parseUnits("1", decimals);
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgTokenAddr, usdcCoinAddr]);
    
            // Send STG to vault
            console.log("Before transfer, vault has STG", await stgToken.balanceOf(vault.address));
            let tx = await stgToken.connect(owner).approve(vault.address, amountLD);
            await tx.wait();
            tx = await stgToken.connect(owner).transfer(vault.address, amountLD);
            await tx.wait();
            const amountSTGBefore = await stgToken.balanceOf(vault.address);
            const amountUSDCBefore = await usdcCoin.balanceOf(vault.address)
            console.log("After transfer, vault has STG, usdc:", amountSTGBefore, amountUSDCBefore);
            
            // Swap STG to usdc
            const swapAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            tx = await vault.connect(owner).executeActions([swapAction]);
            await tx.wait();
    
            // Check usdc amount of vault
            const amountSTGAfter = await stgToken.balanceOf(vault.address);
            const amountUSDCAfter = await usdcCoin.balanceOf(vault.address)
            console.log("After swap, vault has STG, usdc:", amountSTGAfter, amountUSDCAfter);
            expect(amountSTGAfter).lt(amountSTGBefore);
            expect(amountUSDCAfter).gt(amountUSDCBefore);
        })
    })
    describe ('Flow test', () => {
        it ('normal flow', async () => {
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            const primaryChainId = exportData.testnetTestConstants.chainIds[1];
            const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
            const tokenAPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDT")!;
            let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenAPrimary = MockTokenFactory.attach(tokenAPrimaryAddr);
            const decimalsA = await tokenAPrimary.decimals();
            const aliceTotalLD = ethers.utils.parseUnits("10", decimalsA);
            const aliceDeposit1LD = ethers.utils.parseUnits("3", decimalsA);
            const aliceDeposit2LD = ethers.utils.parseUnits("4", decimalsA);
            // Mint tokens
            let tx = await tokenAPrimary.connect(owner).mint(alice.address, aliceTotalLD);
            await tx.wait();

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            const secondaryChainId = exportData.testnetTestConstants.chainIds[2];
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            const tokenBSecondaryAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDC")!;
            MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenBSecondary = MockTokenFactory.attach(tokenBSecondaryAddr);
            const decimalsB = await tokenBSecondary.decimals();
            const benTotalLD = ethers.utils.parseUnits("20", decimalsB);
            const benDepositLD = ethers.utils.parseUnits("5", decimalsB);
            const benWithdrawMLP = ethers.utils.parseUnits("3", decimalsB);
            // Mint tokens
            tx = await tokenBSecondary.connect(owner).mint(ben.address, benTotalLD);
            await tx.wait();

            // ----------------------- First Round: ----------------------------
            console.log("First Round:");
            // Algostory: ### 1. User Books Deposit
            // Alice -> PrimaryVault Token A
            // Ben -> SecondaryVault Token B
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await tokenAPrimary.connect(alice).approve(primaryVault.address, aliceDeposit1LD);
            await tx.wait();
            tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenAPrimary.address, primaryChainId);
            await tx.wait();

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await tokenBSecondary.connect(ben).approve(secondaryVault.address, benDepositLD);
            await tx.wait();
            tx = await secondaryVault.connect(ben).addDepositRequest(benDepositLD, tokenBSecondary.address, secondaryChainId);
            await tx.wait();

            // Check Pending Request Buffer
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            expect(await primaryVault.getTotalDepositRequest(false)).to.eq(aliceDeposit1LD.add(benDepositLD));
            expect(await primaryVault.getDepositRequestAmount(false, alice.address, tokenAPrimary.address, primaryChainId)).to.eq(aliceDeposit1LD);

            // Algostory: #### 3-1. Session Start (Protocol Status: Idle -> Optimizing)
            tx = await primaryVault.connect(owner).initOptimizationSession();
            await tx.wait();
            // Protocol Status : IDLE -> OPTIMIZING
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // Algostory: #### 3-2. Take Snapshot and Report
            console.log("ChainId %d, primaryVault %s", primaryChainId, primaryVault.address);
            tx = await primaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await primaryVault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            await tx.wait();

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            console.log("ChainId %d, secondaryVault %s", secondaryChainId, secondaryVault.address);
            tx = await secondaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await secondaryVault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            await tx.wait();
            
            // Alice adds to pending request pool, but this should not affect minted mLP amount.
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await tokenAPrimary.connect(alice).approve(primaryVault.address, aliceDeposit2LD);
            await tx.wait();
            tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit2LD, tokenAPrimary.address, primaryChainId);
            await tx.wait();

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
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).settleRequestsAllVaults();
            await tx.wait();
            expect(await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address)).to.eq(aliceDeposit1LD);  // mLP eq to SD

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).reportSettled();
            await tx.wait();
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address)).to.eq(benDepositLD);     // mLP eq to SD

            // Algostory: #### 6. Session Closes
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);

            // Second Round:
            console.log("Second Round:");
            // Alice's booked deposit request 4k now turns into staged from pending.
            // Ben books withdraw (half of his mLP)
            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            const benMLPBefore = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benCoinBefore = await tokenBSecondary.balanceOf(ben.address);
            console.log("ben:", ben.address);
            console.log("benMLPBefore", benMLPBefore, "benCoinBefore", benCoinBefore);
            tx = await secondaryVault.connect(ben).addWithdrawRequest(benWithdrawMLP, tokenBSecondary.address, secondaryChainId);
            await tx.wait();
            
            // Settle Requests
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).initOptimizationSession();
            await tx.wait();
            tx = await primaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await primaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0")});
            await tx.wait();

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await secondaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0.1")});
            await tx.wait();

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            console.log("before", await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address));
            tx = await primaryVault.settleRequestsAllVaults({value:ethers.utils.parseEther("0.1")});
            await tx.wait();
            console.log("after", await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address));

            expect(await primaryVault.getTotalDepositRequest(true)).to.eq(0);
            console.log(await primaryVault.getTotalDepositRequest(true));
            // console.log(txresult);
            // console.log("wait for settling");
            // await new Promise( resolve => setTimeout(resolve, 5000) );
            // console.log("settled");

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.reportSettled({value:ethers.utils.parseEther("0.1")});
            await tx.wait();
            const benMLPAfter = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benCoinAfter = await tokenBSecondary.balanceOf(ben.address);
            console.log("benMLPAfter", benMLPAfter, "benCoinAfter", benCoinAfter);
            expect(benMLPBefore.sub(benMLPAfter)).to.eq(benWithdrawMLP);
            expect(benCoinAfter.sub(benCoinBefore)).to.eq(benWithdrawMLP);
            // settle requests

        })
        it ('single chain flow', async () => {
            [owner, alice, ben] = await ethers.getSigners();
            const chainId = exportData.testnetTestConstants.chainIds[0];
            const vault = mozaicDeployments.get(chainId)!.mozaicVault as PrimaryVault;
            const mozLp = mozaicDeployments.get(chainId)!.mozaicLp as MozaicLP;
            const MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenAPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDC")!;
            const tokenAPrimary = MockTokenFactory.attach(tokenAPrimaryAddr);
            const tokenBPrimaryAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get("USDT")!;
            const tokenBPrimary = MockTokenFactory.attach(tokenBPrimaryAddr);
            
            const decimalsA = await tokenAPrimary.decimals();
            const aliceTotalLD = ethers.utils.parseUnits("10", decimalsA);
            const aliceDeposit1LD = ethers.utils.parseUnits("3", decimalsA);
            const aliceDeposit2LD = ethers.utils.parseUnits("4", decimalsA);
            const decimalsB = await tokenBPrimary.decimals();
            const benTotalLD = ethers.utils.parseUnits("20", decimalsB);
            const benDepositLD = ethers.utils.parseUnits("5", decimalsB);
            const benWithdrawMLP = ethers.utils.parseUnits("3", decimalsB);

            // Mint tokens
            let tx = await tokenAPrimary.connect(owner).mint(alice.address, aliceTotalLD);
            await tx.wait();
            tx = await tokenBPrimary.connect(owner).mint(ben.address, benTotalLD);
            await tx.wait();

            // ----------------------- First Round: ----------------------------
            console.log("First Round:");
            // Algostory: ### 1. User Books Deposit
            // Alice -> PrimaryVault Token A
            // Ben -> PrimaryVault Token B
            let totalDepositRequestPendingBefore = await vault.getTotalDepositRequest(false);
            let depositRequestPendingBefore = await vault.getDepositRequestAmount(false, alice.address, tokenAPrimary.address, chainId);

            tx = await tokenAPrimary.connect(alice).approve(vault.address, aliceDeposit1LD);
            await tx.wait();
            tx = await vault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenAPrimary.address, chainId);
            await tx.wait();

            tx = await tokenBPrimary.connect(ben).approve(vault.address, benDepositLD);
            await tx.wait();
            tx = await vault.connect(ben).addDepositRequest(benDepositLD, tokenBPrimary.address, chainId);
            await tx.wait();

            // Check Pending Request Buffer
            let totalDepositRequestPending = await vault.getTotalDepositRequest(false);
            console.log("totalDepositRequestPending %d, totalDepositRequestPendingBefore %d, aliceDeposit1LD %d, benDepositLD %d", totalDepositRequestPending, totalDepositRequestPendingBefore, aliceDeposit1LD, benDepositLD);
            expect(totalDepositRequestPending.sub(totalDepositRequestPendingBefore)).to.eq(aliceDeposit1LD.add(benDepositLD));
            let depositRequestPending = await vault.getDepositRequestAmount(false, alice.address, tokenAPrimary.address, chainId);
            console.log("depositRequestPending %d, depositRequestPendingBefore %d, aliceDeposit1LD %d", depositRequestPending, depositRequestPendingBefore, aliceDeposit1LD);
            expect(depositRequestPending.sub(depositRequestPendingBefore)).to.eq(aliceDeposit1LD);

            // Algostory: #### 3-1. Session Start (Protocol Status: Idle -> Optimizing)
            tx = await vault.connect(owner).initOptimizationSession();
            await tx.wait();
            // Protocol Status : IDLE -> OPTIMIZING
            expect(await vault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // Algostory: #### 3-2. Take Snapshot and Report
            console.log("ChainId %d, Vault %s", chainId, vault.address);
            tx = await vault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await vault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            await tx.wait();

            // Alice adds to pending request pool, but this should not affect minted mLP amount.
            let totalDepositRequestStagedBefore = await vault.getTotalDepositRequest(true);
            totalDepositRequestPendingBefore = await vault.getTotalDepositRequest(false);

            tx = await tokenAPrimary.connect(alice).approve(vault.address, aliceDeposit2LD);
            await tx.wait();
            tx = await vault.connect(alice).addDepositRequest(aliceDeposit2LD, tokenAPrimary.address, chainId);
            await tx.wait();

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
            await tx.wait();
            
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
            await tx.wait();

            // Settle Requests
            tx = await vault.connect(owner).initOptimizationSession();
            await tx.wait();
            tx = await vault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await vault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            await tx.wait();
            // console.log("before", await mozLp.balanceOf(alice.address));
            tx = await vault.settleRequestsAllVaults();
            await tx.wait();
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