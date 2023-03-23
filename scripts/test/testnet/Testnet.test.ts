import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, PrimaryVault__factory, SecondaryVault__factory, MockToken__factory, PrimaryVault, SecondaryVault, MockToken, LPStaking, LPStaking__factory, MozaicLP } from '../../../types/typechain';
import exportData from '../../constants/index';
import { describe } from 'mocha';
import { deposit, withdraw, withdrawWhole, mint, stake, unstake, swap, swapRemote, initOptimization, settleRequests } from '../../util/testUtils';
import { BigNumber } from 'ethers';

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
    let decimalsA: number;
    let decimalsB: number;
    let decimalsC: number;
    let decimalsMLP: number;
    let primaryMozaicLP: MozaicLP;
    let secondaryMozaicLP: MozaicLP;

    before(async () => {
        // Parse bsctest deploy info
        hre.changeNetwork('bsctest');
        [owner] = await ethers.getSigners();
        let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
        let primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        primaryVault = primaryvaultFactory.attach(json.mozaicVault);
        primaryChainId = exportData.testnetTestConstants.chainIds[0];
        let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
        let tokenAAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("BUSD")!;
        tokenA = MockTokenFactory.attach(tokenAAddr);
        decimalsA = await tokenA.decimals();
        console.log("tokenA %s decimalsA %d", await tokenA.name(), decimalsA);
        let tokenBAddr = exportData.testnetTestConstants.stablecoins.get(primaryChainId)!.get("USDT")!;
        tokenB = MockTokenFactory.attach(tokenBAddr);
        decimalsB = await tokenB.decimals();
        console.log("tokenB %s decimalsB %d", await tokenB.name(), decimalsB);
        let mozaicLPFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        primaryMozaicLP = mozaicLPFactory.attach(json.mozaicLP);

        // Parse fantom deploy info
        hre.changeNetwork('fantom');
        [owner] = await ethers.getSigners();
        json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
        let secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        let secondaryVaultAddr = json.mozaicVault;
        secondaryVault = secondaryVaultFactory.attach(secondaryVaultAddr);
        secondaryChainId = exportData.testnetTestConstants.chainIds[1];
        MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
        let tokenCAddr = exportData.testnetTestConstants.stablecoins.get(secondaryChainId)!.get("USDC")!;
        tokenC = MockTokenFactory.attach(tokenCAddr);
        decimalsC = await tokenC.decimals();
        console.log("tokenC %s decimalsC %d", await tokenC.name(), decimalsC);
        mozaicLPFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        secondaryMozaicLP = mozaicLPFactory.attach(json.mozaicLP);

        // decimalsMLP = exportData.testnetTestConstants.MOZAIC_DECIMALS;
        decimalsMLP = await secondaryMozaicLP.decimals();
        console.log("MozaicLP %s decimalsMLP %d", await secondaryMozaicLP.name(), decimalsMLP);
    })
    after (async () => {
    })
    describe ('Test for Control Center', () => {
        before (async () => {
        })
        // it.skip ('Mint tokens to owner', async () => {
        //     await mint('bsctest', 0, tokenA, ethers.utils.parseUnits('10000000000', decimalsA))
        //     await mint('bsctest', 0, tokenB, ethers.utils.parseUnits('10000000000', decimalsB))
        //     await mint('fantom', 0, tokenC, ethers.utils.parseUnits('10000000000', decimalsC))
        // })
        // it.skip ('Owner deposit tokens to get MLP', async () => {
        //     await deposit('bsctest', 0, primaryVault, tokenA, ethers.utils.parseUnits('1000000', decimalsA));
        //     await deposit('bsctest', 0, primaryVault, tokenB, ethers.utils.parseUnits('1000000', decimalsB));
        //     await deposit('fantom', 0, secondaryVault, tokenC, ethers.utils.parseUnits('1000000', decimalsC));
        // })
        // it.skip ('Mint tokens to users', async () => {
        //     await mint('bsctest', 1, tokenA, ethers.utils.parseUnits('100', decimalsA));
        //     await mint('bsctest', 2, tokenB, ethers.utils.parseUnits('100', decimalsB));
        //     await mint('fantom', 2, tokenC, ethers.utils.parseUnits('100', decimalsC));
        // })

        it ('2. Users request only deposit', async () => {
            await deposit('bsctest', 1, primaryVault, tokenA, ethers.utils.parseUnits('10', decimalsA));
            await deposit('bsctest', 1, primaryVault, tokenB, ethers.utils.parseUnits('15', decimalsB));
            await deposit('fantom', 1, secondaryVault, tokenC, ethers.utils.parseUnits('20', decimalsC));
        })

        // it ('Users request deposit and withdraw', async () => {
        //     await deposit('bsctest', 1, primaryVault, tokenA, ethers.utils.parseUnits('10', decimalsA));
        //     await deposit('bsctest', 2, primaryVault, tokenB, ethers.utils.parseUnits('10', decimalsB));
        //     await deposit('fantom', 2, secondaryVault, tokenC, ethers.utils.parseUnits('10', decimalsC));
        //     await withdraw('bsctest', 1, primaryVault, tokenA, ethers.utils.parseUnits('10', decimalsMLP));
        //     await withdraw('bsctest', 2, primaryVault, tokenB, ethers.utils.parseUnits('15', decimalsMLP));
        //     await withdraw('fantom', 2, secondaryVault, tokenC, ethers.utils.parseUnits('20', decimalsMLP));
        // })

        // it ('Users request only withdraw', async () => {
        //     await withdraw('bsctest', 1, primaryVault, tokenA, ethers.utils.parseUnits('10', decimalsMLP));
        //     await withdraw('bsctest', 2, primaryVault, tokenB, ethers.utils.parseUnits('15', decimalsMLP));
        //     await withdraw('fantom', 2, secondaryVault, tokenC, ethers.utils.parseUnits('20', decimalsMLP));
        // })

        // it ('2-4. Users request withdraw whole', async () => {
        //     await withdrawWhole('bsctest', 1, primaryVault, tokenB, primaryMozaicLP);
        //     // await withdrawWhole('bsctest', 2, primaryVault, tokenB, primaryMozaicLP);
        //     await withdrawWhole('fantom', 2, secondaryVault, tokenC, secondaryMozaicLP);
        // })

        it ('3. InitOptimizationSession', async () => {
            await initOptimization(primaryVault);
        })

        it ('4. Optimizing', async () => {
            // send whole token in primaryVault to secondaryVault
            hre.changeNetwork('bsctest');
            let amountLD = await tokenA.balanceOf(primaryVault.address);
            await swapRemote('bsctest', primaryVault, tokenA, 'fantom', secondaryVault, tokenC, amountLD);

            hre.changeNetwork('bsctest');
            amountLD = await tokenB.balanceOf(primaryVault.address);
            await swapRemote('bsctest', primaryVault, tokenB, 'fantom', secondaryVault, tokenC, amountLD);

            hre.changeNetwork('fantom');
            amountLD = await tokenC.balanceOf(secondaryVault.address);
            await stake('fantom', secondaryVault, tokenC, amountLD);
        })

        it ('5. Settle Requests', async () => {
            await settleRequests(primaryVault);
        })
        
    })
})