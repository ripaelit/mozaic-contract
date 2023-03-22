import { ethers } from 'hardhat';
import { returnBalance, returnBalanceFrom, sendBalance } from '../util/testUtils';

async function main() {
    await returnBalanceFrom([
        "0x1B7F72a89447486Af0e25E8545F04b70ea254DBa",
        "0x4847072f62AeFa4F8D3dA9634aF9A91e585d391b",
    ]);

    await sendBalance([
        ethers.utils.parseEther("2"),
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