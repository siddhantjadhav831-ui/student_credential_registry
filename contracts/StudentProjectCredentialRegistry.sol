// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract StudentProjectCredentialRegistry {
    enum VerificationStatus {
        NotFound,
        Revoked,
        DocumentHashMismatch,
        Valid
    }

    struct Credential {
        address student;
        uint64 issuedAt;
        bytes32 documentHash;
        address issuer;
        uint64 revokedAt;
    }

    /// @notice The current registry administrator.
    address public admin;

    /// @notice Indicates whether an address may issue credentials.
    mapping(address => bool) public isIssuer;

    /// @notice ID assigned to the next credential. Credential IDs begin at 1.
    uint256 public nextCredentialId = 1;

    mapping(uint256 => Credential) private credentials;

    mapping(bytes32 => uint256) private activeCredentialIdBySubjectAndHash;

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event CredentialIssued(
        uint256 indexed credentialId,
        address indexed student,
        address indexed issuer,
        bytes32 documentHash,
        uint64 issuedAt
    );
    event CredentialRevoked(
        uint256 indexed credentialId,
        address indexed revoker,
        uint64 revokedAt
    );
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    error UnauthorizedAdmin();
    error UnauthorizedIssuer();
    error UnauthorizedRevoker();
    error ZeroAddress();
    error InvalidDocumentHash();
    error IssuerAlreadyAuthorized(address issuer);
    error IssuerNotAuthorized(address issuer);
    error CredentialNotFound(uint256 credentialId);
    error CredentialAlreadyRevoked(uint256 credentialId);
    error DuplicateActiveCredential(address student, bytes32 documentHash);
    error AdminUnchanged();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert UnauthorizedAdmin();
        _;
    }

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert UnauthorizedIssuer();
        _;
    }

    /// @notice Makes the deployer the initial administrator.
    constructor() {
        admin = msg.sender;
    }

    /// @notice Adds an address to the issuer allowlist.
    /// @param issuer The faculty wallet allowed to issue credentials.
    function addIssuer(address issuer) external onlyAdmin {
        if (issuer == address(0)) revert ZeroAddress();
        if (isIssuer[issuer]) revert IssuerAlreadyAuthorized(issuer);

        isIssuer[issuer] = true;
        emit IssuerAdded(issuer);
    }

    /// @notice Removes an issuer without changing credentials they already issued.
    /// @param issuer The faculty wallet to remove from the allowlist.
    function removeIssuer(address issuer) external onlyAdmin {
        if (issuer == address(0)) revert ZeroAddress();
        if (!isIssuer[issuer]) revert IssuerNotAuthorized(issuer);

        isIssuer[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    /// @notice Transfers administrator control to a different address.
    /// @param newAdmin The wallet that will become the administrator.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        if (newAdmin == admin) revert AdminUnchanged();

        address previousAdmin = admin;
        admin = newAdmin;
        emit AdminTransferred(previousAdmin, newAdmin);
    }

    /// @notice Issues a credential for a student and exact document hash.
    /// @param student The wallet associated with the credential.
    /// @param documentHash SHA-256 hash of the document's exact bytes.
    /// @return credentialId The ID assigned to the new credential.
    function issueCredential(
        address student,
        bytes32 documentHash
    ) external onlyIssuer returns (uint256 credentialId) {
        if (student == address(0)) revert ZeroAddress();
        if (documentHash == bytes32(0)) revert InvalidDocumentHash();

        bytes32 duplicateKey = keccak256(abi.encode(student, documentHash));
        if (activeCredentialIdBySubjectAndHash[duplicateKey] != 0) {
            revert DuplicateActiveCredential(student, documentHash);
        }

        credentialId = nextCredentialId;
        nextCredentialId = credentialId + 1;

        uint64 issuedAt = uint64(block.timestamp);
        credentials[credentialId] = Credential({
            student: student,
            issuedAt: issuedAt,
            documentHash: documentHash,
            issuer: msg.sender,
            revokedAt: 0
        });
        activeCredentialIdBySubjectAndHash[duplicateKey] = credentialId;

        emit CredentialIssued(credentialId, student, msg.sender, documentHash, issuedAt);
    }

    /// @notice Revokes a credential. Only its issuer or the admin may do so.
    /// @param credentialId The ID of the credential to revoke.
    function revokeCredential(uint256 credentialId) external {
        Credential storage credential = credentials[credentialId];
        if (credential.student == address(0)) revert CredentialNotFound(credentialId);
        if (msg.sender != admin && msg.sender != credential.issuer) {
            revert UnauthorizedRevoker();
        }
        if (credential.revokedAt != 0) revert CredentialAlreadyRevoked(credentialId);

        uint64 revokedAt = uint64(block.timestamp);
        credential.revokedAt = revokedAt;

        bytes32 duplicateKey = keccak256(
            abi.encode(credential.student, credential.documentHash)
        );
        if (activeCredentialIdBySubjectAndHash[duplicateKey] == credentialId) {
            delete activeCredentialIdBySubjectAndHash[duplicateKey];
        }

        emit CredentialRevoked(credentialId, msg.sender, revokedAt);
    }

    /// @notice Returns a credential or reverts if its ID has never been issued.
    /// @param credentialId The credential ID to retrieve.
    function getCredential(
        uint256 credentialId
    ) external view returns (Credential memory) {
        Credential memory credential = credentials[credentialId];
        if (credential.student == address(0)) revert CredentialNotFound(credentialId);
        return credential;
    }

    /// @notice Checks the existence, revocation status, and document hash of a credential.
    /// @dev Revocation takes priority over a document hash mismatch.
    /// @param credentialId The credential ID to verify.
    /// @param suppliedDocumentHash SHA-256 hash calculated from the supplied document.
    /// @return status The verification result.
    /// @return credential The record, or an empty record when not found.
    function verifyCredential(
        uint256 credentialId,
        bytes32 suppliedDocumentHash
    ) external view returns (VerificationStatus status, Credential memory credential) {
        credential = credentials[credentialId];
        if (credential.student == address(0)) {
            return (VerificationStatus.NotFound, credential);
        }
        if (credential.revokedAt != 0) {
            return (VerificationStatus.Revoked, credential);
        }
        if (credential.documentHash != suppliedDocumentHash) {
            return (VerificationStatus.DocumentHashMismatch, credential);
        }
        return (VerificationStatus.Valid, credential);
    }
}