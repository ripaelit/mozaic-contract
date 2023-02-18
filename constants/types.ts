import { Contract } from 'ethers';
import {Bridge, ERC20, Factory, LPStaking, Pool, Router, StargateToken, LZEndpointMock, MozaicLP, SecondaryVault, ILayerZeroEndpoint } from '../types/typechain';

export type StargateChainPath = {
  sourceChainId: number,
  sourcePoolId: number,
  destinationChainId: number,
  destinationPoolId: number,
  weight: number,
};

export interface StargateDeploymentOnchain {
  lzEndpoint: LZEndpointMock,
  routerContract: Router,
  factoryContract: Factory,
  bridgeContract: Bridge,
  lpStakingContract: LPStaking,
  pools: Map<number, Pool>,
  stargateToken: StargateToken,
};

export type MozaicDeployment = {
  mozaicLp: MozaicLP,
  mozaicVault: SecondaryVault,
  protocolDrivers: string[]
};

export type StargateDeployments = Map<number, StargateDeploymentOnchain>; // Map<chainId, StargateDeploymentOnchain>

export type LayerZeroDeployments = Map<number, LZEndpointMock>;           // Map<chainId, ILayerZeroEndpoint>

export type StableCoinDeployments = Map<number, Map<string, ERC20>>;      // Map<chainId, Map<coinname, coincontract>>

export type MozaicDeployments = Map<number, MozaicDeployment>;

export enum ActionTypeEnum {
    Swap = 0,
    SwapRemote = 1,
    GetPriceMil = 2,
    StargateStake = 4,
    StargateUnstake = 5
}