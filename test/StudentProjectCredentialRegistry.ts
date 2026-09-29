import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs.js";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";

const { ethers } = hre;

describe("StudentProjectCredentialRegistry", function () {
  const documentHash = ethers.sha256(ethers.toUtf8Bytes("project certificate bytes"));
  const otherDocumentHash = ethers.sha256(ethers.toUtf8Bytes("different document bytes"));

  async function deployFixture() {
    const [admin, issuer, secondIssuer, student, secondStudent, stranger, newAdmin] =
      await ethers.getSigners();
    const factory = await ethers.getContractFactory("StudentProjectCredentialRegistry");
    const registry = await factory.deploy();
    await registry.waitForDeployment();
    return { registry, admin, issuer, secondIssuer, student, secondStudent, stranger, newAdmin };
  }

  async function issuerFixture() {
    const fixture = await deployFixture();
    await fixture.registry.connect(fixture.admin).addIssuer(fixture.issuer.address);
    return fixture;
  }

  describe("deployment", function () {
    it("deploys, assigns the deployer as admin, and starts IDs at one", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.getAddress()).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(await registry.admin()).to.equal(admin.address);
      expect(await registry.nextCredentialId()).to.equal(BigInt(1));
    });

    it("does not automatically authorize the admin as an issuer", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.isIssuer(admin.address)).to.equal(false);
      await expect(
        registry.connect(admin).issueCredential(admin.address, documentHash),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedIssuer");
    });
  });

  describe("issuer management", function () {
    it("allows the admin to add an issuer and emits IssuerAdded", async function () {
      const { registry, admin, issuer } = await loadFixture(deployFixture);
      await expect(registry.connect(admin).addIssuer(issuer.address))
        .to.emit(registry, "IssuerAdded")
        .withArgs(issuer.address);
      expect(await registry.isIssuer(issuer.address)).to.equal(true);
    });

    it("rejects issuer additions by non-admins and duplicate issuers", async function () {
      const { registry, admin, issuer, stranger } = await loadFixture(issuerFixture);
      await expect(
        registry.connect(stranger).addIssuer(issuer.address),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedAdmin");
      await expect(
        registry.connect(admin).addIssuer(issuer.address),
      ).to.be.revertedWithCustomError(registry, "IssuerAlreadyAuthorized").withArgs(issuer.address);
    });

    it("rejects zero address when adding an issuer", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      await expect(
        registry.connect(admin).addIssuer(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("allows removal, emits IssuerRemoved, and blocks future issuance", async function () {
      const { registry, admin, issuer, student } = await loadFixture(issuerFixture);
      await expect(registry.connect(admin).removeIssuer(issuer.address))
        .to.emit(registry, "IssuerRemoved")
        .withArgs(issuer.address);
      expect(await registry.isIssuer(issuer.address)).to.equal(false);
      await expect(
        registry.connect(issuer).issueCredential(student.address, documentHash),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedIssuer");
    });

    it("rejects non-admin removal, zero address, and non-issuer removal", async function () {
      const { registry, admin, issuer, stranger } = await loadFixture(issuerFixture);
      await expect(
        registry.connect(stranger).removeIssuer(issuer.address),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedAdmin");
      await expect(
        registry.connect(admin).removeIssuer(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(
        registry.connect(admin).removeIssuer(stranger.address),
      ).to.be.revertedWithCustomError(registry, "IssuerNotAuthorized").withArgs(stranger.address);
    });

    it("keeps previously issued credentials intact after issuer removal", async function () {
      const { registry, admin, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      const before = await registry.getCredential(1);
      await registry.connect(admin).removeIssuer(issuer.address);
      const after = await registry.getCredential(1);
      expect(after.student).to.equal(before.student);
      expect(after.issuedAt).to.equal(before.issuedAt);
      expect(after.documentHash).to.equal(before.documentHash);
      expect(after.issuer).to.equal(before.issuer);
      expect(after.revokedAt).to.equal(before.revokedAt);
    });
  });

  describe("issuance", function () {
    it("issues a credential, stores its fields, and emits CredentialIssued", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      const transaction = await registry.connect(issuer).issueCredential(student.address, documentHash);
      const receipt = await transaction.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      await expect(transaction)
        .to.emit(registry, "CredentialIssued")
        .withArgs(BigInt(1), student.address, issuer.address, documentHash, anyValue);

      const credential = await registry.getCredential(1);
      expect(credential.student).to.equal(student.address);
      expect(credential.issuer).to.equal(issuer.address);
      expect(credential.documentHash).to.equal(documentHash);
      expect(credential.issuedAt).to.equal(BigInt(block!.timestamp));
      expect(credential.revokedAt).to.equal(BigInt(0));
    });

    it("rejects issuance by unauthorized addresses", async function () {
      const { registry, stranger, student } = await loadFixture(deployFixture);
      await expect(
        registry.connect(stranger).issueCredential(student.address, documentHash),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedIssuer");
    });

    it("rejects a zero student address and zero document hash", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await expect(
        registry.connect(issuer).issueCredential(ethers.ZeroAddress, documentHash),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(
        registry.connect(issuer).issueCredential(student.address, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(registry, "InvalidDocumentHash");
    });

    it("increments credential IDs for successive issues", async function () {
      const { registry, issuer, student, secondStudent } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await registry.connect(issuer).issueCredential(secondStudent.address, otherDocumentHash);
      expect(await registry.nextCredentialId()).to.equal(BigInt(3));
      expect((await registry.getCredential(1)).student).to.equal(student.address);
      expect((await registry.getCredential(2)).student).to.equal(secondStudent.address);
    });
  });

  describe("duplicate protection", function () {
    it("rejects duplicate active credentials for the same student and hash", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await expect(
        registry.connect(issuer).issueCredential(student.address, documentHash),
      ).to.be.revertedWithCustomError(registry, "DuplicateActiveCredential")
        .withArgs(student.address, documentHash);
    });

    it("allows the same document hash for different students", async function () {
      const { registry, issuer, student, secondStudent } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await expect(
        registry.connect(issuer).issueCredential(secondStudent.address, documentHash),
      ).not.to.be.reverted;
    });

    it("allows reissue after revocation and assigns a new ID", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await registry.connect(issuer).revokeCredential(1);
      await expect(registry.connect(issuer).issueCredential(student.address, documentHash))
        .to.emit(registry, "CredentialIssued")
        .withArgs(BigInt(2), student.address, issuer.address, documentHash, anyValue);
      expect((await registry.getCredential(1)).revokedAt).not.to.equal(BigInt(0));
      expect((await registry.getCredential(2)).revokedAt).to.equal(BigInt(0));
    });
  });

  describe("revocation", function () {
    it("allows the original issuer to revoke and emits CredentialRevoked", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await expect(registry.connect(issuer).revokeCredential(1))
        .to.emit(registry, "CredentialRevoked")
        .withArgs(BigInt(1), issuer.address, anyValue);
      expect((await registry.getCredential(1)).revokedAt).not.to.equal(BigInt(0));
    });

    it("allows the admin to revoke and records the admin as revoker", async function () {
      const { registry, admin, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await expect(registry.connect(admin).revokeCredential(1))
        .to.emit(registry, "CredentialRevoked")
        .withArgs(BigInt(1), admin.address, anyValue);
    });

    it("rejects revocation by another issuer and a non-issuer", async function () {
      const { registry, admin, issuer, secondIssuer, stranger, student } =
        await loadFixture(issuerFixture);
      await registry.connect(admin).addIssuer(secondIssuer.address);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await expect(
        registry.connect(secondIssuer).revokeCredential(1),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedRevoker");
      await expect(
        registry.connect(stranger).revokeCredential(1),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedRevoker");
    });

    it("rejects nonexistent and already-revoked credentials", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await expect(
        registry.connect(issuer).revokeCredential(1),
      ).to.be.revertedWithCustomError(registry, "CredentialNotFound").withArgs(BigInt(1));
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await registry.connect(issuer).revokeCredential(1);
      await expect(
        registry.connect(issuer).revokeCredential(1),
      ).to.be.revertedWithCustomError(registry, "CredentialAlreadyRevoked").withArgs(BigInt(1));
    });

    it("changes only revokedAt and records the block timestamp", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      const before = await registry.getCredential(1);
      const receipt = await (await registry.connect(issuer).revokeCredential(1)).wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const after = await registry.getCredential(1);
      expect(after.student).to.equal(before.student);
      expect(after.issuedAt).to.equal(before.issuedAt);
      expect(after.documentHash).to.equal(before.documentHash);
      expect(after.issuer).to.equal(before.issuer);
      expect(after.revokedAt).to.equal(BigInt(block!.timestamp));
    });

    it("clears the active duplicate key so the same credential can be reissued", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await registry.connect(issuer).revokeCredential(1);
      await expect(
        registry.connect(issuer).issueCredential(student.address, documentHash),
      ).not.to.be.reverted;
    });
  });

  describe("verification", function () {
    it("returns NotFound and an empty credential for an unknown ID", async function () {
      const { registry } = await loadFixture(deployFixture);
      const [status, credential] = await registry.verifyCredential(1, documentHash);
      expect(status).to.equal(0);
      expect(credential.student).to.equal(ethers.ZeroAddress);
      await expect(registry.getCredential(1))
        .to.be.revertedWithCustomError(registry, "CredentialNotFound")
        .withArgs(BigInt(1));
    });

    it("returns Valid for the matching hash and mismatch for a different hash", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      const [validStatus] = await registry.verifyCredential(1, documentHash);
      const [mismatchStatus] = await registry.verifyCredential(1, otherDocumentHash);
      expect(validStatus).to.equal(3);
      expect(mismatchStatus).to.equal(2);
    });

    it("returns Revoked before checking whether the supplied hash matches", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      await registry.connect(issuer).revokeCredential(1);
      const [status, credential] = await registry.verifyCredential(1, otherDocumentHash);
      expect(status).to.equal(1);
      expect(credential.revokedAt).not.to.equal(BigInt(0));
    });

    it("allows public reads without connecting a wallet", async function () {
      const { registry, issuer, student } = await loadFixture(issuerFixture);
      await registry.connect(issuer).issueCredential(student.address, documentHash);
      expect((await registry.getCredential(1)).student).to.equal(student.address);
    });
  });

  describe("admin transfer", function () {
    it("transfers admin and emits AdminTransferred", async function () {
      const { registry, admin, newAdmin } = await loadFixture(deployFixture);
      await expect(registry.connect(admin).transferAdmin(newAdmin.address))
        .to.emit(registry, "AdminTransferred")
        .withArgs(admin.address, newAdmin.address);
      expect(await registry.admin()).to.equal(newAdmin.address);
    });

    it("rejects transfer by non-admin, to zero, or to the current admin", async function () {
      const { registry, admin, stranger, newAdmin } = await loadFixture(deployFixture);
      await expect(
        registry.connect(stranger).transferAdmin(newAdmin.address),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedAdmin");
      await expect(
        registry.connect(admin).transferAdmin(ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(
        registry.connect(admin).transferAdmin(admin.address),
      ).to.be.revertedWithCustomError(registry, "AdminUnchanged");
    });
  });
});