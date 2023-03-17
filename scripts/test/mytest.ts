import { ethers } from 'hardhat';
import { returnBalance, returnBalanceFrom, sendBalance } from '../util/testUtils';

async function main() {
    // await returnBalanceFrom([
    //     "0x2505F9e165bB950089B7725471Fc9373Ac85F6c7",
    //     "0x605A6498E75Abc7Da4A2219a1853CC5541DAFf7E",
    // ]);
    await sendBalance([
        ethers.utils.parseEther("5"),
        ethers.utils.parseEther("300"),
    ]);
    // await returnBalance();
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
        process.exit(1);
    });