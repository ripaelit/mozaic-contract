import exportData from '../constants';

export const getChainIdFromChainName = (chainName: string) => {
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