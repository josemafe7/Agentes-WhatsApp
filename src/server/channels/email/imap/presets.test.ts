import { describe, expect, it } from "vitest";
import { isMicrosoftMailHost, MAIL_PRESETS, savesSentAutomatically, suggestMailSettings } from "./presets";

describe("[COR-10] servidores rellenados por dominio", () => {
  it("proveedores conocidos: Gmail, Yahoo, iCloud, Zoho y GMX", () => {
    expect(suggestMailSettings("ana@gmail.com")).toMatchObject({ kind: "preset", preset: { imap: { host: "imap.gmail.com", port: 993, security: "tls" }, smtp: { host: "smtp.gmail.com" } } });
    expect(suggestMailSettings("ana@yahoo.es")).toMatchObject({ kind: "preset", preset: { imap: { host: "imap.mail.yahoo.com" } } });
    expect(suggestMailSettings("ana@icloud.com")).toMatchObject({ kind: "preset", preset: { smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" }, imapUserWithoutDomain: true } });
    expect(suggestMailSettings("ana@zohomail.com")).toMatchObject({ kind: "preset", preset: { imap: { host: "imap.zoho.com" } } });
    expect(suggestMailSettings("ana@gmx.de")).toMatchObject({ kind: "preset", preset: { imap: { host: "imap.gmx.net" } } });
  });

  it("dominio propio: cPanel (mail.dominio) y la lista de hostings (IONOS, Hostinger, OVH…)", () => {
    const suggestion = suggestMailSettings("info@peluqueria-ana.es");
    expect(suggestion?.kind).toBe("own_domain");
    if (suggestion?.kind !== "own_domain") return;
    expect(suggestion.preset.imap).toEqual({ host: "mail.peluqueria-ana.es", port: 993, security: "tls" });
    expect(suggestion.hosting.map((preset) => preset.id)).toEqual(expect.arrayContaining(["ionosEs", "hostinger", "ovh"]));
  });

  it("[COR-09] los correos de Microsoft van a la opción Outlook", () => {
    for (const email of ["ana@outlook.com", "ana@hotmail.es", "ana@live.com", "ana@msn.com"]) expect(suggestMailSettings(email)).toEqual({ kind: "microsoft" });
    expect(isMicrosoftMailHost("outlook.office365.com")).toBe(true);
    expect(isMicrosoftMailHost("smtp-mail.outlook.com")).toBe(true);
    expect(isMicrosoftMailHost("imap.ionos.es")).toBe(false);
  });

  it("nunca el puerto 25 ni conexiones sin cifrar en las sugerencias", () => {
    for (const preset of Object.values(MAIL_PRESETS)) {
      expect(preset.smtp.port).not.toBe(25);
      expect(["tls", "starttls"]).toContain(preset.smtp.security);
      expect(["tls", "starttls"]).toContain(preset.imap.security);
    }
  });

  it("[COR-13] Gmail guarda solo lo enviado por SMTP", () => {
    expect(savesSentAutomatically("imap.gmail.com")).toBe(true);
    expect(savesSentAutomatically("imap.ionos.es")).toBe(false);
  });

  it("una dirección sin dominio válido no sugiere nada", () => {
    expect(suggestMailSettings("sin-arroba")).toBeNull();
  });
});
