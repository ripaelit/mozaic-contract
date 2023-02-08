import {Bridge, ERC20, Factory, LPStaking, Pool, Router, StargateToken, LZEndpointMock } from '../types/typechain';

export type ChainPath = {
  sourceChainId: number,
  sourcePoolId: number,
  destinationChainId: number,
  destinationPoolId: number,
  weight: number,
};

export interface StargateDeploymentOnchain {
  routerContract: Router,
  factoryContract: Factory,
  bridgeContract: Bridge,
  lpStakingContract: LPStaking,
  pools: Map<number, Pool>,
  stargateToken: StargateToken,
};

export type StargateDeployments = Map<number, StargateDeploymentOnchain>;

export type LayerZeroDeployments = Map<number, LZEndpointMock>;

export type StableCoinDeployments = Map<number, Map<string, ERC20>>;
