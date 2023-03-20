import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PrimaryVault__factory, SecondaryVault, SecondaryVault__factory, MockToken__factory } from '../../types/typechain';
import { BigNumber } from 'ethers';
import exportData from '../constants';
const fs = require('fs');
const hre = require('hardhat');

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
    tokenName: string, 
    amount: number
) => {
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let owner = signers[0];
    let signer = signers[signerIndex];
    let chainId = getChainIdFromChainName(chainName);
    let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
    let tokenAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get(tokenName)!;
    let token = MockTokenFactory.attach(tokenAddr);
    let amountLD = ethers.utils.parseUnits(amount.toString(), await token.decimals());

    let tx = await token.connect(signer).approve(vault.address, amountLD);
    await tx.wait();
    tx = await vault.connect(signer).addDepositRequest(amountLD, token.address, chainId);
    await tx.wait();
    console.log("Signer%d requests deposit %s %s in %s", signerIndex, amountLD.toString(), await token.name(), chainName);
}

export const withdraw = async (
    chainName: string, 
    signerIndex: number, 
    vault: SecondaryVault, 
    tokenName: string, 
    amount: number
) => {
    hre.changeNetwork(chainName);
    let signers = await ethers.getSigners();
    let owner = signers[0];
    let signer = signers[signerIndex];
    let chainId = getChainIdFromChainName(chainName);
    let MockTokenFactory = await ethers.getContractFactory('MockToken', owner) as MockToken__factory;
    let tokenAddr = exportData.testnetTestConstants.stablecoins.get(chainId)!.get(tokenName)!;
    let token = MockTokenFactory.attach(tokenAddr);
    let amountMLP = ethers.utils.parseUnits(amount.toString(), exportData.testnetTestConstants.MOZAIC_DECIMALS);

    let tx = await vault.connect(signer).addWithdrawRequest(amountMLP, token.address, chainId);
    await tx.wait();
    console.log("Signer%d requests withdraw %s MLP to %s in %s", signerIndex, amountMLP.toString(), await token.name(), chainName);
}