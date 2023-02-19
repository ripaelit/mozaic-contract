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
        mozaicDeployments = await deployMozaic(owner, exportData.localTestConstants.mozaicPrimaryChainId, stargateDeployments, getLayerzeroDeploymentsFromStargateDeployments(stargateDeployments), protocols);
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
            
            // First Round:
            // Alice and Ben deposit to SecondaryVault, Chris deposit to PrimaryVault
            // Alice deposit tokenAPrimary to secondaryVault
            await tokenASecondary.connect(alice).approve(secondaryVault.address, aliceDeposit1LD);
            await secondaryVault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenASecondary.address, secondaryChainId);
            // Ben deposit tokenASecondary to secondaryVault
            await tokenBSecondary.connect(ben).approve(secondaryVault.address, benDeposit1LD);
            await secondaryVault.connect(ben).addDepositRequest(benDeposit1LD, tokenBSecondary.address, secondaryChainId);
            // Chris deposit tokenBSecondary to primaryVault
            await tokenAPrimary.connect(chris).approve(primaryVault.address, chrisDeposit1LD);
            await primaryVault.connect(chris).addDepositRequest(chrisDeposit1LD, tokenAPrimary.address, primaryChainId);            

            // init optimization session.
            await primaryVault.connect(owner).initOptimizationSession();
            // check protocolStatus
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.OPTIMIZING);

            // snapshot requests
            for (const chainId of exportData.localTestConstants.chainIds) {
                // TODO: optimize lz native token fee.
                console.log("vault address", chainId, mozaicDeployments.get(chainId)!.mozaicVault.address);
                await mozaicDeployments.get(chainId)!.mozaicVault.snapshotAndReport({value:ethers.utils.parseEther("0.1")});
            }
            // check: primary vault now has all snapshot reports
            expect(await primaryVault.checkAllSnapshotReportReady()).to.eq(true);
            const mozaicLpPerStablecoin = await primaryVault.mozaicLpPerStablecoinMil();
            expect(mozaicLpPerStablecoin).to.eq(1000000); // initial rate 1 mLP per USD*

            // TODO: stake

            // Algostory-5. Settle Requests
            // Alice, Ben and Chris now has mLP, Vaults has coin
            await primaryVault.settleRequestsAllVaults();
            for (const chainId of exportData.localTestConstants.chainIds) {
                if (chainId == primaryChainId) continue;
                await mozaicDeployments.get(chainId)!.mozaicVault.reportSettled();
            }
            expect(await primaryVault.protocolStatus()).to.eq(ProtocolStatus.IDLE);
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(alice.address)).to.eq(aliceDeposit1LD.div(BigNumber.from("1000000000000"))); // mLP eq to SD
            expect(await mozaicDeployments.get(secondaryChainId)!.mozaicLp.balanceOf(ben.address)).to.eq(benDeposit1LD.div(BigNumber.from("1000000000000")));
            expect(await mozaicDeployments.get(primaryChainId)!.mozaicLp.balanceOf(chris.address)).to.eq(chrisDeposit1LD.div(BigNumber.from("1000000000000")));


            // Second Round:
            // Alice books deposit
            // Ben books withdraw (half of his mLP)
            // snapshot requests
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

