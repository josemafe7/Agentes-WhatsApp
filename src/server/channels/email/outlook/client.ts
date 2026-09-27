// A Microsoft Graph client with the channel's access token, refreshed when needed ([COR-22]).
import "server-only";
import { createGraphClient, type GraphClient } from "@/lib/microsoft/graph";
import type { ChannelRecord } from "../../types";
import type { EmailDeps } from "../provider";
import { getOAuthAccessToken } from "../tokens";

export function graphClientFor(channel: Pick<ChannelRecord, "id">, deps: EmailDeps): GraphClient {
  return createGraphClient({
    getAccessToken: ({ forceRefresh }) => getOAuthAccessToken(channel.id, { forceRefresh }, { oauthFetch: deps.oauthFetch, oauthBaseUrl: deps.oauthBaseUrl, now: deps.now }),
    fetchImpl: deps.fetchImpl,
    baseUrl: deps.apiBaseUrl,
  });
}
