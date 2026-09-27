// A Gmail API client with the channel's access token, refreshed when needed ([COR-22]).
import "server-only";
import { createGmailClient, type GmailClient } from "@/lib/google/gmail";
import type { ChannelRecord } from "../../types";
import type { EmailDeps } from "../provider";
import { getOAuthAccessToken } from "../tokens";

export function gmailClientFor(channel: Pick<ChannelRecord, "id">, deps: EmailDeps): GmailClient {
  return createGmailClient({
    getAccessToken: ({ forceRefresh }) => getOAuthAccessToken(channel.id, { forceRefresh }, { oauthFetch: deps.oauthFetch, oauthBaseUrl: deps.oauthBaseUrl, now: deps.now }),
    fetchImpl: deps.fetchImpl,
    baseUrl: deps.apiBaseUrl,
  });
}
