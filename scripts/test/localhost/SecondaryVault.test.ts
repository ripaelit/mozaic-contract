import { expect } from 'chai';
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PrimaryVault, PrimaryVault__factory, SecondaryVault, SecondaryVault__factory, MockToken, MockToken__factory, MozaicLP__factory } from '../../../types/typechain';
import { StargateDeployments, StableCoinDeployments, MozaicDeployment, MozaicDeployments, ProtocolStatus, StargateDeploymentOnchain } from '../../constants/types'
import exportData from '../../constants/index';
import { BigNumber } from 'ethers';
const fs = require('fs');

describe('SecondaryVault', () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let ben: SignerWithAddress;
    let chris: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;

    beforeEach(async () => {
        [owner, alice, ben, chris] = await ethers.getSigners();  // owner is control center
        
        stablecoinDeployments = new Map<number, Map<string, string>>();
        stargateDeployments = new Map<number, StargateDeploymentOnchain>();
        mozaicDeployments = new Map<number, MozaicDeployment>();

        // Parse local deploy info
        const dataArray = JSON.parse(fs.readFileSync('deployLocalResult.json', 'utf-8'));
        const mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        const primaryVaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        const secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        for (const obj of dataArray) {
            let chainId = obj.chainId;
            let primaryChainId = obj.primaryChainId;

            // Get mozaicDeployment
            let mozVault;
            if (chainId == primaryChainId) {
                mozVault = primaryVaultFactory.attach(obj.mozaicVault);
            } else {
                mozVault = secondaryVaultFactory.attach(obj.mozaicVault);
            }
            let mozLp = mozaicLpFactory.attach(obj.mozaicLp);
            let mozaicDeployment = {
                mozaicLp: mozLp,
                mozaicVault: mozVault
            }
            mozaicDeployments.set(chainId, mozaicDeployment);

            // Get stablecoinDeployment
            let stablecoinDeployment = new Map<string, string>();
            for (const coin of obj.coins) {
                stablecoinDeployment.set(coin.name, coin.token);
            }
            stablecoinDeployments.set(chainId, stablecoinDeployment);

        }

        // await deployAllToLocalNets(owner, stablecoinDeployments, stargateDeployments, mozaicDeployments);
    });

    describe('SecondaryVault.addDepositRequest', () => {
        it('add request to pending buffer', async () => {
            const chainId = exportData.localTestConstants.chainIds[0];
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0])!);
            const vaultContract = mozaicDeployments.get(chainId)!.mozaicVault;
            const amountLD =  BigNumber.from("10000000000000000000000");
            await coinContract.connect(owner).mint(alice.address, amountLD);
            const aliceBalBefore = await coinContract.balanceOf(alice.address);
            await coinContract.connect(alice).approve(vaultContract.address, amountLD);
            await expect(vaultContract.connect(alice).addDepositRequest(amountLD, coinContract.address, chainId)).to.emit(vaultContract, 'DepositRequestAdded').withArgs(alice.address, coinContract.address, chainId, amountLD, anyValue); // don't compare amountSD
            // fund move from Alice to vault
            expect(await coinContract.balanceOf(alice.address)).to.lt(aliceBalBefore);
            expect(await coinContract.balanceOf(alice.address)).to.eq(0);
            expect(await coinContract.balanceOf(vaultContract.address)).to.eq(amountLD);
            // reqest put to pending
            expect(await vaultContract.getDepositRequestAmount(false, alice.address, coinContract.address, chainId)).to.gt(0);
        })
    });

    describe('SecondaryVault.addWithdrawRequest', () => {
        it('add request to pending buffer', async() => {
            // NOTE: Run this test case without transferring ownership from `owner` to `vault`
            const chainId = exportData.localTestConstants.chainIds[0];
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const coinContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0])!);
            const vaultContract = mozaicDeployments.get(chainId)!.mozaicVault;
            const amountMLP =  BigNumber.from("1000000000000000");
            const mozaicLpContract = mozaicDeployments.get(chainId)!.mozaicLp;
            await mozaicLpContract.connect(owner).mint(alice.address, amountMLP);
            await expect(vaultContract.connect(alice).addWithdrawRequest(amountMLP, coinContract.address, chainId)).to.emit(vaultContract, 'WithdrawRequestAdded').withArgs(alice.address,coinContract.address,chainId,amountMLP);
        })
    })

    // describe('SecondaryVault.snapshotAndReport', () => {
    //     it('only owner can call', async() => {
    //         const chainId = exportData.localTestConstants.chainIds[1];
    //         const vaultContract = mozaicDeployments.get(chainId)!.mozaicVault;
    //         await expect(vaultContract.connect(alice).snapshotAndReport()).to.revertedWith('Ownable: caller is not the owner')
    //     })
    // })

    describe.only('Flow Test', () => {
        it('normal flow', async () => {
            const primaryChainId = exportData.localTestConstants.chainIds[0];
            const secondaryChainId = exportData.localTestConstants.chainIds[1];
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const tokenAPrimary = MockTokenFactory.attach(stablecoinDeployments.get(primaryChainId)!.get(exportData.localTestConstants.stablecoins.get(primaryChainId)![0])!);
            const tokenASecondary = MockTokenFactory.attach(stablecoinDeployments.get(secondaryChainId)!.get(exportData.localTestConstants.stablecoins.get(secondaryChainId)![0])!);
            const tokenBSecondary = MockTokenFactory.attach(stablecoinDeployments.get(secondaryChainId)!.get(exportData.localTestConstants.stablecoins.get(secondaryChainId)![1])!);
            const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            const aliceTotalLD = BigNumber.from("100000000000000000000"); // $100
            const benTotalLD = BigNumber.from("200000000000000000000"); // $200
            const chrisTotalLD = BigNumber.from("300000000000000000000"); // $300
            const aliceDeposit1LD = BigNumber.from("50000000000000000000"); // $50
            const aliceDeposit2LD = BigNumber.from("40000000000000000000"); // $40
            const benDeposit1LD = BigNumber.from("100000000000000000000"); // $100
            const benWithdraw2MLP = BigNumber.from("50000000000000000000"); // 50 mLP ~ $50
            const chrisDeposit1LD = BigNumber.from("150000000000000000000"); // $150

            // Mint tokens
            await tokenASecondary.mint(alice.address, aliceTotalLD);  // Bsc USDT
            await tokenBSecondary.mint(ben.address, benTotalLD);      // Bsc BUSD
            await tokenAPrimary.mint(chris.address, chrisTotalLD);    // Eth USDC

            const d = await tokenASecondary.balanceOf(alice.address);
            const e = await tokenBSecondary.balanceOf(ben.address);
            const f = await tokenAPrimary.balanceOf(chris.address);
            const a = await tokenASecondary.balanceOf(owner.address);
            const b = await tokenBSecondary.balanceOf(owner.address);
            const c = await tokenAPrimary.balanceOf(owner.address);
            // ----------------------- First Round: ----------------------------

            // Algostory: ### 1. User Books Deposit
            // Alice -> SecondaryVault Token A
            // Ben -> SecondaryVault Token B
            // Chris -> PrimaryVault Token A
            await tokenASecondary.connect(alice).approve(secondaryVault.address, aliceDeposit1LD);
            await secondaryVault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenASecondary.address, secondaryChainId);
            // Beed deposit tokenASecondary's to secondaryVault request 4k now turns into staged from pending.
            await tokenBSecondary.connect(ben).approve(secondaryVault.address, benDeposit1LD);
            await secondaryVault.connect(ben).addDepositRequest(benDeposit1LD, tokenBSecondary.address, secondaryChainId);
            // Chried deposit tokenBSecondary's to primaryVault request 4k now turns into staged from pending.
            await tokenAPrimary.connect(chris).approve(primaryVault.address, chrisDeposit1LD);
            await primaryVault.connect(chris).addDepositRequest(chrisDeposit1LD, tokenAPrimary.address, primaryChainId);

            // Check Pending Request Buffer
            console.log("totalDepositRequest", (await secondaryVault.getTotalDepositRequest(false)));
            console.log("alice %d, ben %d", aliceDeposit1LD, benDeposit1LD);
            expect(await secondaryVault.getTotalDepositRequest(false)).to.eq(aliceDeposit1LD.add(benDeposit1LD));
            expect(await secondaryVault.getDepositRequestAmount(false, alice.address, tokenASecondary.address, secondaryChainId)).to.eq(aliceDeposit1LD);

            console.log("PrimaryVault %s owner %s", primaryVault.address, owner.address);
            // Algostory: #### 3-1. Session Start (Protocol Status: Idle -> Optimizing)
            await primaryVault.connect(owner).initOptimizationSession();
            // Protocol Status : IDLE -> OPTIMIZING
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // Algostory: #### 3-2. Take Snapshot and Report
            for (const [chainId, mozaicDeployment] of mozaicDeployments) {
                // TODO: optimize lz native token fee.
                console.log("vault address", chainId, mozaicDeployment.mozaicVault.address);
                await mozaicDeployment.mozaicVault.connect(owner).takeSnapshot();
                await mozaicDeployment.mozaicVault.connect(owner).reportSnapshot(); //{value:ethers.utils.parseEther("0.1")}
            }

            // Alice adds to pending request pool, but this should not affect minted mLP amount.
            await tokenASecondary.connect(alice).approve(secondaryVault.address, aliceDeposit2LD);
            await secondaryVault.connect(alice).addDepositRequest(aliceDeposit2LD, tokenASecondary.address, secondaryChainId);

            // Pending/Staged Request Amounts
            expect(await secondaryVault.getTotalDepositRequest(true)).to.eq(aliceDeposit1LD.add(benDeposit1LD));
            expect(await secondaryVault.getTotalDepositRequest(false)).to.eq(aliceDeposit2LD);
            // Primary vault now has all snapshot reports.
            expect(await primaryVault.allVaultsSnapshotted()).to.eq(true);
            const mozaicLpPerStablecoin = await primaryVault.mozaicLpPerStablecoinMil();
            // Algostory: #### 3-3. Determine MLP per Stablecoin Rate
            // Initial rate is 1 mLP per USD
            expect(mozaicLpPerStablecoin).to.eq(1000000);

            // TODO: stake

            // Algostory: #### 5. Settle Requests
            // Alice, Ben and Chris now has mLP, Vaults has coin
            await primaryVault.settleRequestsAllVaults();
            for (const chainId of exportData.localTestConstants.chainIds) {
                if (chainId == primaryChainId) continue;
                await mozaicDeployments.get(chainId)!.mozaicVault.reportSettled();
            }
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(alice.address)).to.eq(aliceDeposit1LD); //.div(BigNumber.from("1000000000000"))); // mLP eq to SD
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address)).to.eq(benDeposit1LD); //.div(BigNumber.from("1000000000000")));
            expect(await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(chris.address)).to.eq(chrisDeposit1LD); //.div(BigNumber.from("1000000000000")));
            // Algostory: #### 6. Session Closes
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);

            // Second Round:
            console.log("Second Round:");
            // Alice's booked deposit request 4k now turns into staged from pending.
            // Ben books withdraw (half of his mLP)
            const benMLPBefore = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benCoinBefore = await tokenBSecondary.balanceOf(ben.address);
            console.log("ben:", ben.address);
            console.log("benMLPBefore", benMLPBefore, "benCoinBefore", benCoinBefore);
            await secondaryVault.connect(ben).addWithdrawRequest(benWithdraw2MLP, tokenBSecondary.address, secondaryChainId);
            // Settle Requests
            await primaryVault.connect(owner).initOptimizationSession();
            await primaryVault.connect(owner).takeSnapshot();
            await primaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0")});
            await secondaryVault.connect(owner).takeSnapshot();
            await secondaryVault.connect(owner).reportSnapshot({value:ethers.utils.parseEther("0.1")});
            console.log("before", await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(alice.address));
            const txresult = await primaryVault.settleRequestsAllVaults({value:ethers.utils.parseEther("0.1")});
            console.log("after", await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(alice.address));

            expect(await secondaryVault.getTotalDepositRequest(true)).to.eq(0);
            console.log(await secondaryVault.getTotalDepositRequest(true));
            // console.log(txresult);
            // console.log("wait for settling");
            // await new Promise( resolve => setTimeout(resolve, 5000) );
            // console.log("settled");
            await secondaryVault.reportSettled({value:ethers.utils.parseEther("0.1")});
            const benMLPAfter = await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address);
            const benCoinAfter = await tokenBSecondary.balanceOf(ben.address);
            console.log("benMLPAfter", benMLPAfter, "benCoinAfter", benCoinAfter);
            expect(benMLPBefore.sub(benMLPAfter)).to.eq(benWithdraw2MLP);
            expect(benCoinAfter.sub(benCoinBefore)).to.eq(benWithdraw2MLP);
            // settle requests
        })
    })

    describe('Snapshot Flow', () => {
        it('It needs to begin with PrimaryVault.initOptimizationSession()', async() => {

        })

        it('Reports flow from SecondaryVault to PrimaryVault', async() => {

        })

        it('When all reports are collected PrimaryVault calculate mozaicLpPerStablecoin; Flags and other variables set correctly', async() => {

        })

    })
});

