import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PrimaryVault__factory, SecondaryVault, SecondaryVault__factory, MockToken, MockToken__factory } from '../../types/typechain';
import { ActionTypeEnum, ProtocolStatus, VaultStatus, MozaicDeployment } from '../constants/types';
import { setTimeout } from 'timers/promises';
import { BigNumber } from 'ethers';
import exportData from '../constants';
const fs = require('fs');
const hre = require('hardhat');

export const TIME_DELAY_MAX = 20 * 60 * 1000;  // 20 min

export const returnBalanceFrom = async (vaults: string[]) => {
    console.log("returnBalanceFrom");

    const primaryVaultAddr = vaults[0];
    const secondaryVaultAddr = vaults[1];

    let owner: SignerWithAddress;
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    const primaryvaultFactory = (await ethers.getContractFactory('PrimaryVault', owner)) as PrimaryVault__factory;
    const primaryVault = primaryvaultFactory.attach(primaryVaultAddr);
    let tx = await primaryVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("bsc vault balance", (await ethers.provider.getBalance(primaryVaultAddr)).toString());

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    const secondaryVaultFactory = (await ethers.getContractFactory('SecondaryVault', owner)) as SecondaryVault__factory;
    const secondaryVault = secondaryVaultFactory.attach(secondaryVaultAddr);
    tx = await secondaryVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("fantom vault balance", (await ethers.provider.getBalance(secondaryVaultAddr)).toString().toString());
}

export const returnBalance = async () => {
    console.log("returnBalance");

    // parse deploy result
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let primaryVaultAddr = json.mozaicVault;
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    let secondaryVaultAddr = json.mozaicVault;

    await returnBalanceFrom([primaryVaultAddr, secondaryVaultAddr]);
}

export const sendBalance = async (amounts: BigNumber[]) => {
    console.log("sendBalance");

    // parse deploy result
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let primaryVaultAddr = json.mozaicVault;
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    let secondaryVaultAddr = json.mozaicVault;

    let owner: SignerWithAddress;
        
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let tx = await owner.sendTransaction({
        to: primaryVaultAddr,
        value: amounts[0]
    });
    await tx.wait();
    console.log("bsc vault balance", (await ethers.provider.getBalance(primaryVaultAddr)).toString());

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    tx = await owner.sendTransaction({
        to: secondaryVaultAddr,
        value: amounts[1]
    });
    await tx.wait();
    console.log("fantom vault balance", (await ethers.provider.getBalance(secondaryVaultAddr)).toString());
}

const getChainIdFromChainName = (chainName: string) => {
    let chainNames = exportData.testnetTestConstants.chainNames;
    let chainId = 0;
    for (const [_chainId, _chainName] of chainNames) {
        if (_chainName === chainName) {
            chainId = _chainId;
            break;
        }
    }
    return chainId;
}

export const deposit = async (
    chainName: string, 
    signerIndex: number, 
    vault: SecondaryVault, 
    token: MockToken, 
    amount: number
) => {
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    let chainId = getChainIdFromChainName(chainName);
    let amountLD = ethers.utils.parseUnits(amount.toString(), await token.decimals());

    let tx = await token.connect(signer).approve(vault.address, amountLD);
    await tx.wait();
    tx = await vault.connect(signer).addDepositRequest(amountLD, token.address, chainId);
    await tx.wait();
    console.log("%s: signer%d requests deposit %s %s", chainName, signerIndex, amountLD.toString(), await token.name());
}

export const withdraw = async (
    chainName: string, 
    signerIndex: number, 
    vault: SecondaryVault, 
    token: MockToken, 
    amount: number
) => {
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    let chainId = getChainIdFromChainName(chainName);
    let amountMLP = ethers.utils.parseUnits(amount.toString(), exportData.testnetTestConstants.MOZAIC_DECIMALS);

    let tx = await vault.connect(signer).addWithdrawRequest(amountMLP, token.address, chainId);
    await tx.wait();
    console.log("%s: signer%d requests withdraw %s MLP to %s", chainName, signerIndex, amountMLP.toString(), await token.name());
}

export const mint = async (
    chainName: string,
    signerIndex: number,
    token: MockToken,
    amount: number
) => {
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    let owner = signers[0];
    let amountLD = ethers.utils.parseUnits(amount.toString(), await token.decimals());
    let tx = await token.connect(owner).mint(signer.address, amountLD);
    await tx.wait();
    console.log("%s: minted %s %s to signer%d in %s", chainName, amountLD.toString(), await token.name(), signerIndex);
}

export const stake = async(
    chainName: string,
    vault: SecondaryVault, 
    token: MockToken,
    amountLD: BigNumber
) => {
    let owner: SignerWithAddress;
    const payloadStake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, token.address]);
    console.log("payloadStake", payloadStake);
    const stakeAction: SecondaryVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.stargateDriverId,
        actionType: ActionTypeEnum.StargateStake,
        payload : payloadStake
    };
    
    hre.changeNetwork(chainName);
    [owner] = await ethers.getSigners();
    let tx = await vault.connect(owner).executeActions([stakeAction]);
    await tx.wait();
}

export const unstake = async(
    chainName: string,
    vault: SecondaryVault, 
    token: MockToken,
    amountMLP: BigNumber
) => {
    let owner: SignerWithAddress;
    const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountMLP, token.address]);
    console.log("payloadUnstake", payloadUnstake);
    const unstakeAction: SecondaryVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.stargateDriverId,
        actionType: ActionTypeEnum.StargateUnstake,
        payload : payloadUnstake
    };
    
    hre.changeNetwork(chainName);
    [owner] = await ethers.getSigners();
    let tx = await vault.connect(owner).executeActions([unstakeAction]);
    await tx.wait();
}

export const swap = async(
    chainName: string,
    vault: SecondaryVault, 
    srcToken: MockToken,
    dstToken: MockToken,
    amountLD: BigNumber
) => {
    let owner: SignerWithAddress;
    const payloadSwap = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, srcToken.address, dstToken.address]);
    console.log("payloadSwap", payloadSwap);
    const swapAction: SecondaryVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
        actionType: ActionTypeEnum.Swap,
        payload : payloadSwap
    };
    
    hre.changeNetwork(chainName);
    [owner] = await ethers.getSigners();
    let tx = await vault.connect(owner).executeActions([swapAction]);
    await tx.wait();
}

export const swapRemote = async(
    srcChainName: string,
    srcVault: SecondaryVault,
    srcToken: MockToken,
    dstChainName: string,
    dstVault: SecondaryVault,
    dstToken: MockToken,
    amount: number
) => {
    let owner: SignerWithAddress;
    const dstChainId = getChainIdFromChainName(dstChainName);
    const dstPoolId = exportData.testnetTestConstants.poolIds.get(await dstToken.name())!;

    hre.changeNetwork(srcChainName);
    const amountSrcBefore = await srcToken.balanceOf(srcVault.address);
    const amountSwapRemoteLD = ethers.utils.parseUnits(amount.toString(), await srcToken.decimals());

    hre.changeNetwork(dstChainName);
    const amountDstBefore = await dstToken.balanceOf(dstVault.address);

    // swapRemote
    hre.changeNetwork(srcChainName);
    [owner] = await ethers.getSigners();
    const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountSwapRemoteLD, srcToken.address, dstChainId, dstPoolId]);
    console.log("payloadSwapRemote", payloadSwapRemote);
    const swapRemoteAction: SecondaryVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.stargateDriverId,
        actionType: ActionTypeEnum.SwapRemote,
        payload : payloadSwapRemote
    };
    let tx = await srcVault.connect(owner).executeActions([swapRemoteAction]);
    await tx.wait();

    // Check result
    hre.changeNetwork(srcChainName);
    const amountSrcRemain = await srcToken.balanceOf(srcVault.address);
    hre.changeNetwork(dstChainName);
    let amountDstRemain: BigNumber;
    let timeDelayed = 0;
    let success = false;
    const timeInterval = 10000;
    while (timeDelayed < TIME_DELAY_MAX) {
        amountDstRemain = await dstToken.balanceOf(dstVault.address);
        if (amountDstRemain.eq(amountDstBefore)) {
            console.log("Waiting for LayerZero delay...");
            await setTimeout(timeInterval);
            timeDelayed += timeInterval;
        } else {
            success = true;
            console.log("LayerZero succeeded in %d seconds", timeDelayed / 1000);
            console.log("Before swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcBefore.toString(), amountDstBefore.toString());
            console.log("After swapRemote, srcVault has srcToken %d, dstVault has dstToken %d", amountSrcRemain.toString(), amountDstRemain.toString());
            expect(amountDstRemain).gt(amountDstBefore);
            break;
        }
    }
    if (!success) {
        console.log("Timeout LayerZero in swapRemote");
    }
}