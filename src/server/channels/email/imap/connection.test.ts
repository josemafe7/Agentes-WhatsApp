import { afterEach, describe, expect, it } from "vitest";
import { MailHostError, resolveMailHost } from "./connection";
import { describeMailError } from "./errors";

const resolveTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("[SEG-05] servidores de correo: solo direcciones públicas", () => {
  afterEach(() => {
    delete process.env.ALLOW_PRIVATE_MAIL_HOSTS;
  });

  it("un servidor público se conecta por su IP comprobada, con el nombre para TLS", async () => {
    await expect(resolveMailHost("imap.ionos.es", 993, { resolveHost: resolveTo("212.227.17.186") })).resolves.toEqual({ address: "212.227.17.186", servername: "imap.ionos.es" });
  });

  it.each([
    ["127.0.0.1"],
    ["10.0.0.5"],
    ["192.168.1.10"],
    ["172.16.0.1"],
    ["169.254.169.254"],
    ["100.100.100.200"],
    ["::1"],
    ["fe80::1"],
    ["fd00::1"],
    ["::ffff:127.0.0.1"],
  ])("bloquea %s (privada, loopback, link-local o metadatos)", async (address) => {
    await expect(resolveMailHost("mail.trampa.test", 993, { resolveHost: resolveTo(address) })).rejects.toBeInstanceOf(MailHostError);
    await expect(resolveMailHost(address, 993, { resolveHost: resolveTo(address) })).rejects.toThrow(/red privada/);
  });

  it("basta con que una de las direcciones sea privada para bloquear", async () => {
    await expect(resolveMailHost("mail.trampa.test", 993, { resolveHost: resolveTo("93.184.216.34", "10.0.0.1") })).rejects.toThrow(/red privada/);
  });

  it("ALLOW_PRIVATE_MAIL_HOSTS=true permite un servidor propio en la red local", async () => {
    process.env.ALLOW_PRIVATE_MAIL_HOSTS = "true";
    await expect(resolveMailHost("192.168.1.10", 993, { resolveHost: resolveTo("192.168.1.10") })).resolves.toEqual({ address: "192.168.1.10", servername: null });
    await expect(resolveMailHost("mail.local.lan", 993)).resolves.toEqual({ address: "mail.local.lan", servername: "mail.local.lan" });
  });

  it("nunca el puerto 25, ni puertos imposibles, ni nombres raros", async () => {
    await expect(resolveMailHost("smtp.ionos.es", 25, { resolveHost: resolveTo("212.227.15.1") })).rejects.toThrow(/nunca el 25/);
    await expect(resolveMailHost("smtp.ionos.es", 70_000, { resolveHost: resolveTo("212.227.15.1") })).rejects.toBeInstanceOf(MailHostError);
    await expect(resolveMailHost("smtp.ionos.es/../x", 465, { resolveHost: resolveTo("212.227.15.1") })).rejects.toThrow(/nombre del servidor/);
  });

  it("un servidor que no existe se explica en español", async () => {
    await expect(resolveMailHost("no-existe.test", 993, { resolveHost: async () => Promise.reject(new Error("ENOTFOUND")) })).rejects.toThrow(/No se encuentra/);
  });
});

describe("[COR-11] errores de IMAP y SMTP en español", () => {
  it("usuario o contraseña incorrectos piden reconectar", () => {
    expect(describeMailError(Object.assign(new Error("x"), { authenticationFailed: true }))).toMatchObject({ reconnect: true, message: expect.stringMatching(/usuario o la contraseña/) });
    expect(describeMailError(Object.assign(new Error("x"), { code: "EAUTH", responseCode: 535 }))).toMatchObject({ reconnect: true });
  });

  it("servidor, puerto, TLS y tiempo de espera", () => {
    expect(describeMailError(Object.assign(new Error("x"), { code: "ENOTFOUND" })).message).toMatch(/No se encuentra el servidor/);
    expect(describeMailError(Object.assign(new Error("x"), { code: "ECONNREFUSED" })).message).toMatch(/puerto/);
    expect(describeMailError(Object.assign(new Error("x"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })).message).toMatch(/conexión segura/);
    expect(describeMailError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })).message).toMatch(/no responde/);
  });

  it("nunca muestra el texto del servidor (puede traer el usuario)", () => {
    expect(describeMailError(new Error("535 5.7.8 Username and Password not accepted for ana@cliente.test")).message).not.toContain("ana@");
  });
});
