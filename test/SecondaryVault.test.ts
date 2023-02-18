import { expect } from 'chai';
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
            await vaultContract.connect(alice).addDepositRequest(amountLD, coinContract.address, chainId);
            // fund move from Alice to vault
            expect(await coinContract.balanceOf(alice.address)).to.lt(aliceBalBefore);
            expect(await coinContract.balanceOf(alice.address)).to.eq(0);
            expect(await coinContract.balanceOf(vaultContract.address)).to.eq(amountLD);
            // reqest put to pending
            expect(await vaultContract.getDepositRequestAmount(false, alice.address, coinContract.address, chainId)).to.gt(0);
        })
    });
});
