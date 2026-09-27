// Reading new mail, by provider (the poll job calls it). Outlook checks its Client Secret's expiry first ([COR-22]).
import "server-only";
import type { EmailChannelType } from "./config";
import { syncGmail } from "./gmail/sync";
import { syncImap } from "./imap/sync";
import { checkClientSecretExpiry } from "./outlook/provider";
import { syncOutlook } from "./outlook/sync";
import type { EmailSyncer } from "./provider";

const SYNCERS: Record<EmailChannelType, EmailSyncer> = {
  email_gmail: syncGmail,
  email_outlook: async (channel, context) => {
    await checkClientSecretExpiry(channel, context.now);
    return syncOutlook(channel, context);
  },
  email_imap: syncImap,
};

export function emailSyncerFor(type: EmailChannelType): EmailSyncer {
  return SYNCERS[type];
}
