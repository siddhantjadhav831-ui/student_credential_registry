# Web3SkillBuildz 🚀

A modern Web3 decentralized application built with Next.js 14, Tailwind CSS, Wagmi v2, Viem, and Hardhat v2, specifically configured for the **Monad Testnet**.

## ⚠️ Important Installation Rules 

Web3 tooling dependencies can be extremely sensitive to version mismatches (especially between ESM/CommonJS and Hardhat versions). **Follow these exact rules to avoid breaking the app:**

### 1. Hardhat Versions (CRITICAL)
This project uses **Hardhat v2** (specifically `^2.28.0`). 
Do **NOT** update to Hardhat v3 or install `@nomicfoundation/hardhat-toolbox@latest`. If you do, you will encounter ESM/CommonJS peer dependency conflicts, and the `hardhat.config.ts` will throw `HH19` and `HH13` errors.

If you ever need to reinstall dependencies, you must use the exact `hh2` tag for the toolbox:
```bash
npm install --save-dev hardhat@^2.28.0 "@nomicfoundation/hardhat-toolbox@hh2"
```
*(Also ensure `"type": "module"` is **not** present in your `package.json`!)*

### 2. Wagmi and MetaMask
This project explicitly uses the `metaMask()` connector from `@wagmi/connectors`. It does **not** use the generic `injected()` connector. 
If you get a "Cannot find module '@metamask/connect-evm'" error, ensure you install it:
```bash
npm install @metamask/connect-evm
```

---

## 🛠️ Local Development Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create a `.env` file in the root of the project:
```env
# Your EVM Wallet Private Key (for deploying contracts)
PRIVATE_KEY=your_private_key_here

# The deployed smart contract address to show on the frontend
NEXT_PUBLIC_CONTRACT_ADDRESS=your_contract_address_here
```

### 3. Smart Contract Deployment (Monad Testnet)
Compile and deploy the `Greeter` smart contract to the Monad Testnet using Hardhat Ignition:
```bash
npx hardhat compile
npx hardhat ignition deploy ignition/modules/Greeter.ts --network monadTestnet
```
*Note: Make sure the wallet corresponding to your PRIVATE_KEY has testnet MON tokens to pay for gas!*

After deploying, copy the deployed contract address into your `.env` file as `NEXT_PUBLIC_CONTRACT_ADDRESS`.

### 4. Start the Frontend
If you updated the `.env` file while the server was running, you **must** restart it for Next.js to detect the new variables:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application. 

### 🦊 Troubleshooting MetaMask Connections
- **"Switch to Testnet First"**: If the UI asks you to switch networks, it means your MetaMask is connected to a different network like Monad Mainnet (Chain ID 143) instead of Monad Testnet (Chain ID 10143). Click the button to automatically switch.
- **"Failed to fetch" warnings in console**: Testnet RPCs are frequently rate-limited. The app is configured with multiple fallback RPCs (`testnet-rpc.monadinfra.com`, `rpc.ankr.com/monad_testnet`), so Wagmi will automatically handle retries in the background.
