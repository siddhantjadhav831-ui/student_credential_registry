import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("GreeterModule", (m) => {
  const greeting = m.getParameter("greeting", "Hello Web3SkillBuildz from Monad!");
  const greeter = m.contract("Greeter", [greeting]);

  return { greeter };
});
