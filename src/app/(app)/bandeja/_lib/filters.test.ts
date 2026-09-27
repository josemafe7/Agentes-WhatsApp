import { describe, expect, it } from "vitest";
import { activeFilterCount, clearFilters, EMPTY_QUERY, inboxHref, inboxQueryString, parseInboxQuery, toConversationFilters } from "./filters";

const CHANNEL = "8f3c2a8e-4b7d-4c1e-9a0b-1c2d3e4f5a6b";
const params = (query: string) => new URLSearchParams(query);

describe("inbox filters in the URL [BAN-02]", () => {
  it("reads the view, channel, status, assignee, mode, unread, labels and search", () => {
    const query = parseInboxQuery(
      params(`vista=pendientes&canal=${CHANNEL}&estado=resuelta&asignado=nadie&modo=pausa&sinleer=1&etiqueta=vip&etiqueta=cita&q=%20ana%20`),
    );
    expect(query).toEqual({
      view: "pending",
      channelId: CHANNEL,
      status: "resolved",
      assignee: "unassigned",
      mode: "paused",
      unread: true,
      labels: ["vip", "cita"],
      search: "ana",
    });
  });

  it("ignores what it does not know instead of failing", () => {
    expect(parseInboxQuery(params("vista=archivo&canal=abc&estado=borrada&asignado=pepe&modo=robot&sinleer=si&etiqueta=%20%20"))).toEqual(EMPTY_QUERY);
  });

  it("keeps labels clean: trimmed, without repeats and at most 20", () => {
    const many = Array.from({ length: 25 }, (_, index) => `etiqueta=e${index}`).join("&");
    expect(parseInboxQuery(params(`${many}&etiqueta=e1`)).labels).toHaveLength(20);
    expect(parseInboxQuery(params("etiqueta=%20vip%20&etiqueta=vip")).labels).toEqual(["vip"]);
  });

  it("writes the same URL back, without defaults, and shares links that keep the filters", () => {
    const query = parseInboxQuery(params(`canal=${CHANNEL}&modo=ia&etiqueta=vip&q=cita`));
    const text = inboxQueryString(query);
    expect(text).toBe(`canal=${CHANNEL}&modo=ia&etiqueta=vip&q=cita`);
    expect(parseInboxQuery(params(text))).toEqual(query);
    expect(inboxQueryString(EMPTY_QUERY)).toBe("");
    expect(inboxHref("/bandeja", EMPTY_QUERY)).toBe("/bandeja");
    expect(inboxHref(`/bandeja/${CHANNEL}`, query)).toBe(`/bandeja/${CHANNEL}?${text}`);
  });

  it("the quick tabs «Pendientes de humano» and «Mías» win over the same filter", () => {
    expect(toConversationFilters(parseInboxQuery(params("vista=pendientes&estado=abierta")))).toEqual({ status: "pending_human" });
    expect(toConversationFilters(parseInboxQuery(params("vista=mias&asignado=nadie&sinleer=1")))).toEqual({ assignee: "me", unread: true });
    expect(toConversationFilters(parseInboxQuery(params(`canal=${CHANNEL}&etiqueta=vip&q=ana&modo=persona&asignado=yo`)))).toEqual({
      channelId: CHANNEL,
      labels: ["vip"],
      search: "ana",
      mode: "human",
      assignee: "me",
    });
  });

  it("counts the active filters and «Quitar filtros» keeps the tab", () => {
    const query = parseInboxQuery(params(`vista=mias&canal=${CHANNEL}&sinleer=1&etiqueta=vip&etiqueta=cita&q=ana`));
    expect(activeFilterCount(query)).toBe(4);
    expect(clearFilters(query)).toEqual({ ...EMPTY_QUERY, view: "mine" });
  });
});
