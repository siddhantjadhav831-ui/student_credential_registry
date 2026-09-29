import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("StudentProjectCredentialRegistryModule", (m) => {
  const registry = m.contract("StudentProjectCredentialRegistry");

  return { registry };
});