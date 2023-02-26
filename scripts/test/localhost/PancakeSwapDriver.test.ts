import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { SecondaryVault, MozaicLP__factory, MockToken__factory, StargateToken, StargateToken__factory, PrimaryVault__factory, SecondaryVault__factory } from '../../../types/typechain';
import { StableCoinDeployments, StargateDeployments, MozaicDeployment, MozaicDeployments, StargateDeploymentOnchain, ActionTypeEnum } from '../../constants/types'
import exportData from '../../constants/index';
import { BigNumber } from 'ethers';
const fs = require('fs');

describe('PancakeSwapDriver', () => {
    let owner: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    // let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;
    let stgTokens: Map<number, StargateToken>;

    beforeEach(async () => {
        [owner] = await ethers.getSigners();  // owner is control center
        
        stablecoinDeployments = new Map<number, Map<string, string>>();
        mozaicDeployments = new Map<number, MozaicDeployment>();
        stgTokens = new Map<number, StargateToken>();
        
        // Parse local deploy info
        const dataArray = JSON.parse(fs.readFileSync('deployLocalResult.json', 'utf-8'));
        const mozaicLpFactory = (await ethers.getContractFactory('MozaicLP', owner)) as MozaicLP__factory;
        const primaryVaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
        const secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
        const stgTokenFactory = (await ethers.getContractFactory('StargateToken', owner)) as StargateToken__factory;
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

            // Get stgToken
            let stgToken = stgTokenFactory.attach(obj.stgToken);
            stgTokens.set(chainId, stgToken);
        }
    });
    describe('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const mockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcCoinAddr = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0])!;
            const usdcCoin = mockTokenFactory.attach(usdcCoinAddr);
            const usdtCoinAddr = stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1])!;
            const usdtCoin = mockTokenFactory.attach(usdtCoinAddr);
            const amountLD = BigNumber.from("100000000000000000000");   // 100$
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcCoin.address, usdtCoin.address]);
            
            // Mint USDC to SecondaryVault
            await usdcCoin.connect(owner).mint(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC, USDT:", (await usdcCoin.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));

            // Swap USDC to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

            // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has USDC, USDT:", (await usdcCoin.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            expect(await usdtCoin.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swap STG->USDT", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];// Bsc
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgTokenContract = stgTokens.get(chainId)!;
            const mockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdtCoin = mockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1])!);
            const amountLD = BigNumber.from("100000000000000000000");   // 100$
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgTokenContract.address, usdtCoin.address]);

            // Send STG to SecondaryVault
            await stgTokenContract.connect(owner).approve(secondaryVault.address, amountLD);
            await stgTokenContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has STG, USDT:", (await stgTokenContract.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            
            // Swap STG to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

             // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has STG, USDT:", (await stgTokenContract.balanceOf(secondaryVault.address)), (await usdtCoin.balanceOf(secondaryVault.address)));
            expect(await usdtCoin.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
    })
})