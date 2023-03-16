import { ethers } from 'hardhat';
import { returnBalance, sendBalance } from '../util/testUtils';

async function main() {
    await returnBalance();
    await sendBalance([
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1"),
    ]);
    await returnBalance();
}
  
main()
    .then(() => process.exit(0))
    .catch((error) => {
    console.error(error);
        process.exit(1);
    });