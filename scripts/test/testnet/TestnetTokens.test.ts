import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MozaicLP__factory, MozaicVault__factory, MockToken__factory, MozaicVault, MockToken, MozaicLP, MozaicTokenV2, MozaicTokenV2__factory, XMozaicToken, XMozaicToken__factory, XMozaicTokenBridge, XMozaicTokenBridge__factory } from '../../../types/typechain';
import exportData from '../../constants/index';
import { describe } from 'mocha';
import { deposit, withdraw, withdrawWhole, mint, stake, unstake, swap, swapRemote, initOptimization, preSettleAllVaults, settleRequestsAllVaults } from '../../util/testUtils';
import { BigNumber } from 'ethers';
import { exec } from 'child_process';

const { expectRevert } = require('@openzeppelin/test-helpers');
const fs = require('fs');
const hre = require('hardhat');
// const { time } = require('@nomicfoundation/hardhat-network-helpers');
// import { time } from "@nomicfoundation/hardhat-network-helpers";

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
  // after(async () => {
  // })
  describe('MozaicTokenV2', () => {
    it ('initializeMasterAddress()', async () => {
      const oldMaster = await mozToken.masterAddress();
      const newMaster = owner.address;
      if (oldMaster == ethers.constants.AddressZero) {
        const tx = await mozToken.connect(owner).initializeMasterAddress(newMaster);
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
        const tx = await mozToken.connect(owner).initializeEmissionStart(newEmissionTime);
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
      const tx = await mozToken.emitAllocations();
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
      const tx = await mozToken.connect(owner).claimMasterRewards(amount);
      await tx.wait();
      const masterBalanceAfter = await mozToken.balanceOf(master);
      console.log({masterBalanceBefore}, {masterBalanceAfter})
      expect(masterBalanceAfter.sub(masterBalanceBefore)).to.eq(amount);
    })
    it ('burn()', async () => {
      const amount = ethers.utils.parseEther("0.1");
      const balanceBefore = await mozToken.balanceOf(owner.address);
      const tx = await mozToken.connect(owner).burn(amount);
      await tx.wait();
      const balanceAfter = await mozToken.balanceOf(owner.address);
      expect(balanceBefore.sub(balanceAfter)).to.eq(amount);
    })
    it ('updateAllocations()', async () => {
      const farmingAllocation = await mozToken.farmingAllocation();
      const legacyAllocation = await mozToken.legacyAllocation();
      const tx = await mozToken.updateAllocations(farmingAllocation, legacyAllocation);
      await tx.wait();
      const farmingAllocationAfter = await mozToken.farmingAllocation();
      const legacyAllocationAfter = await mozToken.legacyAllocation();
      expect(farmingAllocationAfter).to.eq(farmingAllocation);
      expect(legacyAllocationAfter).to.eq(legacyAllocation);
    })
    it ('updateEmissionRate()', async () => {
      const emissionRate = await mozToken.emissionRate();
      const tx = await mozToken.updateEmissionRate(emissionRate);
      await tx.wait();
      const emissionRateAfter = await mozToken.emissionRate();
      expect(emissionRateAfter).to.eq(emissionRate);
    })
    it ('updateMaxSupply()', async () => {
      const maxSupply = await mozToken.elasticMaxSupply();
      const tx = await mozToken.updateMaxSupply(maxSupply);
      await tx.wait();
      const maxSupplyAfter = await mozToken.elasticMaxSupply();
      expect(maxSupplyAfter).to.eq(maxSupply);
    })
    it ('updateTreasuryAddress()', async () => {
      const treasury = await mozToken.treasuryAddress();
      const tx = await mozToken.connect(owner).updateTreasuryAddress(treasury);
      await tx.wait();
      const treasuryAfter = await mozToken.treasuryAddress();
      expect(treasuryAfter).to.eq(treasury);
    })
  })
})