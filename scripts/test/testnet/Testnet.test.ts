import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, Bridge__factory, StargateToken__factory, MockToken__factory, PrimaryVault, SecondaryVault, LPStaking__factory, MozaicLP, Router__factory } from '../../../types/typechain';
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
        
        await initMozaics(mozaicDeployments);
    })
    beforeEach(async () => {
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        const primaryChainId = exportData.testnetTestConstants.chainIds[1];
        const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault;
        let amountReturn = await primaryVault.connect(owner).returnNativeToken();
        console.log("bscVault returned %d ETH", amountReturn);

        hre.changeNetwork('fantom');
        [owner] = await ethers.getSigners();
        const secondaryChainId = exportData.testnetTestConstants.chainIds[2];
        const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault;
        amountReturn = await secondaryVault.connect(owner).returnNativeToken();
        console.log("fantomVault returned %d ETH", amountReturn);
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
        it ("can swapRemote", async () => {
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const srcChainId = exportData.testnetTestConstants.chainIds[1];  // Bsc
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            const srcMockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const srcTokenAddr = exportData.testnetTestConstants.stablecoins.get(srcChainId)!.get("USDT")!;
            const srcToken = srcMockTokenFactory.attach(srcTokenAddr);
            const srcDecimals = await srcToken.decimals();
            console.log("USDT srcDecimals", srcDecimals);
            const amountSrc = ethers.utils.parseUnits("1", srcDecimals);
            const amountSwap = amountSrc;

            // Mint srcToken to srcVault
            let tx = await srcToken.connect(owner).mint(srcVault.address, amountSrc);
            await tx.wait();
            const amountSrcBefore = await srcToken.balanceOf(srcVault.address);
            
            hre.changeNetwork('fantom');
            [owner] = await ethers.getSigners();
            const dstChainId = exportData.testnetTestConstants.chainIds[2];  // Fantom
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            const dstPoolId = exportData.testnetTestConstants.poolIds.get("USDC")!;
            const dstTokenAddr = exportData.testnetTestConstants.stablecoins.get(dstChainId)!.get("USDC")!;
            const dstMockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const dstToken = dstMockTokenFactory.attach(dstTokenAddr);
            const amountDstBefore = await dstToken.balanceOf(dstVault.address);
            console.log("Before swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcBefore.toString(), amountDstBefore.toString());
            
            // SwapRemote: Ethereum USDT -> BSC USDT
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();

            // send nativeFee to srcVault
            const routerFactory = await ethers.getContractFactory('Router', owner) as Router__factory;
            const routerAddr = exportData.testnetTestConstants.routers.get(srcChainId)!;
            const router = routerFactory.attach(routerAddr);
            const TYPE_SWAP_REMOTE = 1;   // Bridge.TYPE_SWAP_REMOTE = 1
            const [nativeFee, zroFee] = await router.quoteLayerZeroFee(dstChainId, TYPE_SWAP_REMOTE, dstTokenAddr, "0x", ({
                dstGasForCall: 0,       // extra gas, if calling smart contract,
                dstNativeAmount: 0,     // amount of dust dropped in destination wallet 
                dstNativeAddr: "0x" // destination wallet for dust
            }));
            console.log("nativeFee %d, zroFee %d", nativeFee.toString(), zroFee.toString());
            tx = await owner.sendTransaction({
                to: srcVault.address,
                value: nativeFee
            });
            await tx.wait();
            console.log("srcVault received nativeToken", nativeFee.toString());

            // swapRemote
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256","uint256"], [amountSwap, srcTokenAddr, dstChainId, dstPoolId, nativeFee]);
            console.log("payloadSwapRemote", payloadSwapRemote);
            console.log("owner", owner.address);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            tx = await srcVault.connect(owner).executeActions([swapRemoteAction]);
            console.log("swapRemote executeActions tx hash", tx.hash);
            await tx.wait();

            // Check both tokens
            const amountSrcRemain = await srcToken.balanceOf(srcVault.address);
            hre.changeNetwork('fantom');
            const amountDstRemain = await dstToken.balanceOf(dstVault.address);
            console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain.toString(), amountDstRemain.toString());
            expect(amountSrcRemain).lessThan(amountSrcBefore);
            // expect(amountDstRemain).greaterThan(amountDstBefore);
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
            let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenAAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDT")!;
            const tokenA = MockTokenFactory.attach(tokenAAddr);
            const decimalsA = await tokenA.decimals();
            console.log("tokenA decimals", decimalsA);
            const aliceTotalLD_A = ethers.utils.parseUnits("10", decimalsA);
            const aliceDeposit1LD_A = ethers.utils.parseUnits("3", decimalsA);
            const aliceDeposit2LD_A = ethers.utils.parseUnits("2", decimalsA);
            const tokenBAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("BUSD")!;
            const tokenB = MockTokenFactory.attach(tokenBAddr);
            const decimalsB = await tokenB.decimals();
            console.log("tokenB decimals", decimalsB);
            const benTotalLD_B = ethers.utils.parseUnits("20", decimalsB);
            const benDepositLD_B = ethers.utils.parseUnits("7", decimalsB);
            // Mint tokens
            let tx = await tokenA.connect(owner).mint(alice.address, aliceTotalLD_A);
            await tx.wait();
            tx = await tokenB.connect(owner).mint(ben.address, benTotalLD_B);
            await tx.wait();

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            const secondaryChainId = exportData.testnetTestConstants.chainIds[2]; // Fantom
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const tokenCAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDC")!;
            const tokenC = MockTokenFactory.attach(tokenCAddr);
            const decimalsC = await tokenC.decimals();
            console.log("tokenC decimals", decimalsC);
            const benTotalLD_C = ethers.utils.parseUnits("15", decimalsC);
            const benDepositLD_C = ethers.utils.parseUnits("5", decimalsC);
            // Mint tokens
            tx = await tokenC.connect(owner).mint(ben.address, benTotalLD_C);
            await tx.wait();

            // ----------------------- First Round: ----------------------------
            console.log("First Round:");

            // Algostory: ### 1. User Books Deposit
            console.log("1. User books deposit");

            // get amounts before in pending buffer
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            let totalDepositAmountBefore = await primaryVault.getTotalDepositAmount(false);
            let aliceDepositAmountBefore = await primaryVault.getDepositAmount(false, alice.address, tokenA.address, primaryChainId);
            let depositAmountPerTokenABefore = await primaryVault.getDepositAmountPerToken(false, tokenA.address);
            
            // alice deposits to primaryVault
            console.log("Alice deposits tokenA to primaryVault");
            tx = await tokenA.connect(alice).approve(primaryVault.address, aliceDeposit1LD_A);
            await tx.wait();
            tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit1LD_A, tokenA.address, primaryChainId);
            await tx.wait();

            // ben deposits to primaryVault
            console.log("Ben deposits tokenB to primaryVault");
            tx = await tokenB.connect(ben).approve(primaryVault.address, benDepositLD_B);
            await tx.wait();
            tx = await primaryVault.connect(ben).addDepositRequest(benDepositLD_B, tokenB.address, primaryChainId);
            await tx.wait();

            // check pending buffer
            let totalDepositAmount = await primaryVault.getTotalDepositAmount(false);
            expect(totalDepositAmount.sub(totalDepositAmountBefore)).to.eq(aliceDeposit1LD_A.add(benDepositLD_B));
            let aliceDepositAmount = await primaryVault.getDepositAmount(false, alice.address, tokenA.address, primaryChainId);
            expect(aliceDepositAmount.sub(aliceDepositAmountBefore)).to.eq(aliceDeposit1LD_A);
            let depositAmountPerTokenA = await primaryVault.getDepositAmountPerToken(false, tokenA.address);
            expect(depositAmountPerTokenA.sub(depositAmountPerTokenABefore)).to.eq(aliceDeposit1LD_A);

            // ben deposits to secondaryVault
            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            console.log("Ben deposits tokenC to secondaryVault");
            tx = await tokenC.connect(ben).approve(secondaryVault.address, benDepositLD_C);
            await tx.wait();
            tx = await secondaryVault.connect(ben).addDepositRequest(benDepositLD_C, tokenC.address, secondaryChainId);
            await tx.wait();

            // Algostory: #### 3-1. Session Start (Protocol Status: IDLE -> OPTIMIZING)
            console.log("3. Start optimizing");
            
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);
            tx = await primaryVault.connect(owner).initOptimizationSession();
            await tx.wait();
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // Algostory: #### 3-2. Take Snapshot and Report
            console.log("Take and report snapshot");

            // For primaryVault
            console.log("For primaryVault");
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await primaryVault.connect(owner).reportSnapshot();
            await tx.wait();

            // For secondaryVault, switch network
            console.log("For secondaryVault");
            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await secondaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0.1")});
            await tx.wait();
            
            // Alice deposits again, but it goes to pending buffer, so cannot affect minted mLP amount.
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            let pendingDepositAmountBefore = await primaryVault.getTotalDepositAmount(false);
            let stagedDepositAmountBefore = await primaryVault.getTotalDepositAmount(true);
            
            console.log("Alice deposits again");
            tx = await tokenA.connect(alice).approve(primaryVault.address, aliceDeposit2LD_A);
            await tx.wait();
            tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit2LD_A, tokenA.address, primaryChainId);
            await tx.wait();

            // check pending request amounts: increased
            let pendingDepositAmount = await primaryVault.getTotalDepositAmount(false);
            expect(pendingDepositAmount.sub(pendingDepositAmountBefore)).to.eq(aliceDeposit2LD_A);
            // check staged request amounts: didn't changed
            let stagedDepositAmount = await primaryVault.getTotalDepositAmount(true);
            expect(stagedDepositAmount).to.eq(stagedDepositAmountBefore);

            // Primary vault now has all snapshot reports.
            expect(await primaryVault.allVaultsSnapshotted()).to.eq(true);
            
            // Algostory: #### 3-3. Determine MLP per Stablecoin Rate
            console.log("Determine MLP per stablecoin rate");
            // Initial rate is 1 mLP per USD
            const mozaicLpPerStablecoin = await primaryVault.mozaicLpPerStablecoinMil();
            expect(mozaicLpPerStablecoin).to.eq(1000000);

            // Algostory: ### 4. Execute Asset Transition
            console.log("4. Execute Asset Transition");
            
            // control center orders: 
            // primaryVault stake 2 USDT and receive LpToken
            // primaryVault unstake LpToken and redeem USDT
            // primaryVault swap 1 USDT to BUSD
            // primaryVault swapRemote 1 BUSD with USDC of secondaryVault

            // 4.1. Stake - primaryVault stake 2 USDT and receive LpToken
            console.log("4.1. Stake");

            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const primaryLpStakingAddr = await primaryVault.stargateLpStaking();
            const primaryLpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            const primaryLpStaking = primaryLpStakingFactory.attach(primaryLpStakingAddr);
            const amountStake = ethers.utils.parseUnits("1", decimalsA);
            
            // Check token and lpStaked
            const amountTokenBefore = await tokenA.connect(owner).balanceOf(primaryVault.address);
            const amountLPStakedBefore = (await primaryLpStaking.userInfo(BigNumber.from("0"), primaryVault.address)).amount; // pool index in bsctest: 0 USDT, 1 BUSD
            console.log("Before stake: token %d, LpStaked %d", amountTokenBefore.toString(), amountLPStakedBefore.toString());

            // primaryVault stake USDC
            const payloadStake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountStake, tokenAAddr]);
            console.log("payloadStake", payloadStake);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payloadStake
            };
            tx = await primaryVault.connect(owner).executeActions([stakeAction]);
            await tx.wait();

            // Check token and lpStaked
            const amountToken = await tokenA.connect(owner).balanceOf(primaryVault.address);
            const amountLPStaked = (await primaryLpStaking.userInfo(BigNumber.from("0"), primaryVault.address)).amount;
            console.log("After stake: token %d, LpStaked %d", amountToken.toString(), amountLPStaked.toString());
            expect(amountToken).lt(amountTokenBefore);
            expect(amountLPStaked).gt(amountLPStakedBefore);

            // 4.2. Unstake - primaryVault unstake LpToken and redeem USDT
            console.log("4.2. Unstake");

            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();

            const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLPStaked, tokenA.address]);
            const unstakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateUnstake,
                payload : payloadUnstake
            };

            tx = await primaryVault.connect(owner).executeActions([unstakeAction]);
            await tx.wait();

            // Check token and lpStaked
            const amountTokenAfter = await tokenA.connect(owner).balanceOf(primaryVault.address);
            const amountLPStakedAfter = (await primaryLpStaking.userInfo(BigNumber.from("0"), primaryVault.address)).amount;
            console.log("After unstake: token %d, LpStaked %d", amountTokenAfter.toString(), amountLPStakedAfter.toString());
            expect(amountTokenAfter).gt(amountToken);
            expect(amountLPStakedAfter).lt(amountLPStaked);

            // 4.3. Swap - primaryVault swap 1 USDT to BUSD
            console.log("4.3. Swap");

            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const amountSwap = ethers.utils.parseUnits("1", decimalsA); 
            const payloadSwap = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountSwap, tokenAAddr, tokenBAddr]);
            const amountUSDTBefore = await tokenA.balanceOf(primaryVault.address);
            const amountBUSDBefore = await tokenB.balanceOf(primaryVault.address);
            console.log("Before swap, primavyVault has USDT %d, BUSD %d", amountUSDTBefore.toString(), amountBUSDBefore.toString());

            // Swap USDT to BUSD
            const swapAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payloadSwap
            };
            tx = await primaryVault.connect(owner).executeActions([swapAction]);
            await tx.wait();

            // Check USDT amount of vault
            const amountUSDTAfter = await tokenA.balanceOf(primaryVault.address)
            const amountBUSDAfter = await tokenB.balanceOf(primaryVault.address);
            console.log("After swap, primaryVault has USDT %d, BUSD %d", amountUSDTAfter.toString(), amountBUSDAfter.toString());
            expect(amountUSDTAfter).lt(amountUSDTBefore);
            expect(amountBUSDAfter).gt(amountBUSDBefore);

            // 4.4. SwapRemote - primaryVault swapRemote 1 BUSD with USDC of secondaryVault
            console.log("4.4. SwapRemote");

            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const amountSrcBefore = await tokenB.balanceOf(primaryVault.address);

            hre.changeNetwork('fantom');
            [owner] = await ethers.getSigners();
            const srcChainId = primaryChainId;
            const dstChainId = secondaryChainId;
            const dstPoolId = exportData.testnetTestConstants.poolIds.get("USDC")!;
            const amountDstBefore = await tokenC.balanceOf(secondaryVault.address);
            const amountSwapRemote = ethers.utils.parseUnits("1", decimalsB);
            console.log("Before swapRemote, primaryVault has tokenB %d, secondaryVault has tokenC %d", amountSrcBefore.toString(), amountDstBefore.toString());

            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();

            // send nativeFee to srcVault
            const routerFactory = await ethers.getContractFactory('Router', owner) as Router__factory;
            const routerAddr = exportData.testnetTestConstants.routers.get(srcChainId)!;
            const router = routerFactory.attach(routerAddr);
            const TYPE_SWAP_REMOTE = 1;   // Bridge.TYPE_SWAP_REMOTE = 1
            const [nativeFee, zroFee] = await router.quoteLayerZeroFee(dstChainId, TYPE_SWAP_REMOTE, tokenCAddr, "0x", ({
                dstGasForCall: 0,       // extra gas, if calling smart contract,
                dstNativeAmount: 0,     // amount of dust dropped in destination wallet 
                dstNativeAddr: "0x" // destination wallet for dust
            }));
            console.log("nativeFee %d, zroFee %d", nativeFee.toString(), zroFee.toString());
            tx = await owner.sendTransaction({
                to: primaryVault.address,
                value: nativeFee
            });
            await tx.wait();
            console.log("primaryVault received nativeToken", nativeFee.toString());

            // swapRemote
            const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256","uint256"], [amountSwapRemote, tokenBAddr, dstChainId, dstPoolId, nativeFee]);
            console.log("payloadSwapRemote", payloadSwapRemote);
            const swapRemoteAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.SwapRemote,
                payload : payloadSwapRemote
            };
            tx = await primaryVault.connect(owner).executeActions([swapRemoteAction]);
            await tx.wait();
            console.log("swapRemote executeActions tx hash", tx.hash);

            // Check both tokens
            const amountSrcRemain = await tokenB.balanceOf(primaryVault.address);
            hre.changeNetwork('fantom');
            const amountDstRemain = await tokenC.balanceOf(secondaryVault.address);
            console.log("After swapRemote, primaryVault has tokenB %d, secondaryVault has tokenC %d", amountSrcRemain.toString(), amountDstRemain.toString());
            expect(amountSrcRemain).lt(amountSrcBefore);
            // expect(amountDstRemain).greaterThan(amountDstBefore);    // kevin

            // Algostory: #### 5. Settle Requests
            console.log("5. Settle Requests");

            // Alice, Ben receive mLP, Vaults receive coin
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).settleRequestsAllVaults();
            await tx.wait();
            expect(await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address)).to.eq(aliceDeposit1LD_A);  // mLP eq to SD
            expect(await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(ben.address)).to.eq(benDepositLD_B);  // mLP eq to SD

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).reportSettled();
            await tx.wait();
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address)).to.eq(benDepositLD_C);     // mLP eq to SD

            // Algostory: #### 6. Session Closes
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);

            // Second Round:
            console.log("Second Round:");
            // Alice's booked deposit request now turns into staged from pending.
            // Ben books withdraw (half of his mLP)
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            const benMLPBefore = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benTokenBBefore = await tokenB.balanceOf(ben.address);
            const benWithdrawMLP = benMLPBefore;    // withdraw whole mLP
            console.log("benMLPBefore %d, benTokenBefore %d", benMLPBefore, benTokenBBefore);
            tx = await primaryVault.connect(ben).addWithdrawRequest(benWithdrawMLP, tokenBAddr, primaryChainId);
            await tx.wait();

            // check
            const benMLPAfter = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(ben.address);
            expect(benMLPAfter).to.eq(benMLPBefore);
            
            // Settle Requests
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await primaryVault.connect(owner).initOptimizationSession();
            await tx.wait();
            tx = await primaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await primaryVault.connect(owner).reportSnapshot();
            await tx.wait();

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            tx = await secondaryVault.connect(owner).takeSnapshot();
            await tx.wait();
            tx = await secondaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0.1")});
            await tx.wait();

            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            const aliceMLPBefore = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address);
            tx = await primaryVault.settleRequestsAllVaults({value:ethers.utils.parseEther("0.1")});
            await tx.wait();
            const aliceMLPAfter = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address);
            console.log("alice mLP before %d, after %d", aliceMLPBefore, aliceMLPAfter);
            expect(aliceMLPAfter).gt(aliceMLPBefore);

            const totalDepositAmountLast = await primaryVault.getTotalDepositAmount(true);
            console.log(totalDepositAmountLast);
            expect(totalDepositAmountLast).to.eq(0);
            // console.log(txresult);
            // console.log("wait for settling");
            // await new Promise( resolve => setTimeout(resolve, 5000) );
            // console.log("settled");

            // settle requests

        })
    })
})