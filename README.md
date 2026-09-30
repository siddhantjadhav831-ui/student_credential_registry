# Web3-SkillBuildZ — Student Project Credential Verification Registry

A blockchain-based academic credential verification system that allows authorized faculty members to issue tamper-evident credentials for student projects and enables anyone to independently verify those credentials.

The system uses **Monad Testnet** to store a minimal, verifiable record on-chain while keeping the actual project documents off-chain.

---

## 📌 Overview

Academic project certificates and records are commonly stored and verified through centralized systems. This can make verification dependent on the institution's database and makes it difficult for an external party to independently confirm whether a document has been altered.

**Web3-SkillBuildZ** addresses this problem by creating a blockchain-backed credential registry.

An authorized faculty member can issue a credential containing:

* Student's wallet address
* Unique credential ID
* SHA-256 hash of the original project document
* Issuer's wallet address
* Issue timestamp
* Current revocation status

The actual project PDF or document is **never uploaded to the blockchain**.

When someone wants to verify a credential, they provide the credential ID and the original document. The application calculates the document's SHA-256 hash locally and compares it with the hash stored on-chain.

If the hashes match and the credential has not been revoked, the credential is considered valid.

> **Important:** The blockchain does not independently prove that a student completed a project. It proves that an authorized issuer recorded a credential associated with the student's wallet and a specific document hash.

---

## 🎯 Problem Statement

Academic project credentials can face several verification challenges:

* Certificates and project documents can be modified after issuance.
* Verification often depends on centralized institutional systems.
* External organizations may have difficulty independently verifying credentials.
* Maintaining and sharing large documents on-chain is expensive and unnecessary.
* There may be no simple way to check whether a previously issued credential has been revoked.

### Proposed Solution

Use a blockchain registry to store a **tamper-evident fingerprint and minimal credential metadata** instead of storing the complete document.

This provides:

1. Independent verification
2. Document tamper detection
3. On-chain issuance records
4. Credential revocation
5. Public verification without requiring a wallet
6. Lower storage requirements because documents remain off-chain

---

## 🏗️ System Architecture

```text
                    ┌───────────────────────┐
                    │     Faculty / Issuer  │
                    │      MetaMask Wallet  │
                    └───────────┬───────────┘
                                │
                                │ Issue Credential
                                ▼
                    ┌───────────────────────┐
                    │   Next.js Frontend    │
                    │                       │
                    │ SHA-256 File Hashing  │
                    └───────────┬───────────┘
                                │
                         Student Address
                         + Document Hash
                                │
                                ▼
              ┌──────────────────────────────────┐
              │      Monad Testnet Contract      │
              │                                  │
              │ Student Address                  │
              │ Document Hash                   │
              │ Issuer Address                   │
              │ Timestamp                       │
              │ Revocation Status               │
              └───────────────┬──────────────────┘
                              │
                              │ Public Verification
                              ▼
                    ┌───────────────────────┐
                    │     Anyone / Verifier │
                    │                       │
                    │ Credential ID         │
                    │ Original Document     │
                    └───────────┬───────────┘
                                │
                         SHA-256 locally
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Compare Hashes        │
                    │ + Check Revocation    │
                    └───────────┬───────────┘
                                │
                         Valid / Invalid
```

---

## 🔄 How It Works

### 1. Faculty Authorization

The contract administrator authorizes a faculty wallet as an issuer.

```text
Admin Wallet
     │
     ▼
Add Faculty Wallet
     │
     ▼
Faculty becomes Authorized Issuer
```

Only authorized issuers can issue credentials.

---

### 2. Credential Issuance

The faculty member connects their MetaMask wallet and provides:

* Student wallet address
* Original project document

The document is hashed locally using:

```text
SHA-256(document bytes)
```

Only the resulting `bytes32` hash and required metadata are sent to the blockchain.

The document itself remains on the user's device.

---

### 3. Credential ID Generation

The smart contract generates a unique credential ID.

For example:

```text
Credential ID: 1

Student:
0x1234...ABCD

Document Hash:
0x8f4a...91de

Issuer:
0x5678...EFGH

Issued At:
2026-10-01

Status:
Active
```

---

### 4. Public Verification

A verifier does not need to connect a wallet.

They provide:

```text
Credential ID
+
Original Project Document
```

The browser calculates the document's SHA-256 hash again.

The application then compares:

```text
Uploaded Document Hash
            │
            ▼
      SHA-256 Hash
            │
            ▼
   Compare with blockchain
            │
       ┌────┴────┐
       │         │
     Match    Mismatch
       │         │
       ▼         ▼
   Continue    Invalid
```

The contract also checks whether the credential has been revoked.

---

## ✅ Verification States

The registry supports four verification states:

| Status                 | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `NotFound`             | Credential ID does not exist                            |
| `Revoked`              | Credential was previously issued but has been revoked   |
| `DocumentHashMismatch` | Uploaded document differs from the original document    |
| `Valid`                | Credential exists, is active, and document hash matches |

---

## 🔐 Smart Contract

The main smart contract is:

```text
StudentProjectCredentialRegistry
```

### Contract Address — Monad Testnet

```text
0x25Db305e07AD6d4caD8c8532d3Dc43156967a621
```

### Network

```text
Monad Testnet
Chain ID: 10143
Native Token: MON
```

The contract is deployed using Hardhat Ignition.

---

## 📜 Smart Contract Data Model

Each credential contains:

```solidity
struct Credential {
    address student;
    uint64 issuedAt;
    bytes32 documentHash;
    address issuer;
    uint64 revokedAt;
}
```

The contract maintains:

```text
Admin
  │
  ├── Authorized Issuers
  │
  └── Credentials
          │
          ├── Student
          ├── Document Hash
          ├── Issuer
          ├── Issued At
          └── Revoked At
```

---

## 👥 Roles

### Admin

The deployer becomes the initial administrator.

The admin can:

* Add issuers
* Remove issuers
* Transfer administration
* Revoke any credential

### Issuer

An authorized faculty wallet can:

* Issue student credentials
* Revoke credentials that it originally issued

### Student

The student wallet is associated with the credential but does not need to perform an on-chain transaction.

### Public Verifier

Anyone can:

* Enter a credential ID
* Upload the original document
* Verify the credential

No wallet connection is required for public verification.

---

## 🛡️ Duplicate Credential Protection

The contract prevents multiple active credentials from being issued for the same:

```text
Student Wallet + Document Hash
```

The combination is converted into a unique key:

```solidity
keccak256(abi.encode(student, documentHash))
```

If the existing credential is revoked, the duplicate index is cleared and the same document can be reissued if required.

---

## 🔁 Revocation

Credentials can be revoked by:

* The administrator
* The original issuer

A revoked credential cannot be considered valid during verification.

The credential remains permanently recorded on-chain, but its status changes from active to revoked.

This preserves the historical issuance record while preventing a revoked credential from being treated as valid.

---

## 🔒 Privacy and Storage Design

The project intentionally follows an **off-chain document + on-chain proof** model.

### Stored on-chain

```text
Credential ID
Student Wallet
Document SHA-256 Hash
Issuer Wallet
Issue Timestamp
Revocation Timestamp
```

### NOT stored on-chain

```text
Project PDF
Project Images
Student Name
Student Roll Number
Project Description
Project Content
Personal Documents
```

This prevents unnecessarily storing large or sensitive documents on a public blockchain.

---

## 🧮 Why SHA-256?

SHA-256 produces a fixed-length cryptographic fingerprint of the document.

For example:

```text
Original Document
       │
       ▼
     SHA-256
       │
       ▼
256-bit Hash
```

Even a small change to the document produces a different hash.

Therefore:

```text
Original PDF
     │
     └── SHA-256 → Hash A

Modified PDF
     │
     └── SHA-256 → Hash B
```

If:

```text
Hash A ≠ Hash B
```

the document is not identical to the originally issued document.

The browser performs the hashing using the Web Crypto API, so the document does not need to be uploaded to a server.

---

## 🖥️ Application Features

### Public Verification

* No wallet required
* Credential ID input
* Document upload
* Local SHA-256 hashing
* On-chain verification
* Credential status display

### Issuer Dashboard

Authorized faculty can:

* Connect MetaMask
* Issue credentials
* Select the student's wallet address
* Upload the project document
* Generate its SHA-256 hash locally
* Submit the credential transaction
* View the generated credential ID

### Admin Dashboard

The administrator can:

* View admin status
* Add faculty issuers
* Remove faculty issuers
* Transfer admin ownership
* Revoke credentials

### Transaction Information

After successful transactions, the interface displays relevant blockchain information such as:

* Credential ID
* Student address
* Document hash
* Issuer address
* Transaction/explorer information

---

## 🧰 Technology Stack

### Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS

### Blockchain

* Solidity `^0.8.28`
* Monad Testnet
* Ethereum-compatible smart contract architecture

### Web3

* Wagmi
* Viem
* MetaMask

### Development

* Hardhat 2
* Hardhat Toolbox
* Hardhat Ignition
* TypeScript

### Cryptography

* SHA-256
* Web Crypto API

---

## 📁 Project Structure

```text
Web3-SkillBuildZ/
│
├── contracts/
│   └── StudentProjectCredentialRegistry.sol
│
├── ignition/
│   └── modules/
│       └── StudentProjectCredentialRegistry.ts
│
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   └── layout.tsx
│   │
│   └── lib/
│       ├── abi.ts
│       └── config.ts
│
├── test/
│   └── StudentProjectCredentialRegistry.ts
│
├── .env
├── hardhat.config.ts
├── package.json
├── package-lock.json
└── README.md
```

> `.env` should never be committed to GitHub.

---

## ⚙️ Local Setup

### 1. Clone the repository

```bash
git clone https://github.com/buildwithcirex/Web3-SkillBuildZ.git
cd Web3-SkillBuildZ
```

### 2. Install dependencies

The project uses Hardhat 2.

```bash
npm install
```

If dependencies need to be reinstalled according to the project configuration:

```bash
npm install --save-dev hardhat@^2.28.0 "@nomicfoundation/hardhat-toolbox@hh2"
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
PRIVATE_KEY=your_private_key_here
NEXT_PUBLIC_CONTRACT_ADDRESS=your_contract_address_here
```

**Never commit your private key or `.env` file.**

---

## 🧪 Compile the Smart Contract

```bash
npx hardhat compile
```

For a clean forced compilation:

```bash
npx hardhat compile --force
```

---

## 🧪 Run Tests

The smart contract includes automated tests covering authorization, issuance, verification, duplicate prevention, revocation, and administrative functionality.

Run:

```bash
npx hardhat test
```

Current implementation:

```text
27 tests passing
```

---

## 🚀 Deploy the Contract

Deploy to Monad Testnet using:

```bash
npx hardhat ignition deploy ignition/modules/StudentProjectCredentialRegistry.ts --network monadTestnet
```

After deployment, copy the resulting contract address into:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=...
```

---

## 💻 Run the Frontend

Start the development server:

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

---

## 🔗 User Flow

### Admin Flow

```text
Connect Admin Wallet
        │
        ▼
Monad Testnet
        │
        ▼
Authorize Faculty Wallet
        │
        ▼
Faculty Becomes Issuer
```

### Faculty Flow

```text
Connect Faculty Wallet
        │
        ▼
Enter Student Wallet
        │
        ▼
Select Project Document
        │
        ▼
Calculate SHA-256 Locally
        │
        ▼
Submit Transaction
        │
        ▼
Credential ID Generated
```

### Verification Flow

```text
Enter Credential ID
        │
        ▼
Select Original Document
        │
        ▼
Calculate SHA-256 Locally
        │
        ▼
Read Credential From Blockchain
        │
        ▼
Compare Hash + Revocation Status
        │
        ▼
Valid / Invalid / Revoked
```

---

## 🧪 Example

Suppose a student completes:

```text
Project: Face Recognition Attendance System
```

The faculty member selects the final project report:

```text
Face_Recognition_Project.pdf
```

The browser calculates:

```text
SHA-256:
A1B2C3D4...XYZ
```

The faculty issues the credential.

The blockchain stores:

```text
Credential ID: 1
Student: 0x1234...
Document Hash: A1B2C3D4...XYZ
Issuer: 0x5678...
Status: Active
```

Later, an organization receives the project document.

They enter:

```text
Credential ID: 1
```

and upload the document.

If the document is exactly the same:

```text
Uploaded Hash
      =
On-chain Hash

      ↓

Credential Valid
```

If somebody modifies even a small part of the document:

```text
Uploaded Hash
      ≠
On-chain Hash

      ↓

Document Hash Mismatch
```

---

## 🧑‍💻 Smart Contract Functions

### Administrative

```solidity
addIssuer(address issuer)
removeIssuer(address issuer)
transferAdmin(address newAdmin)
```

### Credential Management

```solidity
issueCredential(
    address student,
    bytes32 documentHash
)

revokeCredential(uint256 credentialId)
```

### Verification

```solidity
getCredential(uint256 credentialId)

verifyCredential(
    uint256 credentialId,
    bytes32 suppliedDocumentHash
)
```

---

## 🧾 Events

The contract emits events for important state changes:

```solidity
IssuerAdded(address indexed issuer)
IssuerRemoved(address indexed issuer)

CredentialIssued(
    uint256 indexed credentialId,
    address indexed student,
    address indexed issuer,
    bytes32 documentHash,
    uint64 issuedAt
)

CredentialRevoked(
    uint256 indexed credentialId,
    address indexed revoker,
    uint64 revokedAt
)

AdminTransferred(
    address indexed previousAdmin,
    address indexed newAdmin
)
```

These events provide an auditable history of registry activity.

---

## 🔐 Security Considerations

The project follows several security principles:

* Private keys are never stored in the smart contract.
* The private key is supplied through environment variables for deployment.
* Only the admin can manage issuer authorization.
* Only authorized issuers can create credentials.
* Only the admin or original issuer can revoke a credential.
* Zero addresses are rejected.
* Empty document hashes are rejected.
* Active duplicate credentials are prevented.
* Documents are not uploaded to the blockchain.
* Public verification does not require connecting a wallet.
* Credentials are not transferable.
* The system does not implement credentials as NFTs or tokens.

---

## ⚠️ Current Limitations

This project is currently designed as an academic/testnet prototype.

### Current limitations include:

* The system operates on Monad Testnet.
* The admin is initially the deployment wallet.
* The actual project document is not stored by the system.
* Verification requires access to the original document.
* Student identity is represented by a wallet address rather than a verified institutional identity.
* Admin transfer is currently a single-step operation.
* The system does not currently integrate with a college ERP or student database.
* Testnet credentials should not be treated as production academic records.

---

## 🔮 Future Improvements

Possible future extensions include:

* College/University identity integration
* Institutional authentication
* QR codes on certificates
* Verifiable credential standards
* IPFS or decentralized document references where appropriate
* Multi-signature administration
* Role-based institutional access
* Batch credential issuance
* Credential expiration
* Better student identity binding
* Mobile-friendly verification
* Production blockchain deployment
* Analytics dashboard for issued credentials
* Integration with academic ERP systems

---

## 📊 Testing

The smart contract has been tested for:

* Contract deployment
* Admin initialization
* Issuer authorization
* Duplicate issuer prevention
* Issuer removal
* Credential issuance
* Zero-address validation
* Invalid document hash validation
* Duplicate active credential prevention
* Credential retrieval
* Valid document verification
* Document hash mismatch
* Non-existent credential verification
* Credential revocation
* Unauthorized revocation
* Re-issuance after revocation
* Admin transfer
* Unauthorized administrative operations

Current test result:

```text
27 / 27 tests passing
```

---

## 🌐 Deployment

**Network:** Monad Testnet

**Chain ID:** `10143`

**Contract:**

```text
0x25Db305e07AD6d4caD8c8532d3Dc43156967a621
```

The frontend is configured to use the deployed registry through:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS
```

---

## 🎓 Academic Project Objective

The primary objective of this project is to demonstrate how blockchain can be used as a **tamper-evident verification layer for academic project credentials** without storing complete documents on-chain.

The project combines:

```text
Blockchain
     +
Smart Contracts
     +
Cryptographic Hashing
     +
Web3 Wallets
     +
Public Verification
```

to create a decentralized verification mechanism for academic project records.

---

## 👨‍💻 Project

**Web3-SkillBuildZ**

A student project demonstrating blockchain-backed academic credential verification using Monad Testnet.

Built with:

**Next.js · TypeScript · Solidity · Hardhat · Wagmi · Viem · MetaMask · Monad**
