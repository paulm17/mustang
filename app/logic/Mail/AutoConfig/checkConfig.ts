import type { MailAccount } from "../MailAccount";
import { fillConfig } from "./saveConfig";

export async function checkConfig(config: MailAccount, emailAddress: string, password: string): Promise<void> {
  fillConfig(config, emailAddress, password);
  console.log("Checking new mail account", config);
  await config.verifyLogin();
  if (config.outgoing) {
    await config.outgoing.verifyLogin();
  }
}
