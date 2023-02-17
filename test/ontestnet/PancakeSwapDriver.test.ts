import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployNew } from '../util/helpers';
import { SecondaryVault, PancakeSwapDriver, StargateToken } from '../../types/typechain';
import { testnetTestConstants } from '../../constants/testnettest';
import { ActionTypeEnum } from '../../constants/types';
import { BigNumber } from 'ethers';

describe('PancakeSwapDriver', () => {
    let deployer: SignerWithAddress;
    let pancakeSwapDriver: PancakeSwapDriver;
    let secondaryVault: SecondaryVault;
    let stargateToken: StargateToken;
    let driverIndex: number = 0;   // PancakeSwapDriverIndex
    let actionType = ActionTypeEnum.Swap;
    let payload: string;

    beforeEach(async () => {
        [deployer] = await ethers.getSigners();
        // Deploy PancakeSwapDriver
        pancakeSwapDriver = await deployNew("PancakeSwapDriver") as PancakeSwapDriver;
        // Deploy SecondaryVault
        secondaryVault = await deployNew("SecondaryVault") as SecondaryVault;
        // Deploy StargateToken
        stargateToken = await deployNew("StargateToken") as StargateToken;

        await secondaryVault.connect(deployer).setProtocolDriver(driverIndex, pancakeSwapDriver.address);
    })
    it ("can swap USDC->USDT", async () => {
        payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [BigNumber.from("1000000000000000000"), testnetTestConstants.USDC, testnetTestConstants.USDT]);
        expect(await pancakeSwapDriver.connect(deployer).execute(actionType, payload)).gt(0);
    })
    it ("can swap STG->USDC", async () => {
        payload = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [BigNumber.from("1000000000000000000"), stargateToken.address, testnetTestConstants.USDC]);
        expect(await pancakeSwapDriver.connect(deployer).execute(actionType, payload)).gt(0);
    })
})