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
    it('initializeMasterAddress() - reverts for zero master', async () => {
      // const newMaster = owner.address;
      // await expect(mozToken.connect(signer).initializeMasterAddress(newMaster)).to.be.revertedWith("Ownable: caller is not the owner");

      // try {
      //   const txresult = await mozToken.connect(signer).initializeMasterAddress(newMaster);
      //   console.log(txresult)
      //   const txreceipt = await txresult.wait()
      // } catch (error) {
      //   console.log(error);
      // }
    })
    it ('initializeMasterAddress()', async () => {
      // const oldMaster = await mozToken.masterAddress();
      // const newMaster = owner.address;
      // if (oldMaster == ethers.constants.AddressZero) {
      //   await mozToken.connect(owner).initializeMasterAddress(newMaster);
      //   expect(await mozToken.masterAddress()).to.equal(newMaster);
      // } else {
      //   // await expect(
      //   //   await mozToken
      //   //     .connect(owner)
      //   //     .initializeMasterAddress(newMaster)
      //   // ).to.revertedWith("initializeMasterAddress: master already initialized");

      //   await expect(
      //     mozToken
      //       .connect(owner)
      //       .initializeMasterAddress(newMaster)
      //   ).to.reverted;
      // }
      
    })
    it ('initializeEmissionStart() - reverts for invalid start time', async () => {
      // const timestamp = await time.latest();
      // await expect(
      //   mozToken
      //     .connect(owner)
      //     .initializeEmissionStart(timestamp)
      // ).to.be.reverted;
    })
    it ('initializeEmissionStart()', async () => {
      // const blockNumBefore = await ethers.provider.getBlockNumber();
      // const blockBefore = await ethers.provider.getBlock(blockNumBefore);
      // const newEmissionTime = blockBefore.timestamp + 100;
      // const lastEmissionTime = await mozToken.lastEmissionTime();
      // console.log({lastEmissionTime});
      // if (lastEmissionTime.eq(0)) {
      //   const tx = await mozToken.connect(owner).initializeEmissionStart(newEmissionTime);
      //   await tx.wait();
      //   expect(await mozToken.lastEmissionTime()).to.equal(newEmissionTime);
      // } else {
      //   await expect(
      //     mozToken
      //       .connect(owner)
      //       .initializeEmissionStart(blockBefore.timestamp)
      //   ).to.be.reverted;
      // }
    })
    it ('emitAllocations', async () => {
      // const treasury = await mozToken.treasuryAddress();
      // const treasuryBalanceBefore = await mozToken.balanceOf(treasury);
      // const master = await mozToken.masterAddress();
      // const masterBalanceBefore = await mozToken.balanceOf(master);
      // const tx = await mozToken.emitAllocations();
      // await tx.wait();
      // const treasuryBalanceAfter = await mozToken.balanceOf(treasury);
      // const masterBalanceAfter = await mozToken.balanceOf(mozToken.address);
      // expect(treasuryBalanceAfter).gt(treasuryBalanceBefore);
      // expect(masterBalanceAfter).gt(masterBalanceBefore);
    })
    it ('claimMasterRewards', async () => {
      // const master = await mozToken.masterAddress();
      // const masterBalanceBefore = await mozToken.balanceOf(master);
      // const amount = ethers.utils.parseEther("0.1");
      // const tx = await mozToken.connect(owner).claimMasterRewards(amount);
      // await tx.wait();
      // const masterBalanceAfter = await mozToken.balanceOf(master);
      // console.log({masterBalanceBefore}, {masterBalanceAfter})
      // expect(masterBalanceAfter.sub(masterBalanceBefore)).to.eq(amount);
    })
    it ('burn', async () => {
      const amount = ethers.utils.parseEther("0.1");
      const tx = await mozToken.connect(owner).burn(amount);
      await tx.wait();
    })
    it ('updateAllocations', async () => {
    })
    it ('updateEmissionRate', async () => {
    })
    it ('updateMaxSupply', async () => {
    })
    it ('updateTreasuryAddress', async () => {
      // const treasury = '0xBc1bE99E95593169C80C475D114d385c0940b573';
      // const tx = await mozToken.connect(owner).updateTreasuryAddress(treasury);
      // await tx.wait();
    })
    it ('masterAllocation', async () => {
    })
    it ('masterEmissionRate', async () => {
    })
    it ('treasuryAllocation', async () => {
    })
  })
})