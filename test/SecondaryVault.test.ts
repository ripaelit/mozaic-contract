import { expect } from 'chai';
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MockToken, PrimaryVault, MockDex__factory, SecondaryVault } from '../types/typechain';
import { deployMozaic, deployStablecoins, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments, lzEndpointMockSetDestEndpoints } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployments, ProtocolStatus, VaultStatus } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';
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
            console.log("Deployed MockDex: chainid, mockDex:", chainId, mockDex.address);
            mockDexs.set(chainId, mockDex.address);
            protocols.set(chainId, new Map<string,string>([["PancakeSwapSmartRouter", mockDex.address]]));
        }
        console.log("Deployed mockDexs");

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
    describe('SecondaryVault.addDepositRequest', () => {
        it('add request to pending buffer', async () => {
            const chainId = exportData.localTestConstants.chainIds[0];
            const coinContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0]) as MockToken;
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
            const coinContract = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0]) as MockToken;
            const vaultContract = mozaicDeployments.get(chainId)!.mozaicVault;
            const amountMLP =  BigNumber.from("1000000000000000");
            const mozaicLpContract = mozaicDeployments.get(chainId)!.mozaicLp;
            await mozaicLpContract.connect(owner).mint(alice.address, amountMLP);
            await expect(vaultContract.connect(alice).addWithdrawRequest(amountMLP, coinContract.address, chainId)).to.emit(vaultContract, 'WithdrawRequestAdded').withArgs(alice.address,coinContract.address,chainId,amountMLP);
        })
    })
    describe('SecondaryVault.snapshotAndReport', () => {
        it('only owner can call', async() => {
            const chainId = exportData.localTestConstants.chainIds[1];
            const vaultContract = mozaicDeployments.get(chainId)!.mozaicVault;
            await expect(vaultContract.connect(alice).snapshotAndReport()).to.revertedWith('Ownable: caller is not the owner')
        })
    })
    describe.only('Flow Test', () => {
        it.only('normal flow', async () => {
            const primaryChainId = exportData.localTestConstants.chainIds[0];
            const secondaryChainId = exportData.localTestConstants.chainIds[1];
            const tokenAPrimary = stablecoinDeployments.get(primaryChainId)!.get(exportData.localTestConstants.stablecoins.get(primaryChainId)![0]) as MockToken;
            const tokenASecondary = stablecoinDeployments.get(secondaryChainId)!.get(exportData.localTestConstants.stablecoins.get(secondaryChainId)![0]) as MockToken;
            const tokenBSecondary = stablecoinDeployments.get(secondaryChainId)!.get(exportData.localTestConstants.stablecoins.get(secondaryChainId)![1]) as MockToken;
            const primaryVault = mozaicDeployments.get(primaryChainId)!.mozaicVault as PrimaryVault;
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault as SecondaryVault;
            const aliceTotalLD = BigNumber.from("10000000000000000000000"); // $10000
            const benTotalLD = BigNumber.from("20000000000000000000000"); // $20000
            const chrisTotalLD = BigNumber.from("30000000000000000000000"); // $30000
            const aliceDeposit1LD = BigNumber.from("5000000000000000000000"); // $5000
            const aliceDeposit2LD = BigNumber.from("4000000000000000000000"); // $4000
            const benDeposit1LD = BigNumber.from("10000000000000000000000"); // $10000
            const benWithdraw2MLP = BigNumber.from("5000000000000000000000"); // 5000 mLP ~ $5000
            const chrisDeposit1LD = BigNumber.from("15000000000000000000000"); // $15000

            // Mint tokens
            tokenASecondary.mint(alice.address, aliceTotalLD);
            tokenBSecondary.mint(ben.address, benTotalLD);
            tokenAPrimary.mint(chris.address, chrisTotalLD);
            
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
            expect(await secondaryVault.getTotalDepositRequest(false)).to.eq(aliceDeposit1LD.add(benDeposit1LD));
            expect(await secondaryVault.getDepositRequestAmount(false, alice.address, tokenASecondary.address, secondaryChainId)).to.eq(aliceDeposit1LD);

            // Algostory: #### 3-1. Session Start (Protocol Status: Idle -> Optimizing)
            await primaryVault.connect(owner).initOptimizationSession();
            // Protocol Status : IDLE -> OPTIMIZING
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);
            
            // Algostory: #### 3-2. Take Snapshot and Report
            for (const chainId of exportData.localTestConstants.chainIds) {
                // TODO: optimize lz native token fee.
                console.log("vault address", chainId, mozaicDeployments.get(chainId)!.mozaicVault.address);
                await mozaicDeployments.get(chainId)!.mozaicVault.snapshotAndReport(); //{value:ethers.utils.parseEther("0.1")}
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
            await primaryVault.connect(owner).snapshotAndReport({value:ethers.utils.parseEther("0")});
            await secondaryVault.connect(owner).snapshotAndReport({value:ethers.utils.parseEther("0.1")}); //{value:ethers.utils.parseEther("0.1")}
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

