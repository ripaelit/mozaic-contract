import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { SecondaryVault, MockToken__factory, StargateToken } from '../../../types/typechain';
import { deployAllToLocalNets } from '../../util/deployUtils';
import { StargateDeployments, StableCoinDeployments, MozaicDeployment, MozaicDeployments, StargateDeploymentOnchain, ActionTypeEnum } from '../../constants/types'
import exportData from '../../constants/index';
import { BigNumber } from 'ethers';

describe('PancakeSwapDriver', () => {
    let owner: SignerWithAddress;
    let stablecoinDeployments: StableCoinDeployments;
    let stargateDeployments: StargateDeployments;
    let mozaicDeployments: MozaicDeployments;
    let primaryChainId: number;

    beforeEach(async () => {
        [owner] = await ethers.getSigners();  // owner is control center
        
        stablecoinDeployments = new Map<number, Map<string, string>>();
        stargateDeployments = new Map<number, StargateDeploymentOnchain>();
        mozaicDeployments = new Map<number, MozaicDeployment>();
        primaryChainId = exportData.localTestConstants.mozaicMainChainId;
        
        await deployAllToLocalNets(owner, primaryChainId, stablecoinDeployments, stargateDeployments, mozaicDeployments);
    });
    describe('PancakeSwapDriver.execute', () => {
        it ("can swap USDC->USDT", async () => {
            const chainId = exportData.localTestConstants.chainIds[0];// Ethereum
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdcContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![0])!);
            const usdtContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1])!);
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, usdcContract.address, usdtContract.address]);
            
            // Mint USDC to SecondaryVault
            await usdcContract.connect(owner).mint(secondaryVault.address, amountLD);
            console.log("SecondaryVault has USDC, USDT:", (await usdcContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            
            // Swap USDC to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

            // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has USDC, USDT:", (await usdcContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            expect(await usdtContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
        it ("can swap STG->USDC", async () => {
            const chainId = exportData.localTestConstants.chainIds[1];// Bsc
            const secondaryVault = mozaicDeployments.get(chainId)!.mozaicVault;
            const stgContract = stargateDeployments.get(chainId)!.stargateToken as StargateToken;
            const MockTokenFactory = (await ethers.getContractFactory('MockToken', owner)) as MockToken__factory;
            const usdtContract = MockTokenFactory.attach(stablecoinDeployments.get(chainId)!.get(exportData.localTestConstants.stablecoins.get(chainId)![1])!);
            const amountLD = BigNumber.from("1234567890");
            const payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, stgContract.address, usdtContract.address]);

            // Send STG to SecondaryVault
            await stgContract.connect(owner).approve(secondaryVault.address, amountLD);
            await stgContract.connect(owner).transfer(secondaryVault.address, amountLD);
            console.log("SecondaryVault has STG, USDT:", (await stgContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            
            // Swap STG to USDT
            const swapAction: SecondaryVault.ActionStruct  = {
                driverIndex: exportData.localTestConstants.pancakeSwapDriverId,
                actionType: ActionTypeEnum.Swap,
                payload : payload
            };
            await secondaryVault.connect(owner).executeActions([swapAction]);

             // Check USDT amount of SecondaryVault
            console.log("Now SecondaryVault has STG, USDT:", (await stgContract.balanceOf(secondaryVault.address)), (await usdtContract.balanceOf(secondaryVault.address)));
            expect(await usdtContract.balanceOf(secondaryVault.address)).gt(BigNumber.from("0"));
        })
    })
})