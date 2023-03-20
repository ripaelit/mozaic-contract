import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, MockToken__factory, PrimaryVault, SecondaryVault, MockToken } from '../../../types/typechain';
import exportData from '../../constants/index';
import { describe } from 'mocha';
import { deposit, withdraw, mint, stake, unstake, swap, swapRemote, initOptimization, settleRequests } from '../../util/testUtils';

const fs = require('fs');
const hre = require('hardhat');

describe('SecondaryVault.executeActions', () => {
    let owner: SignerWithAddress;
    let primaryVault: PrimaryVault;
    let primaryChainId: number;
    let secondaryVault: SecondaryVault;
    let secondaryChainId: number;
    let tokenA: MockToken;
    let tokenB: MockToken;
    let tokenC: MockToken;

    before(async () => {
        // Parse bsctest deploy info
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
        let mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        let mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        let primaryVaultAddr = json.mozaicVault;
        primaryVault = primaryvaultFactory.attach(primaryVaultAddr);
        primaryChainId = exportData.testnetTestConstants.chainIds[0];
        let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
        let tokenAAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("BUSD")!;
        tokenA = MockTokenFactory.attach(tokenAAddr);
        let tokenBAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDT")!;
        tokenB = MockTokenFactory.attach(tokenBAddr);

        // Parse fantom deploy info
        hre.changeNetwork('fantom');
        [owner] = await ethers.getSigners();
        json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
        mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        mozLp = mozaicLpFactory.attach(json.mozaicLP);
        let secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        let secondaryVaultAddr = json.mozaicVault;
        secondaryVault = secondaryVaultFactory.attach(secondaryVaultAddr);
        secondaryChainId = exportData.testnetTestConstants.chainIds[1];
        MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
        let tokenCAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDC")!;
        tokenC = MockTokenFactory.attach(tokenCAddr);
    })
    after (async () => {
    })
    describe ('Test for Control Center', () => {
        before (async () => {
        })
        it ('1. Mint token to users', async () => {
            mint('bsctest', 1, tokenA, 100);
            mint('bsctest', 2, tokenB, 100);
            mint('fantom', 2, tokenC, 100);
        })
        it ('2. Users request deposit', async () => {
            deposit('bsctest', 1, primaryVault, tokenA, 10);
            deposit('bsctest', 2, primaryVault, tokenB, 15);
            deposit('fantom', 2, primaryVault, tokenC, 20);
        })
        it ('3. InitOptimizationSession', async () => {
            initOptimization(primaryVault, secondaryVault);
        })
        it ('4. Optimizing', async () => {
            // send whole token in primaryVault to secondaryVault
            let amountLD = await tokenA.balanceOf(primaryVault.address);
            swapRemote('bsctest', primaryVault, tokenA, 'fantom', secondaryVault, tokenC, amountLD);
            amountLD = await tokenB.balanceOf(primaryVault.address);
            swapRemote('bsctest', primaryVault, tokenB, 'fantom', secondaryVault, tokenC, amountLD);
        })
        it ('5. Settle Requests', async () => {
            settleRequests(primaryVault, secondaryVault);
        })
        it ('6. Users request deposit and withdraw', async () => {
            deposit('bsctest', 1, primaryVault, tokenA, 20);
            deposit('bsctest', 2, primaryVault, tokenB, 20);
            deposit('fantom', 2, secondaryVault, tokenC, 20);
            withdraw('bsctest', 1, primaryVault, tokenA, 10);
            withdraw('bsctest', 2, primaryVault, tokenB, 15);
            withdraw('fantom,', 2, secondaryVault, tokenC, 20);
        })
    })
})