import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { deployNew } from '../util/helpers';
import { SecondaryVault, PancakeSwapDriver, MozaicLP, Bridge, Bridge__factory, LZEndpointMock, LPStaking, StargateToken } from '../../types/typechain';
import { testnetTestConstants } from '../../constants/testnettest';
import { ActionTypeEnum } from '../../constants/types';
import { BigNumber } from 'ethers';

describe('SecondaryVault', () => {
    let deployer: SignerWithAddress;
    let chainId: number = 10121;    // Goerli (Ethereum Testnet)
    let router: string = testnetTestConstants.stgRouter;
    let bridgeFactory: Bridge__factory;
    let bridge: Bridge;
    let lzEndpoint: string;
    let stargateToken: StargateToken;
    let lpStaking: LPStaking;
    let mozaicLP: MozaicLP;
    let secondaryVault: SecondaryVault;

    beforeEach(async () => {
        [deployer] = await ethers.getSigners();
        
        bridgeFactory = await ethers.getContractFactory('Bridge');
        bridge = bridgeFactory.attach(testnetTestConstants.stgBridge);
        lzEndpoint = await bridge.layerZeroEndpoint();

        // Deploy Stargate Token
        stargateToken = await deployNew("StargateToken", ['Stargate Token', 'STG', lzEndpoint, testnetTestConstants.stgMainChainId, testnetTestConstants.amountSTGs]) as StargateToken;
        console.log("Deployed StargateToken: chainId, address, totalSupply:", chainId, stargateToken.address, await stargateToken.totalSupply());

        // Deploy LPStaking contract
        const latestBlockNumber = await ethers.provider.getBlockNumber();
        lpStaking = await deployNew("LPStaking", [stargateToken.address, BigNumber.from("100000"), latestBlockNumber + 3, latestBlockNumber + 3]) as LPStaking;
        console.log("Deployed LPStaking: chainId, address, totalAllocPoint:", chainId, lpStaking.address, await lpStaking.totalAllocPoint());
        
        // Deploy MozaicLP
        mozaicLP = await deployNew("MozaicLP", ["MLP", "MLP", lzEndpoint]) as MozaicLP; // fourth parameter

        // Deploy SecondaryVault
        secondaryVault = await deployNew("SecondaryVault", [lzEndpoint, chainId, router, lpStaking.address, stargateToken.address, mozaicLP.address]) as SecondaryVault;

        // Transfer Ownership of mozaicLP from deployer to secondaryVault
        mozaicLP.transferOwnership(secondaryVault.address);

    })
    it ("stake and unstake", async () => {
        const stakeAction: SecondaryVault.ActionStruct  = {
            driverIndex: 0, // no meaning for stake
            actionType: ActionTypeEnum.StargateStake,
            payload: ethers.utils.defaultAbiCoder.encode(["uint256","address"], [testnetTestConstants.amountStake, testnetTestConstants.USDC])
        };
        await secondaryVault.connect(deployer).executeActions([stakeAction]);

        const unstakeAction: SecondaryVault.ActionStruct  = {
            driverIndex: 0, // no meaning for stake
            actionType: ActionTypeEnum.StargateUnstake,
            payload: ethers.utils.defaultAbiCoder.encode(["uint256","address"], [BigNumber.from("1000000000000000000"), mozaicLP.address])
        };
        await secondaryVault.connect(deployer).executeActions([unstakeAction]);
    })
});