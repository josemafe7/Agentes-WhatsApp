import { describe, expect, it } from "vitest";
import { classifyEmail, IGNORE_REASON_LABELS, IGNORE_REASONS, type EmailEnvelope } from "./filters";

const OWN = "hola@negocio.test";

function envelope(overrides: Partial<EmailEnvelope> = {}): EmailEnvelope {
  return { from: "ana@cliente.test", headers: {}, ownAddresses: [OWN], ...overrides };
}

const ignored = (overrides: Partial<EmailEnvelope>) => classifyEmail(envelope(overrides));

describe("[COR-16] qué correos se ignoran", () => {
  it("un correo normal de un cliente entra", () => {
    expect(classifyEmail(envelope())).toEqual({ kind: "inbound" });
    expect(classifyEmail(envelope({ headers: { "auto-submitted": ["no"] } }))).toEqual({ kind: "inbound" });
  });

  it("respuestas automáticas: Auto-Submitted distinto de «no»", () => {
    expect(ignored({ headers: { "auto-submitted": ["auto-replied"] } })).toEqual({ kind: "ignore", reason: "auto_reply" });
    expect(ignored({ headers: { "auto-submitted": ["auto-generated"] } })).toEqual({ kind: "ignore", reason: "auto_reply" });
    expect(ignored({ headers: { "auto-submitted": ["Auto-Replied; owner-email=x@y"] } })).toEqual({ kind: "ignore", reason: "auto_reply" });
  });

  it("X-Auto-Response-Suppress de Microsoft con All, AutoReply u OOF", () => {
    expect(ignored({ headers: { "x-auto-response-suppress": ["All"] } })).toEqual({ kind: "ignore", reason: "auto_reply" });
    expect(ignored({ headers: { "x-auto-response-suppress": ["DR, OOF"] } })).toEqual({ kind: "ignore", reason: "auto_reply" });
    expect(classifyEmail(envelope({ headers: { "x-auto-response-suppress": ["DR"] } }))).toEqual({ kind: "inbound" });
  });

  it("envíos masivos: Precedence bulk, list o junk", () => {
    for (const value of ["bulk", "list", "junk", "Bulk"]) expect(ignored({ headers: { precedence: [value] } })).toEqual({ kind: "ignore", reason: "bulk" });
    expect(classifyEmail(envelope({ headers: { precedence: ["first-class"] } }))).toEqual({ kind: "inbound" });
  });

  it("listas y boletines: List-Id, List-Unsubscribe o cualquier List-*", () => {
    expect(ignored({ headers: { "list-id": ["<noticias.tienda.test>"] } })).toEqual({ kind: "ignore", reason: "mailing_list" });
    expect(ignored({ headers: { "list-unsubscribe": ["<https://tienda.test/baja>"] } })).toEqual({ kind: "ignore", reason: "mailing_list" });
    expect(ignored({ headers: { "list-unsubscribe-post": ["List-Unsubscribe=One-Click"] } })).toEqual({ kind: "ignore", reason: "mailing_list" });
  });

  it("rebotes: Return-Path vacío, mailer-daemon y postmaster", () => {
    expect(ignored({ headers: { "return-path": ["<>"] } })).toEqual({ kind: "ignore", reason: "bounce" });
    expect(ignored({ from: "MAILER-DAEMON@correo.test" })).toEqual({ kind: "ignore", reason: "bounce" });
    expect(ignored({ from: "postmaster@correo.test" })).toEqual({ kind: "ignore", reason: "bounce" });
    expect(classifyEmail(envelope({ headers: { "return-path": ["<ana@cliente.test>"] } }))).toEqual({ kind: "inbound" });
  });

  it("remitentes noreply, no-reply, donotreply, owner-* y *-request", () => {
    for (const from of ["noreply@banco.test", "no-reply@banco.test", "no_reply@banco.test", "donotreply@banco.test", "do-not-reply@banco.test", "noreply-avisos@banco.test", "owner-lista@listas.test", "lista-request@listas.test"]) {
      expect(ignored({ from })).toEqual({ kind: "ignore", reason: "no_reply_sender" });
    }
  });

  it("spam y papelera (Gmail)", () => {
    expect(ignored({ labels: ["SPAM"] })).toEqual({ kind: "ignore", reason: "spam" });
    expect(ignored({ labels: ["TRASH", "INBOX"] })).toEqual({ kind: "ignore", reason: "spam" });
  });

  it("promociones solo en Gmail (CATEGORY_PROMOTIONS); las demás categorías no filtran solas", () => {
    expect(ignored({ labels: ["INBOX", "CATEGORY_PROMOTIONS"] })).toEqual({ kind: "ignore", reason: "promotions" });
    expect(classifyEmail(envelope({ labels: ["INBOX", "CATEGORY_UPDATES"] }))).toEqual({ kind: "inbound" });
    expect(classifyEmail(envelope({ labels: ["INBOX", "CATEGORY_SOCIAL"] }))).toEqual({ kind: "inbound" });
  });

  it("Outlook no tiene promociones: su clasificación «Otros» nunca es un filtro (no se pasa ni se mira)", () => {
    expect(classifyEmail(envelope({ headers: { "x-ms-exchange-organization-inferenceclassification": ["other"] } }))).toEqual({ kind: "inbound" });
  });

  it("los enviados por el propio buzón a la bandeja de entrada no se contestan", () => {
    expect(ignored({ from: OWN, labels: ["INBOX"] })).toEqual({ kind: "ignore", reason: "own_address" });
  });

  it("sin remitente no hay a quién responder", () => {
    expect(ignored({ from: null })).toEqual({ kind: "ignore", reason: "no_sender" });
  });

  it("cada motivo tiene su texto en español para Diagnóstico", () => {
    for (const reason of IGNORE_REASONS) expect(IGNORE_REASON_LABELS[reason].length).toBeGreaterThan(3);
  });
});

describe("[COR-18] lo nuestro nunca se contesta (evita bucles)", () => {
  it("un correo con nuestra cabecera X-DominIA-Agente que llega de fuera se ignora", () => {
    expect(ignored({ headers: { "x-dominia-agente": ["1"] } })).toEqual({ kind: "ignore", reason: "loop" });
    expect(ignored({ headers: { "x-dominia-system": ["invitation"] } })).toEqual({ kind: "ignore", reason: "loop" });
  });

  it("nuestra copia en enviados es nuestra, no de una persona", () => {
    expect(classifyEmail(envelope({ from: OWN, labels: ["SENT"], headers: { "x-dominia-agente": ["1"] } }))).toEqual({ kind: "own" });
    expect(classifyEmail(envelope({ from: OWN, sentFolder: true, headers: { "x-dominia-agente": ["1"] } }))).toEqual({ kind: "own" });
  });
});

describe("[COR-20] una persona responde desde su buzón", () => {
  it("lo enviado desde el propio buzón sin nuestra cabecera es de una persona", () => {
    expect(classifyEmail(envelope({ from: OWN, labels: ["SENT"] }))).toEqual({ kind: "human" });
    expect(classifyEmail(envelope({ from: "HOLA@negocio.test", sentFolder: true }))).toEqual({ kind: "human" });
  });

  it("los borradores del buzón no hacen nada", () => {
    expect(classifyEmail(envelope({ from: OWN, labels: ["DRAFT"] }))).toEqual({ kind: "skip" });
  });
});
