import { expect } from 'chai';
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20__factory, ERC20, OrderTaker, OrderTaker__factory, MockToken } from '../types/typechain';
import { deployMozaic, deployStablecoins, deployStargate, equalize, getLayerzeroDeploymentsFromStargateDeployments } from './TestUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployments } from '../constants/types'
import exportData from '../constants/index';
import { BigNumber } from 'ethers';
describe('SecondaryVault', () => {
    let owner: SignerWithAddress;
    let alice: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;
    beforeEach(async () => {
        [owner, alice] = await ethers.getSigners();  // owner is control center
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
    describe('SecondaryVault Single-Chain Flow : settleRequests', () => {
        it('normal flow', async () => {
            // First Round:
            // Alice and Ben deposit
            // snapshot requests
            // settle requests
            // Alice and Ben now has mLP, Vault has coin

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

