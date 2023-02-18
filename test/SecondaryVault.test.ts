import { expect } from 'chai';
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20__factory, ERC20, OrderTaker, OrderTaker__factory, MockToken, PrimaryVault } from '../types/typechain';
import { deployMozaic, deployStablecoins, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployments } from '../constants/types'
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
        stargateDeployments = await deployStargate(owner, stablecoinDeployments, exportData.localTestConstants.poolIds, exportData.localTestConstants.stgMainChain, exportData.localTestConstants.stargateChainPaths);
        // Deploy Mozaic
        mozaicDeployments = await deployMozaic(owner, exportData.localTestConstants.mozaicPrimaryChain, stargateDeployments, getLayerzeroDeploymentsFromStargateDeployments(stargateDeployments), stablecoinDeployments);
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
    describe.skip('SecondaryVault.addWithdrawRequest', () => {
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
            const secondaryVault = mozaicDeployments.get(secondaryChainId)!.mozaicVault;
            const aliceTotalLD = BigNumber.from("10000000000000000000000"); // $1000
            const benTotalLD = BigNumber.from("20000000000000000000000"); // $2000
            const chrisTotalLD = BigNumber.from("30000000000000000000000"); // $3000
            const aliceDeposit1LD = BigNumber.from("5000000000000000000000"); // $500
            const aliceDeposit2LD = BigNumber.from("4000000000000000000000"); // $400
            const benDeposit1LD = BigNumber.from("10000000000000000000000"); // $1000
            const benWithdraw2MLP = BigNumber.from("5000000000000000000000"); // 500 mLP ~ $500
            const chrisDeposit1LD = BigNumber.from("15000000000000000000000"); // $1500

            // Mint tokens
            tokenAPrimary.mint(alice.address, aliceTotalLD);
            tokenASecondary.mint(ben.address, benTotalLD);
            tokenBSecondary.mint(chris.address, chrisTotalLD);
            
            // First Round:
            // Alice and Ben deposit to SecondaryVault, Chris deposit to PrimaryVault
            await tokenASecondary.connect(alice).approve(secondaryVault.address, aliceDeposit1LD);
            await secondaryVault.connect(alice).addDepositRequest(aliceDeposit1LD, tokenASecondary.address, secondaryChainId);
            await tokenBSecondary.connect(ben).approve(secondaryVault.address, benDeposit1LD);
            await secondaryVault.connect(alice).addDepositRequest(benDeposit1LD, tokenBSecondary.address, secondaryChainId);
            await tokenAPrimary.connect(ben).approve(tokenAPrimary.address, benDeposit1LD);
            await primaryVault.connect(chris).addDepositRequest(chrisDeposit1LD, tokenAPrimary.address, primaryChainId);            

            // init optimization session.
            await primaryVault.connect(owner).initOptimizationSession();
            // check protocolStatus
            // snapshot requests
            // settle requests
            // Alice, Ben and Chris now has mLP, Vaults has coin

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

