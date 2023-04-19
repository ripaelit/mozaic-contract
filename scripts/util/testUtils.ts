import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MockToken, LPStaking__factory, MozaicLP, MozaicVault, MozaicVault__factory } from '../../types/typechain';
import { ActionTypeEnum, ProtocolStatus } from '../constants/types';
import { setTimeout } from 'timers/promises';
import { BigNumber } from 'ethers';
import exportData from '../constants';
import { getLzChainIdFromChainName, switchNetwork } from './utils'
const fs = require('fs');
const hre = require('hardhat');

export const TIME_DELAY_MAX = 20 * 60 * 1000;  // 20min
export const TIME_INTERVAL = 60 * 1000; // 60s

export const returnBalanceFrom = async (vaults: string[]) => {
    console.log("returnBalanceFrom");
    let owner: SignerWithAddress;
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let mozaicVaultFactory = (await ethers.getContractFactory('MozaicVault', owner)) as MozaicVault__factory;
    let mozaicVault = mozaicVaultFactory.attach(vaults[0]);
    let tx = await mozaicVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("bsc vault balance", (await ethers.provider.getBalance(vaults[0])).toString());

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    mozaicVaultFactory = (await ethers.getContractFactory('MozaicVault', owner)) as MozaicVault__factory;
    mozaicVault = mozaicVaultFactory.attach(vaults[1]);
    tx = await mozaicVault.connect(owner).returnBalance();
    await tx.wait();
    console.log("fantom vault balance", (await ethers.provider.getBalance(vaults[1])).toString().toString());
}

export const returnBalance = async () => {
    console.log("returnBalance");

    // parse deploy result
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let bscVaultAddr = json.mozaicVault;
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    let fantomVaultAddr = json.mozaicVault;

    await returnBalanceFrom([bscVaultAddr, fantomVaultAddr]);
}

export const sendBalance = async (amounts: BigNumber[]) => {
    console.log("sendBalance");

    // parse deploy result
    let json = JSON.parse(fs.readFileSync('deployBscResult.json', 'utf-8'));
    let bscVaultAddr = json.mozaicVault;
    json = JSON.parse(fs.readFileSync('deployFantomResult.json', 'utf-8'));
    let fantomVaultAddr = json.mozaicVault;

    let owner: SignerWithAddress;
        
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let tx = await owner.sendTransaction({
        to: bscVaultAddr,
        value: amounts[0]
    });
    await tx.wait();
    console.log("bsc vault balance", (await ethers.provider.getBalance(bscVaultAddr)).toString());

    hre.changeNetwork('fantom');
    [owner] = await ethers.getSigners();
    tx = await owner.sendTransaction({
        to: fantomVaultAddr,
        value: amounts[1]
    });
    await tx.wait();
    console.log("fantom vault balance", (await ethers.provider.getBalance(fantomVaultAddr)).toString());
}

export const mint = async (
    chainName: string,
    signerIndex: number,
    token: MockToken,
    amountLD: BigNumber
) => {
    console.log("Mint: %s signer%d %s %s", chainName, signerIndex, await token.name(), amountLD.toString());

    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    let owner = signers[0];

    // check
    const amountBalanceBefore = await token.balanceOf(signer.address);

    let tx = await token.connect(owner).mint(signer.address, amountLD);
    await tx.wait();

    // check
    const amountBalance = await token.balanceOf(signer.address);
    console.log("amountBalanceBefore %s, amountBalance %s", amountBalanceBefore.toString(), amountBalance.toString());
    expect(amountBalance.sub(amountBalanceBefore)).eq(amountLD);
}

export const deposit = async (
    chainName: string, 
    signerIndex: number, 
    vault: MozaicVault, 
    token: MockToken, 
    amountLD: BigNumber
) => {
    console.log("Deposit: %s signer%d %s %s", chainName, signerIndex, await token.name(), amountLD.toString());

    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    let chainId = getLzChainIdFromChainName(chainName);

    // check
    const totalDepositAmountBefore = await vault.getTotalDepositAmount(false);
    const depositAmountBefore = await vault.getDepositAmount(false, signer.address, token.address, chainId);
    const depositAmountPerTokenABefore = await vault.getDepositAmountPerToken(false, token.address);

    let tx = await token.connect(signer).approve(vault.address, amountLD);
    await tx.wait();
    tx = await vault.connect(signer).addDepositRequest(amountLD, token.address, chainId);
    await tx.wait();

    // check
    const amountMD = amountLD.div(10 ** (await token.decimals() - exportData.testnetTestConstants.MOZAIC_DECIMALS));
    const totalDepositAmount = await vault.getTotalDepositAmount(false);
    const depositAmount = await vault.getDepositAmount(false, signer.address, token.address, chainId);
    const depositAmountPerTokenA = await vault.getDepositAmountPerToken(false, token.address);
    console.log("totalDepositAmountBefore %s, totalDepositAmount %s", totalDepositAmountBefore.toString(), totalDepositAmount.toString());
    console.log("depositAmountBefore %s, depositAmount %s", depositAmountBefore.toString(), depositAmount.toString());
    console.log("depositAmountPerTokenABefore %s, depositAmountPerTokenA %s", depositAmountPerTokenABefore.toString(), depositAmountPerTokenA.toString());
    expect(totalDepositAmount.sub(totalDepositAmountBefore)).to.eq(amountMD);
    expect(depositAmount.sub(depositAmountBefore)).to.eq(amountMD);
    expect(depositAmountPerTokenA.sub(depositAmountPerTokenABefore)).to.eq(amountMD);
}

export const withdrawWhole = async (
    chainName: string, 
    signerIndex: number, 
    vault: MozaicVault, 
    token: MockToken,
    mozaicLP: MozaicLP
) => {
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    const amountMLP = await mozaicLP.balanceOf(signer.address);
    await withdraw(chainName, signerIndex, vault, token, amountMLP);
}

export const withdraw = async (
    chainName: string, 
    signerIndex: number, 
    vault: MozaicVault, 
    token: MockToken, 
    amountMLP: BigNumber
) => {
    console.log("Withdraw: %s signer%d %s %s MLP", chainName, signerIndex, await token.name(), amountMLP.toString());
    
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let signer = signers[signerIndex];
    let chainId = getLzChainIdFromChainName(chainName);

    // check
    const totalWithdrawAmountBefore = await vault.getTotalWithdrawAmount(false);
    const withdrawAmountBefore = await vault.getWithdrawAmount(false, signer.address, chainId, token.address);
    const withdrawAmountPerTokenABefore = await vault.getWithdrawAmountPerToken(false, token.address);

    let tx = await vault.connect(signer).addWithdrawRequest(amountMLP, token.address, chainId);
    await tx.wait();

    // check
    const totalWithdrawAmount = await vault.getTotalWithdrawAmount(false);
    const withdrawAmount = await vault.getWithdrawAmount(false, signer.address, chainId, token.address);
    const withdrawAmountPerTokenA = await vault.getWithdrawAmountPerToken(false, token.address);
    console.log("totalWithdrawAmountBefore %s, totalWithdrawAmount %s", totalWithdrawAmountBefore.toString(), totalWithdrawAmount.toString());
    console.log("withdrawAmountBefore %s, withdrawAmount %s", withdrawAmountBefore.toString(), withdrawAmount.toString());
    console.log("withdrawAmountPerTokenABefore %s, withdrawAmountPerTokenA %s", withdrawAmountPerTokenABefore.toString(), withdrawAmountPerTokenA.toString());
    expect(totalWithdrawAmount.sub(totalWithdrawAmountBefore)).to.eq(amountMLP);
    expect(withdrawAmount.sub(withdrawAmountBefore)).to.eq(amountMLP);
    expect(withdrawAmountPerTokenA.sub(withdrawAmountPerTokenABefore)).to.eq(amountMLP);
}

export const stake = async(
    chainName: string,
    vault: MozaicVault, 
    token: MockToken,
    amountLD: BigNumber
) => {
    console.log("Stake: %s %s %s", chainName, await token.name(), amountLD.toString());
    
    let owner: SignerWithAddress;
    const payloadStake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLD, token.address]);
    console.log("payloadStake", payloadStake);
    const stakeAction: MozaicVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.stargateDriverId,
        actionType: ActionTypeEnum.StargateStake,
        payload : payloadStake
    };

    // Check token and lpStaked
    hre.changeNetwork(chainName);
    [owner] = await ethers.getSigners();
    const amountTokenBefore = await token.connect(owner).balanceOf(vault.address);
    // let lpStakingAddr = await vault.stargateLpStaking();
    // let lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
    // let lpStaking = lpStakingFactory.attach(lpStakingAddr);
    // const lpStakingPoolIndex = exportData.testnetTestConstants.lpStakingPoolIndex.get(chainName)!.get(await token.name())!;
    // const amountLPStakedBefore = (await lpStaking.userInfo(BigNumber.from(lpStakingPoolIndex.toString()), vault.address)).amount;

    let tx = await vault.connect(owner).executeActions([stakeAction]);
    await tx.wait();

    // Check token and lpStaked
    const amountToken = await token.connect(owner).balanceOf(vault.address);
    // const amountLPStaked = (await lpStaking.userInfo(BigNumber.from(lpStakingPoolIndex.toString()), vault.address)).amount;
    // console.log("Before stake token %d, LpStaked %d", amountTokenBefore.toString(), amountLPStakedBefore.toString());
    // console.log("After stake token %d, LpStaked %d", amountToken.toString(), amountLPStaked.toString());
    expect(amountTokenBefore.sub(amountToken)).to.eq(amountLD);
    // expect(amountLPStaked).gt(amountLPStakedBefore);
}

export const unstake = async(
    chainName: string,
    vault: MozaicVault, 
    token: MockToken,
    amountLP: BigNumber
) => {
    console.log("Unstake: %s LP %s -> %s", chainName, amountLP.toString(), await token.name());
    
    let owner: SignerWithAddress;
    const payloadUnstake = ethers.utils.defaultAbiCoder.encode(["uint256","address"], [amountLP, token.address]);
    console.log("payloadUnstake", payloadUnstake);
    const unstakeAction: MozaicVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.stargateDriverId,
        actionType: ActionTypeEnum.StargateUnstake,
        payload : payloadUnstake
    };
    
    // Check token and lpStaked
    hre.changeNetwork(chainName);
    [owner] = await ethers.getSigners();
    const amountTokenBefore = await token.connect(owner).balanceOf(vault.address);
    // let lpStakingAddr = await vault.stargateLpStaking();
    // let lpStakingFactory = (await ethers.getContractFactory('LPStaking', owner)) as LPStaking__factory;
    // let lpStaking = lpStakingFactory.attach(lpStakingAddr);
    // const lpStakingPoolIndex = exportData.testnetTestConstants.lpStakingPoolIndex.get(chainName)!.get(await token.name())!;
    // const amountLPStakedBefore = (await lpStaking.userInfo(BigNumber.from(lpStakingPoolIndex.toString()), vault.address)).amount;

    let tx = await vault.connect(owner).executeActions([unstakeAction]);
    await tx.wait();

    // Check token and lpStaked
    const amountToken = await token.connect(owner).balanceOf(vault.address);
    // const amountLPStaked = (await lpStaking.userInfo(BigNumber.from(lpStakingPoolIndex.toString()), vault.address)).amount;
    // console.log("Before unstake token %d, LpStaked %d", amountTokenBefore.toString(), amountLPStakedBefore.toString());
    // console.log("After unstake token %d, LpStaked %d", amountToken.toString(), amountLPStaked.toString());
    expect(amountToken).gt(amountTokenBefore);
    // expect(amountLPStakedBefore.sub(amountLPStaked)).eq(amountLP);
}

export const swap = async(
    chainName: string,
    vault: MozaicVault, 
    srcToken: MockToken,
    dstToken: MockToken,
    amountLD: BigNumber
) => {
    console.log("Swap: %s %s %s -> %s", chainName, await srcToken.name(), amountLD.toString(), await dstToken.name());

    let owner: SignerWithAddress;
    const payloadSwap = ethers.utils.defaultAbiCoder.encode(["uint256","address", "address"], [amountLD, srcToken.address, dstToken.address]);
    console.log("payloadSwap", payloadSwap);
    const swapAction: MozaicVault.ActionStruct  = {
        driverId: exportData.testnetTestConstants.pancakeSwapDriverId,
        actionType: ActionTypeEnum.Swap,
        payload : payloadSwap
    };
    
    // check token
    hre.changeNetwork(chainName);
    [owner] = await ethers.getSigners();
    const amountSrcBefore = await srcToken.balanceOf(vault.address);
    const amountDstBefore = await dstToken.balanceOf(vault.address);

    let tx = await vault.connect(owner).executeActions([swapAction]);
    await tx.wait();

    // check token
    const amountSrc = await srcToken.balanceOf(vault.address);
    const amountDst = await dstToken.balanceOf(vault.address);
    console.log("Before swap, srcToken %d, dstToken %d", amountSrcBefore.toString(), amountDstBefore.toString());
    console.log("After swap, srcToken %d, dstToken %d", amountSrc.toString(), amountDst.toString());
    expect(amountSrc).lt(amountSrcBefore);
    expect(amountDst).gt(amountDstBefore);
}

export const swapRemote = async(
    srcChainName: string,
    srcVault: MozaicVault,
    srcToken: MockToken,
    dstChainName: string,
    dstVault: MozaicVault,
    dstToken: MockToken,
    amountLD: BigNumber
) => {
    console.log("SwapRemote: %s %s %s -> %s %s", srcChainName, await srcToken.name(), amountLD.toString(), dstChainName, await dstToken.name());

    let owner: SignerWithAddress;
    const dstChainId = getLzChainIdFromChainName(dstChainName);
    const dstPoolId = exportData.testnetTestConstants.poolIds.get(await dstToken.name())!;

    // check token
    hre.changeNetwork(srcChainName);
    const amountSrcBefore = await srcToken.balanceOf(srcVault.address);
    hre.changeNetwork(dstChainName);
    const amountDstBefore = await dstToken.balanceOf(dstVault.address);

    // swapRemote
    hre.changeNetwork(srcChainName);
    [owner] = await ethers.getSigners();
    const payloadSwapRemote = ethers.utils.defaultAbiCoder.encode(["uint256","address","uint16","uint256"], [amountLD, srcToken.address, dstChainId, dstPoolId]);
    console.log("payloadSwapRemote", payloadSwapRemote);
    const swapRemoteAction: MozaicVault.ActionStruct  = {
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
    while (timeDelayed < TIME_DELAY_MAX) {
        amountDstRemain = await dstToken.balanceOf(dstVault.address);
        if (amountDstRemain.eq(amountDstBefore)) {
            console.log("Waiting for LayerZero delay...");
            await setTimeout(TIME_INTERVAL);
            timeDelayed += TIME_INTERVAL;
        } else {
            success = true;
            console.log("LayerZero succeeded in %d seconds", timeDelayed / 1000);
            console.log("Before swapRemote, srcToken %s, dstToken %s", amountSrcBefore.toString(), amountDstBefore.toString());
            console.log("After swapRemote, srcToken %s, dstToken %s", amountSrcRemain.toString(), amountDstRemain.toString());
            expect(amountSrcRemain).lt(amountSrcBefore);
            expect(amountDstRemain).gt(amountDstBefore);
            break;
        }
    }
    if (!success) {
        console.log("Timeout LayerZero in swapRemote");
    }
}

export const initOptimization = async (
    mainVault: MozaicVault
) => {
    console.log("initOptimization:");

    let owner: SignerWithAddress;
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let tx = await mainVault.connect(owner).initOptimizationSession();
    await tx.wait();
    console.log("Owner called initOptimizationSession");

    let timeDelayed = 0;
    let success = false;
    while (timeDelayed < TIME_DELAY_MAX) {
        let protocolStatus = await mainVault.protocolStatus();
        if (protocolStatus == ProtocolStatus.OPTIMIZING) {
            success = true;
            const totalMLP = await mainVault.totalMLP();
            const totalCoinMD = await mainVault.totalCoinMD();
            console.log("initOptimization in %d seconds, totalMLP %s, totalCoinMD %s", timeDelayed / 1000, totalMLP.toString(), totalCoinMD.toString());
            break;
        } else {
            console.log("Waiting for lz_report_snapshot...");
            await setTimeout(TIME_INTERVAL);
            timeDelayed += TIME_INTERVAL;
        }
    }
    if (!success) {
        console.log("Timeout lz_report_snapshot");
    }
}

export const preSettleAllVaults = async (
    mainVault: MozaicVault
) => {
    console.log("preSettleAllVaults:");
    
    let owner: SignerWithAddress;
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    let tx = await mainVault.connect(owner).preSettleAllVaults();
    await tx.wait();
}

export const settleRequestsAllVaults = async (
    vaults: MozaicVault[]
) => {
    console.log("settleRequestsAllVaults:");

    let owner: SignerWithAddress;

    for (let i = 0; i < exportData.testnetTestConstants.chainIds.length; ++i) {
        let timeDelayed = 0;
        let success = false;
        switchNetwork(exportData.testnetTestConstants.chainIds[i]);
        [owner] = await ethers.getSigners();
        while (timeDelayed < TIME_DELAY_MAX) {
            let settleAllowed = await vaults[i].settleAllowed();
            if (settleAllowed) {
                let tx = await vaults[i].connect(owner).settleRequests();
                await tx.wait();
                success = true;
                console.log("settleRequests in %d seconds", timeDelayed / 1000);
                break;
            } else {
                console.log("Waiting for lz_pre_settle...");
                await setTimeout(TIME_INTERVAL);
                timeDelayed += TIME_INTERVAL;
            }
        }
        if (!success) {
            console.log("Timeout lz_pre_settle");
        }
    }

    let timeDelayed = 0;
    let success = false;
    hre.changeNetwork('bsctest');
    [owner] = await ethers.getSigners();
    while (timeDelayed < TIME_DELAY_MAX) {
        let protocolStatus = await vaults[0].protocolStatus();
        if (protocolStatus == ProtocolStatus.IDLE) {
            success = true;
            console.log("settleRequestsAllVaults in %d seconds", timeDelayed / 1000);
            break;
        } else {
            console.log("Waiting for lz_settle_report...");
            await setTimeout(TIME_INTERVAL);
            timeDelayed += TIME_INTERVAL;
        }
    }
    if (!success) {
        console.log("Timeout lz_settle_report");
    }
}