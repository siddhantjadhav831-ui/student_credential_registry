'use client';

import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import {
  decodeEventLog,
  getAddress,
  isAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { credentialRegistryAbi } from '../lib/abi';
import { monadTestnet } from '../lib/config';

type CredentialRecord = {
  student: Address;
  issuedAt: bigint;
  documentHash: Hex;
  issuer: Address;
  revokedAt: bigint;
};
type VerificationTuple = readonly [number, CredentialRecord];
type TransactionAction = 'issue' | 'revoke' | 'add issuer' | 'remove issuer' | 'transfer admin';

const configuredAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
const contractAddress: Address = configuredAddress && isAddress(configuredAddress)
  ? getAddress(configuredAddress)
  : zeroAddress;
const hasContractAddress = contractAddress !== zeroAddress;
const explorerBase = monadTestnet.blockExplorers.default.url;

function parseCredentialId(value: string): bigint | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

async function sha256File(file: File): Promise<Hex> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `0x${hex}` as Hex;
}

function friendlyError(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== 'object') break;
    const detail = current as { message?: string; shortMessage?: string; data?: { errorName?: string }; cause?: unknown };
    if (detail.data?.errorName) messages.push(detail.data.errorName);
    if (detail.shortMessage) messages.push(detail.shortMessage);
    if (detail.message) messages.push(detail.message);
    current = detail.cause;
  }
  const message = messages.join(' ');
  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return 'The wallet request was rejected.';
  }
  if (/DuplicateActiveCredential/i.test(message)) return 'An active credential already exists for this student and document.';
  if (/UnauthorizedIssuer/i.test(message)) return 'This wallet is not authorized to issue credentials.';
  if (/UnauthorizedRevoker/i.test(message)) return 'Only the credential issuer or registry admin can revoke this credential.';
  if (/CredentialAlreadyRevoked/i.test(message)) return 'This credential has already been revoked.';
  if (/CredentialNotFound/i.test(message)) return 'No credential exists with that ID.';
  if (/IssuerAlreadyAuthorized/i.test(message)) return 'That wallet is already an authorized issuer.';
  if (/IssuerNotAuthorized/i.test(message)) return 'That wallet is not currently an authorized issuer.';
  if (/ZeroAddress/i.test(message)) return 'The zero address is not valid here.';
  if (/InvalidDocumentHash/i.test(message)) return 'The document hash is invalid.';
  if (/insufficient funds/i.test(message)) return 'The connected wallet does not have enough MON for gas.';
  const decodedError = message.match(/(?:reverted with (?:custom )?error[: ]+)([A-Za-z][A-Za-z0-9_]*)/i)?.[1];
  if (decodedError) return `The contract rejected this request (${decodedError}).`;
  if (message) return message.length > 240 ? `${message.slice(0, 237)}...` : message;
  return 'The request failed. Check the wallet, network, and transaction details, then try again.';
}

function formatDate(timestamp: bigint): string {
  if (timestamp === BigInt(0)) return 'Not revoked';
  return new Date(Number(timestamp) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function shortAddress(value?: string): string {
  if (!value) return 'Not available';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function statusLabel(status: number): string {
  return ['Not Found', 'Revoked', 'Document Hash Mismatch', 'Valid'][status] ?? 'Unknown';
}

function statusStyle(status: number): string {
  if (status === 3) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 1) return 'border-rose-200 bg-rose-50 text-rose-800';
  if (status === 2) return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-2 block text-sm font-semibold text-[#263c34]">{children}</label>;
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[#cbd6cf] bg-white px-3.5 py-3 text-sm text-[#14211d] outline-none transition placeholder:text-[#82918a] focus:border-[#2d7558] focus:ring-2 focus:ring-[#2d7558]/15 disabled:cursor-not-allowed disabled:bg-[#f2f5f3] ${props.className ?? ''}`}
    />
  );
}

function CredentialDetails({ credential }: { credential: CredentialRecord }) {
  const { student, issuedAt, documentHash, issuer, revokedAt } = credential;
  const status = revokedAt === BigInt(0) ? 'Valid' : 'Revoked';
  return (
    <dl className="mt-5 grid gap-4 border-t border-[#e4eae6] pt-5 sm:grid-cols-2">
      <Detail label="Student wallet" value={student} mono />
      <Detail label="Issuing faculty wallet" value={issuer} mono />
      <Detail label="Document SHA-256" value={documentHash} mono />
      <Detail label="Issued" value={formatDate(issuedAt)} />
      <Detail label="Revocation" value={formatDate(revokedAt)} />
      <Detail label="Record status" value={status} />
    </dl>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-[#74837b]">{label}</dt>
      <dd className={`mt-1 break-all text-sm text-[#1b2a23] ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function SectionTitle({ index, eyebrow, title, children }: {
  index: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e4eee7] font-mono text-sm font-bold text-[#286449]">
        {index}
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#537966]">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#172a21]">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#66766d]">{children}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, error: connectError, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, error: switchError, isPending: isSwitching } = useSwitchChain();
  const [verificationId, setVerificationId] = useState('');
  const [verificationFile, setVerificationFile] = useState<File | null>(null);
  const [verificationHash, setVerificationHash] = useState<Hex | null>(null);
  const [isHashingVerification, setIsHashingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState('');
  const [verificationRequest, setVerificationRequest] = useState<{ id: bigint; hash: Hex } | null>(null);
  const [studentAddress, setStudentAddress] = useState('');
  const [issueFile, setIssueFile] = useState<File | null>(null);
  const [issueHash, setIssueHash] = useState<Hex | null>(null);
  const [isHashingIssue, setIsHashingIssue] = useState(false);
  const [issueError, setIssueError] = useState('');
  const [issuerAddress, setIssuerAddress] = useState('');
  const [newAdminAddress, setNewAdminAddress] = useState('');
  const [revokeId, setRevokeId] = useState('');
  const [transactionAction, setTransactionAction] = useState<TransactionAction | null>(null);
  const [transactionMessage, setTransactionMessage] = useState('');
  const [transactionError, setTransactionError] = useState('');
  const [credentialIdCopied, setCredentialIdCopied] = useState(false);

  const roleReadsEnabled = Boolean(hasContractAddress && address && isConnected);
  const { data: adminAddress, error: adminReadError, refetch: refetchAdmin } = useReadContract({
    address: contractAddress,
    abi: credentialRegistryAbi,
    functionName: 'admin',
    query: { enabled: roleReadsEnabled },
  });
  const { data: issuerAuthorized, error: issuerReadError, refetch: refetchIssuer } = useReadContract({
    address: contractAddress,
    abi: credentialRegistryAbi,
    functionName: 'isIssuer',
    args: [address ?? zeroAddress],
    query: { enabled: roleReadsEnabled },
  });
  const verificationIdValue = parseCredentialId(verificationId);
  const {
    data: verificationData,
    error: verificationReadError,
    isError: isVerificationReadError,
    isFetching: isVerifying,
    refetch: refetchVerification,
  } = useReadContract({
    address: contractAddress,
    abi: credentialRegistryAbi,
    functionName: 'verifyCredential',
    args: verificationRequest ? [verificationRequest.id, verificationRequest.hash] : [BigInt(0), zeroHash],
    query: { enabled: Boolean(hasContractAddress && verificationRequest), retry: false },
  });
  const revokeIdValue = parseCredentialId(revokeId);
  const {
    data: revokeRecordData,
    isError: isRevokeRecordError,
    isFetching: isLoadingRevokeRecord,
  } = useReadContract({
    address: contractAddress,
    abi: credentialRegistryAbi,
    functionName: 'getCredential',
    args: [revokeIdValue ?? BigInt(0)],
    query: { enabled: Boolean(hasContractAddress && isConnected && revokeIdValue), retry: false },
  });

  const { writeContractAsync, isPending: isWalletPending } = useWriteContract();
  const [transactionHash, setTransactionHash] = useState<Hex | undefined>();
  const {
    data: transactionReceipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    isError: isReceiptError,
  } = useWaitForTransactionReceipt({
    hash: transactionHash,
    chainId: monadTestnet.id,
    query: { enabled: Boolean(transactionHash) },
  });

  const isAdmin = Boolean(address && adminAddress && address.toLowerCase() === adminAddress.toLowerCase());
  const isIssuer = issuerAuthorized === true;
  const onMonadTestnet = chainId === monadTestnet.id;
  const isWriting = isWalletPending || isConfirming;
  const revokeRecord = revokeRecordData as CredentialRecord | undefined;
  const canRevokeTarget = Boolean(
    address && revokeRecord && (isAdmin || address.toLowerCase() === revokeRecord.issuer.toLowerCase()),
  );
  const verificationResult = verificationData as VerificationTuple | undefined;
  const issuedCredentialId = (() => {
    if (!isConfirmed || transactionAction !== 'issue' || !transactionReceipt) return null;
    for (const log of transactionReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: credentialRegistryAbi,
          data: log.data,
          topics: log.topics,
          strict: false,
        });
        if (decoded.eventName === 'CredentialIssued' && decoded.args.credentialId !== undefined) {
          return decoded.args.credentialId.toString();
        }
      } catch {
        continue;
      }
    }
    return null;
  })();
  const visibleTransactionMessage = isConfirmed
    ? `${transactionAction ?? 'Transaction'} confirmed on Monad Testnet.`
    : transactionMessage;

  async function setFileHash(
    file: File | null,
    setSelectedFile: (file: File | null) => void,
    setHash: (hash: Hex | null) => void,
    setHashing: (hashing: boolean) => void,
    setError: (message: string) => void,
  ) {
    setSelectedFile(file);
    setHash(null);
    setError('');
    if (!file) return;
    setHashing(true);
    try {
      setHash(await sha256File(file));
    } catch {
      setError('This browser could not calculate the document hash. Try a supported browser.');
    } finally {
      setHashing(false);
    }
  }

  function onVerificationFileChange(event: ChangeEvent<HTMLInputElement>) {
    setVerificationRequest(null);
    void setFileHash(
      event.target.files?.[0] ?? null,
      setVerificationFile,
      setVerificationHash,
      setIsHashingVerification,
      setVerificationError,
    );
  }

  function onIssueFileChange(event: ChangeEvent<HTMLInputElement>) {
    void setFileHash(event.target.files?.[0] ?? null, setIssueFile, setIssueHash, setIsHashingIssue, setIssueError);
  }

  function verifyCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerificationError('');
    if (!verificationIdValue) {
      setVerificationError('Enter a credential ID greater than zero.');
      return;
    }
    if (!verificationFile || !verificationHash) {
      setVerificationError('Choose the original document and wait for its SHA-256 hash to finish.');
      return;
    }
    if (!hasContractAddress) {
      setVerificationError('The registry contract address is not configured correctly.');
      return;
    }
    setVerificationRequest({ id: verificationIdValue, hash: verificationHash });
  }

  function beginTransaction(action: TransactionAction) {
    setTransactionAction(action);
    setTransactionHash(undefined);
    setTransactionMessage(`Confirm ${action} in MetaMask.`);
    setTransactionError('');
    setCredentialIdCopied(false);
  }

  async function sendContractWrite(action: TransactionAction, request: Parameters<typeof writeContractAsync>[0]) {
    beginTransaction(action);
    try {
      const hash = await writeContractAsync(request);
      setTransactionHash(hash);
      setTransactionMessage(`Transaction submitted. Waiting for Monad Testnet confirmation.`);
    } catch (error) {
      setTransactionMessage('');
      setTransactionError(friendlyError(error));
    }
  }

  async function issueCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssueError('');
    if (!isAddress(studentAddress)) {
      setIssueError('Enter a valid student wallet address.');
      return;
    }
    if (getAddress(studentAddress) === zeroAddress) {
      setIssueError('The zero address cannot receive a credential.');
      return;
    }
    if (!issueFile || !issueHash) {
      setIssueError('Choose the project document and wait for its SHA-256 hash to finish.');
      return;
    }
    if (!isIssuer) {
      setIssueError('This connected wallet is not an authorized issuer.');
      return;
    }
    if (!hasContractAddress) {
      setIssueError('The registry contract address is not configured correctly.');
      return;
    }
    if (!onMonadTestnet) return;
    await sendContractWrite('issue', {
      address: contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'issueCredential',
      args: [getAddress(studentAddress), issueHash],
      chainId: monadTestnet.id,
    });
  }

  async function manageIssuer(action: 'add issuer' | 'remove issuer', event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!isAddress(issuerAddress)) {
      setTransactionError('Enter a valid issuer wallet address.');
      return;
    }
    if (!isAdmin || !onMonadTestnet || !hasContractAddress) return;
    await sendContractWrite(action, {
      address: contractAddress,
      abi: credentialRegistryAbi,
      functionName: action === 'add issuer' ? 'addIssuer' : 'removeIssuer',
      args: [getAddress(issuerAddress)],
      chainId: monadTestnet.id,
    });
  }

  async function transferAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAddress(newAdminAddress)) {
      setTransactionError('Enter a valid new admin wallet address.');
      return;
    }
    if (!isAdmin || !onMonadTestnet || !hasContractAddress) return;
    await sendContractWrite('transfer admin', {
      address: contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'transferAdmin',
      args: [getAddress(newAdminAddress)],
      chainId: monadTestnet.id,
    });
  }

  async function revokeCredential(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revokeIdValue) {
      setTransactionError('Enter a credential ID greater than zero.');
      return;
    }
    if (isRevokeRecordError || !revokeRecord) {
      setTransactionError('No credential exists with that ID.');
      return;
    }
    if (!canRevokeTarget) {
      setTransactionError('Only the original issuer or registry admin can revoke this credential.');
      return;
    }
    if (!onMonadTestnet || !hasContractAddress) return;
    await sendContractWrite('revoke', {
      address: contractAddress,
      abi: credentialRegistryAbi,
      functionName: 'revokeCredential',
      args: [revokeIdValue],
      chainId: monadTestnet.id,
    });
  }

  async function copyCredentialId() {
    if (!issuedCredentialId) return;
    try {
      await navigator.clipboard.writeText(issuedCredentialId);
      setCredentialIdCopied(true);
    } catch {
      setCredentialIdCopied(false);
    }
  }

  useEffect(() => {
    if (!isConfirmed || !transactionReceipt) return;
    void refetchAdmin();
    void refetchIssuer();
    if (verificationRequest) void refetchVerification();
  }, [isConfirmed, transactionReceipt, refetchAdmin, refetchIssuer, refetchVerification, verificationRequest]);

  const metamaskConnector = connectors.find((connector) => connector.id === 'metaMaskSDK');
  const walletRole = isAdmin ? 'Registry admin' : isIssuer ? 'Authorized issuer' : 'Public wallet';

  return (
    <main className="min-h-screen bg-[#f4f6f2] text-[#17251e]">
      <header className="border-b border-[#dfe6df] bg-[#fbfcfa]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#home" className="flex items-center gap-3" aria-label="Credence registry home">
            <span className="grid size-10 place-items-center rounded-xl bg-[#1e4937] text-lg font-semibold text-white">C</span>
            <span>
              <span className="block text-sm font-bold tracking-tight">Credence</span>
              <span className="block text-xs text-[#718077]">Student project registry</span>
            </span>
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#cbd9ce] bg-[#f1f7f1] px-3 py-2 text-xs font-semibold text-[#35634b]">
              <span className="size-2 rounded-full bg-[#3b9a62]" /> Monad Testnet
            </span>
            {isConnected ? (
              <div className="flex items-center gap-2">
                <span className="rounded-lg border border-[#d8e0da] bg-white px-3 py-2 font-mono text-xs text-[#40534a]">
                  {shortAddress(address)}
                </span>
                <button onClick={() => disconnect()} className="rounded-lg border border-[#d1dbd3] px-3 py-2 text-xs font-semibold hover:bg-[#f1f4f1]">
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => metamaskConnector && connect({ connector: metamaskConnector })}
                disabled={!metamaskConnector || isConnecting}
                className="rounded-lg bg-[#1e4937] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#286047] disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
              </button>
            )}
          </div>
        </div>
      </header>

      <div id="home" className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <section className="grid gap-8 border-b border-[#dce4dc] pb-10 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#47745b]">Academic work, verifiable by anyone</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight text-[#193527] sm:text-5xl">
              Project credentials that can be checked, not just claimed.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[#617168]">
              Faculty issue tamper-evident credentials for student projects. Documents stay on your device; only their SHA-256 fingerprints and minimal verification records go on-chain.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-l border-[#dce4dc] pl-5 lg:pl-7">
            <div>
              <p className="text-xs uppercase tracking-wide text-[#78867d]">Network</p>
              <p className="mt-1 text-sm font-semibold">Monad Testnet</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[#78867d]">Chain ID</p>
              <p className="mt-1 font-mono text-sm font-semibold">10143</p>
            </div>
            <div className="col-span-2 mt-2 min-w-0">
              <p className="text-xs uppercase tracking-wide text-[#78867d]">Registry contract</p>
              {hasContractAddress ? (
                <a href={`${explorerBase}/address/${contractAddress}`} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-xs text-[#286449] underline decoration-[#a9c3b1] underline-offset-2">
                  {contractAddress}
                </a>
              ) : (
                <p className="mt-1 text-sm text-rose-700">Contract address is missing or invalid.</p>
              )}
            </div>
          </div>
        </section>

        {!onMonadTestnet && isConnected && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <span>Connected to chain {chainId}. Transactions require Monad Testnet.</span>
            <button onClick={() => switchChain({ chainId: monadTestnet.id })} disabled={isSwitching} className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {isSwitching ? 'Switching...' : 'Switch to Monad Testnet'}
            </button>
          </div>
        )}
        {switchError && <p className="mt-3 text-sm text-rose-700">{friendlyError(switchError)}</p>}
        {connectError && <p className="mt-3 text-sm text-rose-700">{friendlyError(connectError)}</p>}

        <div className="mt-9 grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.82fr)]">
          <section className="min-w-0 border-b border-[#dce4dc] pb-8 xl:border-b-0 xl:border-r xl:pr-8">
            <SectionTitle index="01" eyebrow="Open verification" title="Verify a credential">
              Enter the credential ID and select the original document. The file is hashed locally and never uploaded.
            </SectionTitle>
            <form onSubmit={verifyCredential} className="space-y-5">
              <div>
                <FieldLabel>Credential ID</FieldLabel>
                <TextInput inputMode="numeric" value={verificationId} onChange={(event) => { setVerificationId(event.target.value); setVerificationRequest(null); }} placeholder="For example, 1" />
              </div>
              <div>
                <FieldLabel>Original project document</FieldLabel>
                <TextInput type="file" onChange={onVerificationFileChange} className="file:mr-4 file:rounded-md file:border-0 file:bg-[#e8f0e9] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#285a41]" />
                <p className="mt-2 text-xs leading-5 text-[#77867d]">SHA-256 uses the exact file bytes. No file content leaves this browser.</p>
              </div>
              {isHashingVerification && <p className="text-sm text-[#547461]">Calculating SHA-256...</p>}
              {verificationHash && <Detail label="Calculated document hash" value={verificationHash} mono />}
              {verificationError && <p role="alert" className="text-sm text-rose-700">{verificationError}</p>}
              <button type="submit" disabled={isVerifying || isHashingVerification || !hasContractAddress} className="rounded-lg bg-[#1e4937] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#286047] disabled:cursor-not-allowed disabled:opacity-50">
                {isVerifying ? 'Checking registry...' : 'Verify credential'}
              </button>
            </form>

            {isVerificationReadError && verificationRequest && (
              <p role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                Could not read the registry. Check the RPC connection and contract address. {friendlyError(verificationReadError)}
              </p>
            )}
            {verificationResult && verificationRequest && !isVerificationReadError && (
              <div className="mt-7 rounded-xl border border-[#dce4dc] bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#74837b]">Verification result</p>
                    <h3 className="mt-1 text-lg font-semibold">Credential #{verificationRequest.id.toString()}</h3>
                  </div>
                  <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${statusStyle(verificationResult[0])}`}>
                    {statusLabel(verificationResult[0])}
                  </span>
                </div>
                {verificationResult[0] === 0 ? (
                  <p className="mt-4 text-sm leading-6 text-[#65736b]">No credential exists with this ID.</p>
                ) : (
                  <>
                    <p className="mt-4 text-sm leading-6 text-[#65736b]">
                      {verificationResult[0] === 3
                        ? 'The uploaded document hash matches this active registry record.'
                        : verificationResult[0] === 1
                          ? 'This credential has been revoked. Revocation status is shown independently from document matching.'
                          : 'The credential exists, but the uploaded document hash does not match.'}
                    </p>
                    <p className={`mt-3 text-sm font-semibold ${verificationResult[1].documentHash.toLowerCase() === verificationRequest.hash.toLowerCase() ? 'text-emerald-800' : 'text-amber-800'}`}>
                      Uploaded document hash: {
  verificationResult[1].documentHash.toLowerCase() ===
  verificationRequest.hash.toLowerCase()
    ? 'Matches record'
    : 'Does not match record'
}
                    </p>
                    <CredentialDetails credential={verificationResult[1]} />
                  </>
                )}
              </div>
            )}
          </section>

          <section className="min-w-0">
            <SectionTitle index="02" eyebrow="Wallet workspace" title="Issuer and admin access">
              Connect MetaMask to check your on-chain role and manage credentials. Public verification above needs no wallet.
            </SectionTitle>

            {!isConnected ? (
              <div className="rounded-xl border border-dashed border-[#bdcbbf] bg-[#f9fbf8] p-6">
                <p className="text-sm font-semibold">Connect a faculty or admin wallet</p>
                <p className="mt-2 text-sm leading-6 text-[#6e7c73]">The registry reads your role from Monad Testnet before enabling any write actions.</p>
                <button onClick={() => metamaskConnector && connect({ connector: metamaskConnector })} disabled={!metamaskConnector || isConnecting} className="mt-4 rounded-lg bg-[#1e4937] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                  {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dce4dc] bg-white p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#74837b]">Connected wallet</p>
                    <p className="mt-1 break-all font-mono text-sm">{address}</p>
                  </div>
                  <span className="rounded-full bg-[#e8f0e9] px-3 py-1.5 text-xs font-bold text-[#285a41]">{walletRole}</span>
                </div>

                {(adminReadError || issuerReadError) && <p role="alert" className="text-sm text-rose-700">Could not read your contract role. Confirm the network and RPC are available.</p>}
                {!onMonadTestnet && <p className="text-sm text-amber-800">Switch to Monad Testnet before using transaction controls.</p>}

                {isAdmin && (
                  <div className="border-t border-[#dce4dc] pt-5">
                    <h3 className="text-base font-semibold">Issuer management</h3>
                    <p className="mt-1 text-sm text-[#6e7c73]">Authorize or remove faculty wallets. Changes are recorded on-chain.</p>
                    <form onSubmit={(event) => void manageIssuer('add issuer', event)} className="mt-4 space-y-3">
                      <div>
                        <FieldLabel>Faculty wallet address</FieldLabel>
                        <TextInput value={issuerAddress} onChange={(event) => setIssuerAddress(event.target.value)} placeholder="0x..." autoComplete="off" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={isWriting || !onMonadTestnet} className="rounded-lg bg-[#1e4937] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Add issuer</button>
                        <button type="button" disabled={isWriting || !onMonadTestnet || !isAddress(issuerAddress)} onClick={() => void manageIssuer('remove issuer')} className="rounded-lg border border-[#cad7cd] px-4 py-2.5 text-sm font-semibold text-[#334b3e] disabled:opacity-50">Remove issuer</button>
                      </div>
                    </form>
                    <form onSubmit={(event) => void transferAdmin(event)} className="mt-5 border-t border-[#e4eae6] pt-5">
                      <FieldLabel>Transfer admin to</FieldLabel>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <TextInput value={newAdminAddress} onChange={(event) => setNewAdminAddress(event.target.value)} placeholder="New admin wallet 0x..." autoComplete="off" />
                        <button type="submit" disabled={isWriting || !onMonadTestnet} className="shrink-0 rounded-lg border border-[#cad7cd] px-4 py-2.5 text-sm font-semibold text-[#334b3e] disabled:opacity-50">Transfer admin</button>
                      </div>
                    </form>
                  </div>
                )}

                {isIssuer && (
                  <div className="border-t border-[#dce4dc] pt-5">
                    <h3 className="text-base font-semibold">Issue a project credential</h3>
                    <p className="mt-1 text-sm text-[#6e7c73]">Only the student wallet and document hash are stored by the registry.</p>
                    <form onSubmit={(event) => void issueCredential(event)} className="mt-4 space-y-4">
                      <div>
                        <FieldLabel>Student wallet address</FieldLabel>
                        <TextInput value={studentAddress} onChange={(event) => setStudentAddress(event.target.value)} placeholder="0x..." autoComplete="off" />
                      </div>
                      <div>
                        <FieldLabel>Project document</FieldLabel>
                        <TextInput type="file" onChange={onIssueFileChange} className="file:mr-4 file:rounded-md file:border-0 file:bg-[#e8f0e9] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#285a41]" />
                        <p className="mt-2 text-xs leading-5 text-[#77867d]">The exact file bytes are hashed locally and never uploaded.</p>
                      </div>
                      {isHashingIssue && <p className="text-sm text-[#547461]">Calculating SHA-256...</p>}
                      {issueHash && <Detail label="Document SHA-256 to be issued" value={issueHash} mono />}
                      {issueError && <p role="alert" className="text-sm text-rose-700">{issueError}</p>}
                      <button type="submit" disabled={isWriting || isHashingIssue || !onMonadTestnet || !issueHash || !hasContractAddress} className="rounded-lg bg-[#1e4937] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                        {isWalletPending && transactionAction === 'issue' ? 'Confirm in MetaMask...' : isConfirming && transactionAction === 'issue' ? 'Waiting for confirmation...' : 'Issue credential'}
                      </button>
                    </form>
                  </div>
                )}

                <div className="border-t border-[#dce4dc] pt-5">
                  <h3 className="text-base font-semibold">Revoke a credential</h3>
                  <p className="mt-1 text-sm text-[#6e7c73]">Admin can revoke any record. An original issuer can revoke their own, including after issuer removal.</p>
                  <form onSubmit={(event) => void revokeCredential(event)} className="mt-4 space-y-3">
                    <div>
                      <FieldLabel>Credential ID</FieldLabel>
                      <TextInput inputMode="numeric" value={revokeId} onChange={(event) => setRevokeId(event.target.value)} placeholder="For example, 1" />
                    </div>
                    {revokeIdValue && isLoadingRevokeRecord && <p className="text-xs text-[#68776e]">Loading credential...</p>}
                    {revokeRecord && <p className="break-all text-xs text-[#68776e]">Record issuer: <span className="font-mono">{revokeRecord.issuer}</span></p>}
                    {isRevokeRecordError && revokeIdValue && <p className="text-xs text-rose-700">No credential exists with that ID.</p>}
                    <button type="submit" disabled={isWriting || !onMonadTestnet || !canRevokeTarget || !revokeIdValue} className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {isWalletPending && transactionAction === 'revoke' ? 'Confirm in MetaMask...' : isConfirming && transactionAction === 'revoke' ? 'Waiting for confirmation...' : 'Revoke credential'}
                    </button>
                  </form>
                </div>
              </div>
            )}

            {(visibleTransactionMessage || transactionError || isReceiptError) && (
              <div className={`mt-5 rounded-xl border p-4 ${transactionError || isReceiptError ? 'border-rose-200 bg-rose-50' : 'border-[#d7e4d9] bg-[#f5faf5]'}`}>
                {visibleTransactionMessage && <p className="text-sm font-medium text-[#2d5941]">{visibleTransactionMessage}</p>}
                {(transactionError || isReceiptError) && <p role="alert" className="text-sm text-rose-800">{transactionError || 'The transaction did not confirm successfully.'}</p>}
                {transactionHash && (
                  <a href={`${explorerBase}/tx/${transactionHash}`} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all font-mono text-xs text-[#286449] underline underline-offset-2">
                    Transaction: {transactionHash}
                  </a>
                )}
                {transactionAction === 'issue' && isConfirmed && issuedCredentialId && issueHash && address && (
                  <div className="mt-4 rounded-lg border border-[#cfe0d2] bg-white p-4">
                    <p className="text-sm font-bold text-[#1e4937]">Credential issued successfully</p>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-[#74837b]">Credential ID</dt>
                        <dd className="mt-1 flex flex-wrap items-center gap-2 font-mono">#{issuedCredentialId}
                          <button type="button" onClick={() => void copyCredentialId()} className="rounded-md border border-[#cad7cd] px-2 py-1 font-sans text-xs font-semibold text-[#285a41] hover:bg-[#f1f7f1]">
                            {credentialIdCopied ? 'Copied' : 'Copy ID'}
                          </button>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-[#74837b]">Student wallet</dt>
                        <dd className="mt-1 break-all font-mono text-xs">{getAddress(studentAddress)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-[#74837b]">Document SHA-256</dt>
                        <dd className="mt-1 break-all font-mono text-xs">{issueHash}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-[#74837b]">Issuer</dt>
                        <dd className="mt-1 break-all font-mono text-xs">{address}</dd>
                      </div>
                    </dl>
                    {transactionHash && (
                      <a href={`${explorerBase}/tx/${transactionHash}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-[#286449] underline underline-offset-2">
                        View transaction on Monad Explorer
                      </a>
                    )}
                  </div>
                )}
                {transactionAction === 'revoke' && isConfirmed && revokeIdValue && (
                  <button type="button" onClick={() => { setVerificationId(revokeId); setVerificationRequest(null); }} className="mt-3 block text-sm font-semibold text-[#286449] underline underline-offset-2">
                    Use credential #{revokeId} in public verification
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        <footer className="mt-12 flex flex-col gap-3 border-t border-[#dce4dc] pt-5 text-xs text-[#78867d] sm:flex-row sm:items-center sm:justify-between">
          <p>Documents stay off-chain. Verification reads are public and do not require a connected wallet.</p>
          {hasContractAddress && <a href={`${explorerBase}/address/${contractAddress}`} target="_blank" rel="noreferrer" className="font-semibold text-[#35634b] underline underline-offset-2">Open registry on Monad Explorer</a>}
        </footer>
      </div>
    </main>
  );
}
