import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, Bridge__factory, StargateToken__factory, MockToken__factory, PrimaryVault, SecondaryVault, LPStaking__factory, MozaicLP, Router__factory, MockToken, LPStaking } from '../../../types/typechain';
import { ActionTypeEnum, ProtocolStatus, MozaicDeployment } from '../../constants/types';
import exportData from '../../constants/index';
import { BigNumber, ContractTransaction } from 'ethers';
import { setTimeout } from 'timers/promises';
import { describe } from 'mocha';
const fs = require('fs');
const hre = require('hardhat');

const TIME_DELAY_MAX = 120000;
const MOZAIC_DECIMALS = 18;

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

        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        // return balance
        let tx = await primaryVault.connect(owner).returnBalance();
        await tx.wait();
        console.log("primaryVault returned balance");
        // send BNB to primaryVault
        const amountBNB = ethers.utils.parseEther("5");
        tx = await owner.sendTransaction({
            to: primaryVault.address,
            value: amountBNB
        });
        await tx.wait();
        console.log("sent BNB to primaryVault", amountBNB.toString());

        hre.changeNetwork('fantom');
        [owner] = await ethers.getSigners();
        //return balance
        tx = await secondaryVault.connect(owner).returnBalance();
        await tx.wait();
        console.log("secondaryVault returned balance");
        // send FTM to secondaryVault
        const amountFTM = ethers.utils.parseEther("100");
        tx = await owner.sendTransaction({
            to: secondaryVault.address,
            value: amountFTM
        });
        await tx.wait();
        console.log("sent native token to secondaryVault", amountFTM.toString());
    })
    after (async () => {
        // return balance from vaults to owner
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        const primaryChainId = exportData.testnetTestConstants.chainIds[1];
        const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault;
        let tx = await primaryVault.connect(owner).returnBalance();
        await tx.wait();
        console.log("primaryVault returned balance");

        hre.changeNetwork('fantom');
        [owner] = await ethers.getSigners();
        const secondaryChainId = exportData.testnetTestConstants.chainIds[2];
        const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault;
        tx = await secondaryVault.connect(owner).returnBalance();
        await tx.wait();
        console.log("secondaryVault returned balance");
    })
    describe.skip ('StargateDriver.execute', () => {
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
            
            // Mint USDT to vault
            console.log("Before mint, vault has token:", (await coinContract.balanceOf(vault.address)).toString());
            let tx = await coinContract.connect(owner).mint(vault.address, amountLD);
            await tx.wait();
            console.log("After mint, vault has token:", (await coinContract.balanceOf(vault.address)).toString());
            
            // Check LpTokens for vault in LpStaking
            const amountLPStakedBefore = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount; // pool index in bsctest: 0 USDT, 1 BUSD
            console.log("Before stake: LpTokens for vault in LpStaking is", amountLPStakedBefore.toString());

            // vault stake USDC
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, coinAddr]);
            console.log("payloadStake", payload);
            const stakeAction: SecondaryVault.ActionStruct  = {
                driverId: exportData.testnetTestConstants.stargateDriverId,
                actionType: ActionTypeEnum.StargateStake,
                payload : payload
            };
            tx = await vault.connect(owner).executeActions([stakeAction]);
            await tx.wait();
            console.log("After stake vault has token:", (await coinContract.balanceOf(vault.address)).toString());

            // Check LpTokens for vault in LpStaking
            const amountLPStakedAfter = (await lpStaking.userInfo(BigNumber.from("0"), vault.address)).amount;
            console.log("After stake LpTokens for vault in LpStaking is", amountLPStakedAfter.toString());
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
        it ("can swapRemote Bsc USDT => Fantom USDC", async () => {
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
            
            // SwapRemote: Bsc USDT -> Fantom USDC
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
            console.log("sent native fee to srcVault", nativeFee.toString());

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
            let amountDstRemain: BigNumber;
            let timeDelayed = 0;
            const timeInterval = 10000;
            let success = false;
            while (timeDelayed < TIME_DELAY_MAX) {
                amountDstRemain = await dstToken.balanceOf(dstVault.address);
                if (amountDstRemain.eq(amountDstBefore)) {
                    console.log("Waiting for LayerZero delay...");
                    await setTimeout(timeInterval);
                    timeDelayed += timeInterval;
                } else {
                    success = true;
                    console.log("LayerZero succeeded in %d seconds", timeDelayed / 1000);
                    console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain.toString(), amountDstRemain.toString());
                    expect(amountDstRemain).gt(amountDstBefore);
                    break;
                }
            }
            if (!success) {
                console.log("Timeout in LayerZero");
            }
        })
        it ("can swapRemote Fantom USDC => Bsc USDT", async () => {
            hre.changeNetwork('fantom');
            [owner] = await ethers.getSigners();
            const srcChainId = exportData.testnetTestConstants.chainIds[2];
            const srcVault = mozaicDeployments.get(srcChainId)!.mozaicVault;
            const srcMockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            const srcTokenAddr = exportData.testnetTestConstants.stablecoins.get(srcChainId)!.get("USDC")!;
            const srcToken = srcMockTokenFactory.attach(srcTokenAddr);
            const srcDecimals = await srcToken.decimals();
            console.log("srcDecimals", srcDecimals);
            const amountSrc = ethers.utils.parseUnits("1", srcDecimals);
            const amountSwap = amountSrc;

            // Mint srcToken to srcVault
            let tx = await srcToken.connect(owner).mint(srcVault.address, amountSrc);
            await tx.wait();
            const amountSrcBefore = await srcToken.balanceOf(srcVault.address);
            
            hre.changeNetwork('bsctest');
            [owner] = await ethers.getSigners();
            const dstChainId = exportData.testnetTestConstants.chainIds[1];
            const dstVault = mozaicDeployments.get(dstChainId)!.mozaicVault;
            const dstPoolId = exportData.testnetTestConstants.poolIds.get("USDT")!;
            const dstTokenAddr = exportData.testnetTestConstants.stablecoins.get(dstChainId)!.get("USDT")!;
            const dstMockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const dstToken = dstMockTokenFactory.attach(dstTokenAddr);
            const amountDstBefore = await dstToken.balanceOf(dstVault.address);
            console.log("Before swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcBefore.toString(), amountDstBefore.toString());
            
            // SwapRemote: Fantom USDC => Bsc USDT
            hre.changeNetwork('fantom');
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
            hre.changeNetwork('bsctest');
            let amountDstRemain: BigNumber;
            let timeDelayed = 0;
            const timeInterval = 10000;
            let success = false;
            while (timeDelayed < TIME_DELAY_MAX) {
                amountDstRemain = await dstToken.balanceOf(dstVault.address);
                if (amountDstRemain.eq(amountDstBefore)) {
                    console.log("Waiting for LayerZero delay...");
                    await setTimeout(timeInterval);
                    timeDelayed += timeInterval;
                } else {
                    success = true;
                    console.log("LayerZero succeeded in %d seconds", timeDelayed / 1000);
                    console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain.toString(), amountDstRemain.toString());
                    expect(amountDstRemain).gt(amountDstBefore);
                    break;
                }
            }
            if (!success) {
                console.log("Timeout in LayerZero");
            }
        })
    })
    describe.skip ('PancakeSwapDriver.execute', () => {
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
        let primaryChainId: number;
        let secondaryChainId: number;
        let primaryVault: PrimaryVault;
        let secondaryVault: SecondaryVault;
        let tokenAAddr: string;
        let tokenBAddr: string;
        let tokenCAddr: string;
        let MockTokenFactory: MockToken__factory;
        let tokenA: MockToken;
        let decimalsA: number;
        let aliceTotalLD_A: BigNumber;
        let aliceDeposit1LD_A: BigNumber;
        let aliceDeposit2LD_A: BigNumber;
        let tokenB: MockToken;
        let decimalsB: number;
        let benTotalLD_B: BigNumber;
        let benDepositLD_B: BigNumber;
        let benWithdrawMLP: BigNumber;
        let tx: ContractTransaction;
        let tokenC: MockToken;
        let decimalsC: number;
        let benTotalLD_C: BigNumber;
        let benDepositLD_C: BigNumber;
        let primaryLpStakingAddr: string;
        let primaryLpStakingFactory: LPStaking__factory;
        let primaryLpStaking: LPStaking;
        const timeInterval = 10000;

        before (async () => {
            hre.changeNetwork('bsctest');
            [owner, alice, ben] = await ethers.getSigners();
            primaryChainId = exportData.testnetTestConstants.chainIds[1];
            primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
            primaryLpStakingAddr = await primaryVault.stargateLpStaking();
            primaryLpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
            primaryLpStaking = primaryLpStakingFactory.attach(primaryLpStakingAddr);
            MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            tokenAAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDT")!;
            tokenA = MockTokenFactory.attach(tokenAAddr);
            decimalsA = await tokenA.decimals();
            console.log("tokenA decimals", decimalsA);
            aliceTotalLD_A = ethers.utils.parseUnits("100", decimalsA);
            aliceDeposit1LD_A = ethers.utils.parseUnits("3", decimalsA);
            aliceDeposit2LD_A = ethers.utils.parseUnits("3", decimalsA);
            tokenBAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("BUSD")!;
            tokenB = MockTokenFactory.attach(tokenBAddr);
            decimalsB = await tokenB.decimals();
            console.log("tokenB decimals", decimalsB);
            benTotalLD_B = ethers.utils.parseUnits("100", decimalsB);
            benDepositLD_B = ethers.utils.parseUnits("4", decimalsB);

            hre.changeNetwork('fantom');
            [owner, alice, ben] = await ethers.getSigners();
            secondaryChainId = exportData.testnetTestConstants.chainIds[2];
            secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
            tokenCAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDC")!;
            tokenC = MockTokenFactory.attach(tokenCAddr);
            decimalsC = await tokenC.decimals();
            console.log("tokenC decimals", decimalsC);
            benTotalLD_C = ethers.utils.parseUnits("100", decimalsC);
            benDepositLD_C = ethers.utils.parseUnits("5", decimalsC);
        })
        describe ('Round 1', () => {
            it ('1. User books', async () => {
                // Algostory: ### 1. User Books Deposit
                // get amounts before in pending buffer
                hre.changeNetwork('bsctest');
                [owner, alice, ben] = await ethers.getSigners();
                
                // Mint tokens
                tx = await tokenA.connect(owner).mint(alice.address, aliceTotalLD_A);
                await tx.wait();
                tx = await tokenB.connect(owner).mint(ben.address, benTotalLD_B);
                await tx.wait();
                
                let totalDepositAmountBefore = await primaryVault.getTotalDepositAmount(false);
                let aliceDepositAmountBefore = await primaryVault.getDepositAmount(false, alice.address, tokenA.address, primaryChainId);
                let depositAmountPerTokenABefore = await primaryVault.getDepositAmountPerToken(false, tokenA.address);
                
                // alice deposits to primaryVault
                tx = await tokenA.connect(alice).approve(primaryVault.address, aliceDeposit1LD_A);
                await tx.wait();
                tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit1LD_A, tokenA.address, primaryChainId);
                await tx.wait();
                console.log("Alice deposited %s %s to primaryVault", await tokenA.name(), aliceDeposit1LD_A.toString());

                // ben deposits to primaryVault
                tx = await tokenB.connect(ben).approve(primaryVault.address, benDepositLD_B);
                await tx.wait();
                tx = await primaryVault.connect(ben).addDepositRequest(benDepositLD_B, tokenB.address, primaryChainId);
                await tx.wait();
                console.log("Ben deposited %s %s to primaryVault", await tokenB.name(), benDepositLD_B.toString());

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

                // Mint tokens
                tx = await tokenC.connect(owner).mint(ben.address, benTotalLD_C);
                await tx.wait();
                
                tx = await tokenC.connect(ben).approve(secondaryVault.address, benDepositLD_C);
                await tx.wait();
                tx = await secondaryVault.connect(ben).addDepositRequest(benDepositLD_C, tokenC.address, secondaryChainId);
                await tx.wait();
                console.log("Ben deposited %s %s to secondaryVault", await tokenC.name(), benDepositLD_C.toString());
            })
            it ('3. Start optimizing', async () => {
                // Algostory: #### 3-1. Session Start (Protocol Status: IDLE -> OPTIMIZING)
                hre.changeNetwork('bsctest');
                [owner, alice, ben] = await ethers.getSigners();
                let protocolStatus = await primaryVault.protocolStatus();
                console.log("protocolStatus", protocolStatus);
                expect(protocolStatus).to.eq(ProtocolStatus.IDLE);
                tx = await primaryVault.connect(owner).initOptimizationSession();
                await tx.wait();
                console.log("Owner called initOptimizationSession");

                let timeDelayed = 0;
                let success = false;
                while (timeDelayed < TIME_DELAY_MAX * 5) {
                    let mlpPerStablecoinMil = await primaryVault.mlpPerStablecoinMil();
                    if (mlpPerStablecoinMil.eq(0)) {
                        console.log("Waiting for initOptimization...");
                        await setTimeout(timeInterval);
                        timeDelayed += timeInterval;
                    } else {
                        success = true;
                        console.log("initOptimization in %d seconds, mlpPerStablecoinMil %s", timeDelayed / 1000, mlpPerStablecoinMil.toString());
                        expect(mlpPerStablecoinMil).to.gt(0);
                        break;
                    }
                }
                if (!success) {
                    console.log("Timeout LayerZero in swapRemote");
                }

                // Alice deposits again, but it goes to pending buffer, so cannot affect minted mLP amount.
                console.log("Alice deposits again");
                hre.changeNetwork('bsctest');
                [owner, alice, ben] = await ethers.getSigners();
                let pendingDepositAmountBefore = await primaryVault.getTotalDepositAmount(false);
                let stagedDepositAmountBefore = await primaryVault.getTotalDepositAmount(true);
                tx = await tokenA.connect(alice).approve(primaryVault.address, aliceDeposit2LD_A);
                await tx.wait();
                tx = await primaryVault.connect(alice).addDepositRequest(aliceDeposit2LD_A, tokenA.address, primaryChainId);
                await tx.wait();
                let pendingDepositAmount = await primaryVault.getTotalDepositAmount(false);
                let stagedDepositAmount = await primaryVault.getTotalDepositAmount(true);
                expect(pendingDepositAmount.sub(pendingDepositAmountBefore)).to.eq(aliceDeposit2LD_A);
                expect(stagedDepositAmount).to.eq(stagedDepositAmountBefore);
            })

            // Algostory: ### 4. Execute Asset Transition
            // Stake - primaryVault stake 2 tokenA and receive LpToken
            // Unstake - primaryVault unstake LpToken and redeem tokenA
            // Swap - primaryVault swap 1 tokenA to tokenB
            // SwapRemote - primaryVault swapRemote 1 tokenB with tokenC of secondaryVault
            it ('4.1. Stake - primaryVault stake 2 tokenA and receive LpToken', async () => {
                hre.changeNetwork('bsctest');
                [owner] = await ethers.getSigners();
                // Check token and lpStaked
                const amountTokenBefore = await tokenA.connect(owner).balanceOf(primaryVault.address);
                const amountLPStakedBefore = (await primaryLpStaking.userInfo(BigNumber.from("0"), primaryVault.address)).amount; // pool index in bsctest: 0 USDT, 1 BUSD
                console.log("Before stake: token %d, LpStaked %d", amountTokenBefore.toString(), amountLPStakedBefore.toString());
                
                
                // primaryVault stake USDC
                const amountStake = ethers.utils.parseUnits("2", decimalsA);
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
                expect(amountTokenBefore.sub(amountToken)).to.eq(amountStake);
                expect(amountLPStaked).gt(amountLPStakedBefore);
            })
            it ('4.2. Unstake - primaryVault unstake LpToken and redeem tokenA', async () => {
                hre.changeNetwork('bsctest');
                [owner] = await ethers.getSigners();

                const amountTokenBefore = await tokenA.connect(owner).balanceOf(primaryVault.address);
                const amountLPStakedBefore = (await primaryLpStaking.userInfo(BigNumber.from("0"), primaryVault.address)).amount;
                console.log("Before unstake, token %d, LPStaked %d", amountTokenBefore.toString(), amountLPStakedBefore.toString());

                const amountLP = amountLPStakedBefore;
                const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLP, tokenA.address]);
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
                console.log("After unstake, token %d, LpStaked %d", amountTokenAfter.toString(), amountLPStakedAfter.toString());
                expect(amountTokenAfter).gt(amountTokenBefore);
                expect(amountLPStakedAfter).lt(amountLPStakedBefore);
            })
            it ('4.3. Swap - primaryVault swap 1 tokenA to tokenB', async () => {
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
            })
            it ('4.4. SwapRemote - primaryVault swapRemote 1 tokenB with tokenC of secondaryVault', async () => {
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
                let [nativeFee, zroFee] = await router.quoteLayerZeroFee(dstChainId, TYPE_SWAP_REMOTE, tokenCAddr, "0x", ({
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

                // Check result
                const amountSrcRemain = await tokenB.balanceOf(primaryVault.address);
                hre.changeNetwork('fantom');
                let amountDstRemain: BigNumber;
                let timeDelayed = 0;
                let success = false;
                while (timeDelayed < TIME_DELAY_MAX) {
                    amountDstRemain = await tokenC.balanceOf(secondaryVault.address);
                    if (amountDstRemain.eq(amountDstBefore)) {
                        console.log("Waiting for LayerZero delay...");
                        await setTimeout(timeInterval);
                        timeDelayed += timeInterval;
                    } else {
                        success = true;
                        console.log("LayerZero succeeded in %d seconds", timeDelayed / 1000);
                        console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain.toString(), amountDstRemain.toString());
                        expect(amountDstRemain).gt(amountDstBefore);
                        break;
                    }
                }
                if (!success) {
                    console.log("Timeout LayerZero in swapRemote");
                }
            })
            // Algostory: #### 5. Settle Requests
            it ('5. Settle Requests', async () => {
                // Alice, Ben receive mLP, Vaults receive coin
                hre.changeNetwork('bsctest');
                const alicePrimaryMLPBefore = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address);
                const benPrimaryMLPBefore = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(ben.address);
                hre.changeNetwork('fantom');
                const benSecondaryMLPBefore = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
                console.log("alicePrimaryMLPBefore %d, benPrimaryMLPBefore %d, benSecondaryMLPBefore %d", alicePrimaryMLPBefore.toString(), benPrimaryMLPBefore.toString(), benSecondaryMLPBefore.toString());

                hre.changeNetwork('bsctest');
                [owner, alice, ben] = await ethers.getSigners();
                tx = await primaryVault.connect(owner).settleRequestsAllVaults();
                await tx.wait();

                let timeDelayed = 0;
                let success = false;
                while (timeDelayed < TIME_DELAY_MAX * 5) {
                    let protocolStatus = await primaryVault.protocolStatus();
                    if (protocolStatus != ProtocolStatus.IDLE) {
                        console.log("Waiting for settling...");
                        await setTimeout(timeInterval);
                        timeDelayed += timeInterval;
                    } else {
                        success = true;
                        console.log("Session closed");
                        break;
                    }
                }
                if (!success) {
                    console.log("Timeout LayerZero in settle requests");
                }

                const alicePrimaryMLP = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address);
                const benPrimaryMLP = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(ben.address);
                console.log("After settle, alicePrimaryMLP %d, benPrimaryMLP %d", alicePrimaryMLP, benPrimaryMLP);
                expect(alicePrimaryMLP.sub(alicePrimaryMLPBefore)).to.eq(aliceDeposit1LD_A.mul(10**(MOZAIC_DECIMALS - decimalsA)));  // mLP eq to SD
                expect(benPrimaryMLP.sub(benPrimaryMLPBefore)).to.eq(benDepositLD_B.mul(10**(MOZAIC_DECIMALS - decimalsB)));  // mLP eq to SD
                hre.changeNetwork('fantom');
                const benSecondaryMLP = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
                console.log("After settle, benSecondaryMLP %d", benSecondaryMLP);
                expect(benSecondaryMLP.sub(benSecondaryMLPBefore)).to.eq(benDepositLD_C.mul(10**(MOZAIC_DECIMALS - decimalsC)));  // mLP eq to SD
            })
        })
        describe ('Round 2', () => {
            it ('1. User books', async () => {
                // Alice's booked deposit request now turns into staged from pending.
                // Ben books withdraw whole tokenC from secondaryVault
                hre.changeNetwork('fantom');
                [owner, alice, ben] = await ethers.getSigners();
                const benMLPBefore = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
                const benTokenBBefore = await tokenC.balanceOf(ben.address);
                console.log("benMLPBefore %d, benTokenBefore %d", benMLPBefore, benTokenBBefore);
                benWithdrawMLP = benMLPBefore;    // withdraw whole mLP
                tx = await secondaryVault.connect(ben).addWithdrawRequest(benWithdrawMLP, tokenCAddr, secondaryChainId);
                await tx.wait();

                // check
                let benMLP = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
                expect(benMLP).to.eq(benMLPBefore);
            })
            it ('3. Start optimizing', async () => {
                // Algostory: #### 3-1. Session Start (Protocol Status: IDLE -> OPTIMIZING)
                hre.changeNetwork('bsctest');
                [owner, alice, ben] = await ethers.getSigners();
                expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);
                tx = await primaryVault.connect(owner).initOptimizationSession();
                await tx.wait();

                let timeDelayed = 0;
                let success = false;
                while (timeDelayed < TIME_DELAY_MAX * 5) {
                    let mlpPerStablecoinMil = await primaryVault.mlpPerStablecoinMil();
                    if (mlpPerStablecoinMil.eq(0)) {
                        console.log("Waiting for initOptimization...");
                        await setTimeout(timeInterval);
                        timeDelayed += timeInterval;
                    } else {
                        success = true;
                        console.log("initOptimization in %d seconds, mlpPerStablecoinMil %s", timeDelayed / 1000, mlpPerStablecoinMil.toString());
                        expect(mlpPerStablecoinMil).to.gt(0);
                        break;
                    }
                }
                if (!success) {
                    console.log("Timeout LayerZero in swapRemote");
                }
            })
            it ('5. Settle Requests', async () => {
                hre.changeNetwork('bsctest');
                const alicePrimaryMLPBefore = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address);
                hre.changeNetwork('fantom');
                const benSecondaryMLPBefore = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
                console.log("alicePrimaryMLPBefore %d, benSecondaryMLPBefore %d", alicePrimaryMLPBefore.toString(), benSecondaryMLPBefore.toString());

                hre.changeNetwork('bsctest');
                [owner, alice, ben] = await ethers.getSigners();
                tx = await primaryVault.connect(owner).settleRequestsAllVaults();
                await tx.wait();

                let timeDelayed = 0;
                let success = false;
                while (timeDelayed < TIME_DELAY_MAX * 5) {
                    let protocolStatus = await primaryVault.protocolStatus();
                    if (protocolStatus != ProtocolStatus.IDLE) {
                        console.log("Waiting for settling...");
                        await setTimeout(timeInterval);
                        timeDelayed += timeInterval;
                    } else {
                        success = true;
                        console.log("Session closed");
                        break;
                    }
                }
                if (!success) {
                    console.log("Timeout LayerZero in settle requests");
                }

                const alicePrimaryMLP = await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(alice.address);
                console.log("After settle, alicePrimaryMLP %d", alicePrimaryMLP.toString());
                expect(alicePrimaryMLP.sub(alicePrimaryMLPBefore)).to.eq(aliceDeposit2LD_A.mul(10**(MOZAIC_DECIMALS - decimalsA)));  // mLP eq to SD
                hre.changeNetwork('fantom');
                const benSecondaryMLP = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
                console.log("After settle, benSecondaryMLP %d", benSecondaryMLP.toString());
                expect(benSecondaryMLP).eq(benSecondaryMLPBefore);
                
                hre.changeNetwork('bsctest');
                const totalDepositAmountLast = await primaryVault.getTotalDepositAmount(true);
                console.log(totalDepositAmountLast.toString());
                expect(totalDepositAmountLast).to.eq(0);
            })
        })
    })
})