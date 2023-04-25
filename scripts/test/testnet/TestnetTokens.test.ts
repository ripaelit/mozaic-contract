import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicTokenV2, MozaicTokenV2__factory, XMozaicToken, XMozaicToken__factory, XMozaicTokenBridge, XMozaicTokenBridge__factory } from '../../../types/typechain';
import { describe } from 'mocha';

const fs = require('fs');
const hre = require('hardhat');

describe('MozaicTokens', () => {
  let owner: SignerWithAddress;
  let signer: SignerWithAddress;
  let mozToken: MozaicTokenV2;
  let xMozToken: XMozaicToken;
  let xMozTokenBridge: XMozaicTokenBridge;
  let masterAddress: string;

  before(async () => {
    hre.changeNetwork('arbitrumGoerli');
    [owner, signer] = await ethers.getSigners();
    let json = JSON.parse(fs.readFileSync('deployTokensResult.json', 'utf-8'));
    const mozTokenfactory = (await ethers.getContractFactory('MozaicTokenV2', owner)) as MozaicTokenV2__factory;
    mozToken = mozTokenfactory.attach(json.mozaicTokenV2);
    const xMozTokenfactory = (await ethers.getContractFactory('XMozaicToken', owner)) as XMozaicToken__factory;
    xMozToken = xMozTokenfactory.attach(json.xMozaicToken);
    const xMozTokenBridgefactory = (await ethers.getContractFactory('XMozaicTokenBridge', owner)) as XMozaicTokenBridge__factory;
    xMozTokenBridge = xMozTokenBridgefactory.attach(json.xMozaicTokenBridge);
    masterAddress = await mozToken.masterAddress();
  })
  describe('MozaicTokenV2', () => {
    it ('initializeMasterAddress()', async () => {
      const oldMaster = await mozToken.masterAddress();
      const newMaster = owner.address;
      if (oldMaster == ethers.constants.AddressZero) {
        let tx = await mozToken.connect(owner).initializeMasterAddress(newMaster);
        await tx.wait();
        expect(await mozToken.masterAddress()).to.equal(newMaster);
      } else {
        await expect(mozToken.connect(owner).initializeMasterAddress(newMaster)).to.reverted;
      }
    })
    it ('initializeEmissionStart()', async () => {
      const blockNumBefore = await ethers.provider.getBlockNumber();
      const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      const newEmissionTime = blockBefore.timestamp + 100;
      const lastEmissionTime = await mozToken.lastEmissionTime();
      if (lastEmissionTime.eq(0)) {
        let tx = await mozToken.connect(owner).initializeEmissionStart(newEmissionTime);
        await tx.wait();
        expect(await mozToken.lastEmissionTime()).to.equal(newEmissionTime);
      } else {
        await expect(mozToken.connect(owner).initializeEmissionStart(blockBefore.timestamp)).to.be.reverted;
      }
    })
    it ('emitAllocations()', async () => {
      const treasury = await mozToken.treasuryAddress();
      const treasuryBalanceBefore = await mozToken.balanceOf(treasury);
      const mozBalanceBefore = await mozToken.balanceOf(mozToken.address);
      let tx = await mozToken.emitAllocations();
      await tx.wait();
      const treasuryBalanceAfter = await mozToken.balanceOf(treasury);
      const mozBalanceAfter = await mozToken.balanceOf(mozToken.address);
      expect(treasuryBalanceAfter).gt(treasuryBalanceBefore);
      expect(mozBalanceAfter).gt(mozBalanceBefore);
    })
    it ('claimMasterRewards()', async () => {
      const master = await mozToken.masterAddress();
      const masterBalanceBefore = await mozToken.balanceOf(master);
      const amount = ethers.utils.parseEther("0.1");
      let tx = await mozToken.connect(owner).claimMasterRewards(amount);
      await tx.wait();
      const masterBalanceAfter = await mozToken.balanceOf(master);
      console.log({masterBalanceBefore}, {masterBalanceAfter})
      expect(masterBalanceAfter.sub(masterBalanceBefore)).to.eq(amount);
    })
    it ('burn()', async () => {
      const amount = ethers.utils.parseEther("0.1");
      const balanceBefore = await mozToken.balanceOf(owner.address);
      let tx = await mozToken.connect(owner).burn(amount);
      await tx.wait();
      const balanceAfter = await mozToken.balanceOf(owner.address);
      expect(balanceBefore.sub(balanceAfter)).to.eq(amount);
    })
    it ('updateAllocations()', async () => {
      const farmingAllocation = await mozToken.farmingAllocation();
      const legacyAllocation = await mozToken.legacyAllocation();
      let tx = await mozToken.updateAllocations(farmingAllocation, legacyAllocation);
      await tx.wait();
      const farmingAllocationAfter = await mozToken.farmingAllocation();
      const legacyAllocationAfter = await mozToken.legacyAllocation();
      expect(farmingAllocationAfter).to.eq(farmingAllocation);
      expect(legacyAllocationAfter).to.eq(legacyAllocation);
    })
    it ('updateEmissionRate()', async () => {
      const emissionRate = await mozToken.emissionRate();
      let tx = await mozToken.updateEmissionRate(emissionRate);
      await tx.wait();
      const emissionRateAfter = await mozToken.emissionRate();
      expect(emissionRateAfter).to.eq(emissionRate);
    })
    it ('updateMaxSupply()', async () => {
      const maxSupply = await mozToken.elasticMaxSupply();
      let tx = await mozToken.updateMaxSupply(maxSupply);
      await tx.wait();
      const maxSupplyAfter = await mozToken.elasticMaxSupply();
      expect(maxSupplyAfter).to.eq(maxSupply);
    })
    it ('updateTreasuryAddress()', async () => {
      const treasury = await mozToken.treasuryAddress();
      let tx = await mozToken.connect(owner).updateTreasuryAddress(treasury);
      await tx.wait();
      const treasuryAfter = await mozToken.treasuryAddress();
      expect(treasuryAfter).to.eq(treasury);
    })
  })
  describe('XMozaicToken', () => {
    it ('updateRedeemSettings()', async () => {
      const minRatio = await xMozToken.minRedeemRatio();
      const medRatio = await xMozToken.mediumRedeemRatio();
      const maxRatio = await xMozToken.maxRedeemRatio();
      // const minDur = await xMozToken.minRedeemDuration();
      // const medDur = await xMozToken.mediumRedeemDuration();
      // const maxDur = await xMozToken.maxRedeemDuration();
      const minDur = 1;
      const medDur = 2;
      const maxDur = 3;
      let tx = await xMozToken.connect(owner).updateRedeemSettings(
        minRatio,
        medRatio,
        maxRatio,
        minDur,
        medDur,
        maxDur
      );
      await tx.wait();
      expect(await xMozToken.minRedeemRatio()).to.eq(minRatio);
      expect(await xMozToken.mediumRedeemRatio()).to.eq(medRatio);
      expect(await xMozToken.maxRedeemRatio()).to.eq(maxRatio);
      expect(await xMozToken.minRedeemDuration()).to.eq(minDur);
      expect(await xMozToken.mediumRedeemDuration()).to.eq(medDur);
      expect(await xMozToken.maxRedeemDuration()).to.eq(maxDur);
    })
    it ('updateDeallocationFee()', async () => {
      const fee = 200;  // MAX_DEALLOCATION_FEE
      let tx = await xMozToken.connect(owner).updateDeallocationFee(owner.address, fee);
      await tx.wait();
      expect(await xMozToken.usagesDeallocationFee(owner.address)).to.eq(fee);
    })
    it ('updateTransferWhitelist()', async () => {
      const newAccount = signer.address;
      const add = true;
      let tx = await xMozToken.connect(owner).updateTransferWhitelist(newAccount, add);
      await tx.wait();
      expect(await xMozToken.isTransferWhitelisted(newAccount)).to.eq(add);
    })
    it ('approveUsage()', async () => {
      const usageAddr = owner.address;
      const amount = ethers.utils.parseEther("1");
      let tx = await xMozToken.connect(owner).approveUsage(usageAddr, amount);
      await tx.wait();
      expect(await xMozToken.usageApprovals(owner.address, usageAddr)).to.eq(amount);
    })
    it ('convert()', async () => {
      const xMozBalanceBefore = await xMozToken.balanceOf(owner.address);
      const mozBalanceBefore = await mozToken.balanceOf(xMozToken.address);
      const amount = ethers.utils.parseEther("0.1");
      let tx = await mozToken.connect(owner).approve(xMozToken.address, amount);
      await tx.wait();
      tx = await xMozToken.connect(owner).convert(amount);
      await tx.wait();
      expect((await xMozToken.balanceOf(owner.address)).sub(xMozBalanceBefore)).to.eq(amount);
      expect((await mozToken.balanceOf(xMozToken.address)).sub(mozBalanceBefore)).to.eq(amount);
    })
    it.skip ('convertTo()', async () => {
      const to = signer.address;
      const xMozBalanceBefore = await xMozToken.balanceOf(to);
      const mozBalanceBefore = await mozToken.balanceOf(xMozToken.address);
      const amount = ethers.utils.parseEther("0.1");
      let tx = await mozToken.connect(owner).approve(xMozToken.address, amount);
      await tx.wait();
      tx = await xMozToken.connect(owner).convertTo(amount, to);
      await tx.wait();
      expect((await xMozToken.balanceOf(to)).sub(xMozBalanceBefore)).to.eq(amount);
      expect((await mozToken.balanceOf(xMozToken.address)).sub(mozBalanceBefore)).to.eq(amount);
    })
    it ('redeem()', async () => {
      const xMozBalancesBefore = await xMozToken.xMozBalances(owner.address);
      const redeemingAmountBefore = xMozBalancesBefore.redeemingAmount;
      const xMozAmount = ethers.utils.parseEther("0.02");
      const duration = 3;
      let tx = await xMozToken.connect(owner).redeem(xMozAmount, duration);
      await tx.wait();
      const xMozBalancesAfter = await xMozToken.xMozBalances(owner.address);
      const redeemingAmountAfter = xMozBalancesAfter.redeemingAmount;
      expect(redeemingAmountAfter.sub(redeemingAmountBefore)).to.eq(xMozAmount);
    })
    it ('cancelRedeem()', async () => {
      const xMozBalanceBefore = await xMozToken.balanceOf(owner.address);
      const redeem = await xMozToken.userRedeems(owner.address, 0);
      const xMozAmount = redeem.xMozAmount;
      let tx = await xMozToken.connect(owner).cancelRedeem(0);
      await tx.wait();
      expect((await xMozToken.balanceOf(owner.address)).sub(xMozBalanceBefore)).to.eq(xMozAmount);
    })
    it ('redeem()', async () => {
      const xMozBalancesBefore = await xMozToken.xMozBalances(owner.address);
      const redeemingAmountBefore = xMozBalancesBefore.redeemingAmount;
      const xMozAmount = ethers.utils.parseEther("0.02");
      const duration = 3;
      let tx = await xMozToken.connect(owner).redeem(xMozAmount, duration);
      await tx.wait();
      const xMozBalanceAfter = await xMozToken.xMozBalances(owner.address);
      const redeemingAmountAfter = xMozBalanceAfter.redeemingAmount;
      expect(redeemingAmountAfter.sub(redeemingAmountBefore)).to.eq(xMozAmount);
    })
    it ('finalizeRedeem()', async () => {
      const xMozAmount = ethers.utils.parseEther("0.02");
      const duration = 3;
      const mozAmount = await xMozToken.getMozByVestingDuration(xMozAmount, duration);
      const mozBalanceBefore = await mozToken.balanceOf(owner.address);
      let tx = await xMozToken.connect(owner).finalizeRedeem(0);
      await tx.wait();
      expect((await mozToken.balanceOf(owner.address)).sub(mozBalanceBefore)).to.eq(mozAmount);
    })
    it.skip ('allocate()', async () => {
      const usageAddr = owner.address;
      const amount = ethers.utils.parseEther("0.03");
      const xMozBalanceBefore = await xMozToken.balanceOf(owner.address);
      let tx = await xMozToken.connect(owner).allocate(usageAddr, amount, "0x");
      await tx.wait();
      expect(xMozBalanceBefore.sub(await xMozToken.balanceOf(owner.address))).to.eq(amount);
    })
    it ('allocateFromUsage()', async () => {
      const usage = owner;
      const amount = ethers.utils.parseEther("0.03");
      const user = owner.address;
      const xMozBalanceBefore = await xMozToken.balanceOf(owner.address);
      let tx = await xMozToken.connect(usage).allocateFromUsage(user, amount);
      await tx.wait();
      expect(xMozBalanceBefore.sub(await xMozToken.balanceOf(owner.address))).to.eq(amount);
    })
    it.skip ('deallocate()', async () => {
      const usageAddr = owner.address;
      const amount = ethers.utils.parseEther("0.03");
      const xMozBalanceBefore = await xMozToken.balanceOf(owner.address);
      let tx = await xMozToken.connect(owner).deallocate(usageAddr, amount, "");
      await tx.wait();
      expect(await xMozToken.balanceOf(owner.address)).gt(xMozBalanceBefore);
    })
    it ('deallocateFromUsage()', async () => {
      const usage = owner;
      const amount = ethers.utils.parseEther("0.03");
      const user = owner.address;
      const xMozBalanceBefore = await xMozToken.balanceOf(owner.address);
      let tx = await xMozToken.connect(usage).deallocateFromUsage(user, amount);
      await tx.wait();
      expect(await xMozToken.balanceOf(owner.address)).gt(xMozBalanceBefore);
    })
  })
})