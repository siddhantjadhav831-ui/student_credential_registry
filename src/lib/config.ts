import { http, createConfig } from 'wagmi';
import { defineChain } from 'viem';
import { metaMask } from 'wagmi/connectors';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { 
      http: [
        'https://testnet-rpc.monad.xyz',
        'https://testnet-rpc.monadinfra.com',
        'https://rpc.ankr.com/monad_testnet'
      ] 
    },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
});

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    metaMask(),
  ],
  transports: {
    [monadTestnet.id]: http(),
  },
  ssr: true,
});
