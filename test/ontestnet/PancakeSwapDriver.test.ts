import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployNew } from '../util/helpers';
import { PancakeSwapDriver, StargateToken, Bridge, Bridge__factory } from '../../types/typechain';
import { testnetTestConstants } from '../../constants/testnettest';
import { ActionTypeEnum } from '../../constants/types';
import { BigNumber } from 'ethers';

describe('PancakeSwapDriver', () => {
    let deployer: SignerWithAddress;
    let pancakeSwapDriver: PancakeSwapDriver;
    let bridgeFactory: Bridge__factory;
    let bridge: Bridge;
    let lzEndpoint;
    let stargateToken: StargateToken;
    let actionType = ActionTypeEnum.Swap;
    let payload: string;

    beforeEach(async () => {
        [deployer] = await ethers.getSigners();
        bridgeFactory = await ethers.getContractFactory('Bridge');
        bridge = bridgeFactory.attach(testnetTestConstants.stgBridge);
        lzEndpoint = await bridge.layerZeroEndpoint();
        // Deploy PancakeSwapDriver
        pancakeSwapDriver = await deployNew("PancakeSwapDriver") as PancakeSwapDriver;
        console.log("Deployed PancakeSwapDriver: address", pancakeSwapDriver.address);
        
        // Deploy Stargate Token
        stargateToken = await deployNew("StargateToken", ['Stargate Token', 'STG', lzEndpoint, testnetTestConstants.stgMainChainId, testnetTestConstants.amountSTGs]) as StargateToken;
        console.log("Deployed StargateToken: address, totalSupply:", stargateToken.address, (await stargateToken.totalSupply()).toNumber());

    })
    it ("can swap USDC->USDT", async () => {
        payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [BigNumber.from("1000000000000000000"), testnetTestConstants.USDC, testnetTestConstants.USDT]);
        expect(await pancakeSwapDriver.connect(deployer).execute(actionType, payload)).gt(0);
    })
    it ("can swap STG->USDC", async () => {
        payload = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [BigNumber.from("1000000000000000000"), stargateToken.address, testnetTestConstants.USDC]);
        expect(await pancakeSwapDriver.connect(deployer).execute(actionType, payload)).gt(0);
    })
})