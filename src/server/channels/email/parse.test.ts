import { describe, expect, it } from "vitest";
import { normalizeMessageId, parseRawEmail, splitMessageIds } from "./parse";
import { buildRawEmail } from "./test-helpers";
import { imapThreadCandidates } from "./threading";

describe("[COR-19] lectura del correo con mailparser", () => {
  it("lee remitente, asunto, hilo y cabeceras en bruto", async () => {
    const raw = await buildRawEmail({
      from: "Ana@Cliente.test",
      fromName: "Ana García",
      subject: "Cita",
      messageId: "<m2@cliente.test>",
      inReplyTo: "<m1@negocio.test>",
      references: ["<m0@cliente.test>", "<m1@negocio.test>"],
      replyTo: "otra@cliente.test",
      headers: { "List-Id": "<boletin.test>", "Auto-Submitted": "no" },
    });
    const parsed = await parseRawEmail(raw);
    expect(parsed.from).toEqual({ address: "ana@cliente.test", name: "Ana García" });
    expect(parsed.subject).toBe("Cita");
    expect(parsed.messageId).toBe("<m2@cliente.test>");
    expect(parsed.inReplyTo).toBe("<m1@negocio.test>");
    expect(parsed.references).toEqual(["<m0@cliente.test>", "<m1@negocio.test>"]);
    expect(parsed.replyTo).toEqual([{ address: "otra@cliente.test", name: null }]);
    expect(parsed.headers["list-id"]).toEqual(["<boletin.test>"]);
    expect(parsed.headers["auto-submitted"]).toEqual(["no"]);
  });

  it("[COR-25] cuenta las direcciones y cabeceras From: más de una nunca es un remitente verificado", async () => {
    expect((await parseRawEmail(await buildRawEmail({}))).fromCount).toBe(1);
    const twoAddresses = Buffer.from("From: ana@cliente.test, luis@cliente.test\r\nTo: hola@negocio.test\r\nSubject: x\r\n\r\nhola\r\n");
    expect((await parseRawEmail(twoAddresses)).fromCount).toBe(2);
    const twoHeaders = Buffer.from("From: ana@cliente.test\r\nFrom: jefe@banco.test\r\nTo: hola@negocio.test\r\nSubject: x\r\n\r\nhola\r\n");
    expect((await parseRawEmail(twoHeaders)).fromCount).toBe(2);
  });

  it("respeta el juego de caracteres (ISO-8859-1 en quoted-printable)", async () => {
    const raw = Buffer.from(
      [
        "From: Ana <ana@cliente.test>",
        "To: hola@negocio.test",
        "Subject: =?ISO-8859-1?Q?Informaci=F3n?=",
        "Message-ID: <latin@cliente.test>",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="ISO-8859-1"',
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "=BFTen=E9is cita ma=F1ana?",
        "",
      ].join("\r\n"),
      "latin1",
    );
    const parsed = await parseRawEmail(raw);
    expect(parsed.subject).toBe("Información");
    expect(parsed.text).toBe("¿Tenéis cita mañana?");
  });

  it("convierte a texto un correo que solo trae HTML [SEG-12]", async () => {
    const parsed = await parseRawEmail(await buildRawEmail({ html: "<p>Hola <b>equipo</b>,</p><p>¿Hacéis <i>mechas</i>?</p><script>alert(1)</script>" }));
    expect(parsed.text).toContain("Hola equipo");
    expect(parsed.text).toContain("¿Hacéis mechas?");
    expect(parsed.text).not.toContain("alert");
  });

  it("separa los adjuntos y descarta los logos pequeños de la firma", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2_000, 32)]);
    const logo = Buffer.alloc(2_000, 1);
    const photo = Buffer.alloc(40 * 1024, 2);
    const parsed = await parseRawEmail(
      await buildRawEmail({
        html: '<p>Adjunto</p><img src="cid:logo@firma">',
        attachments: [
          { filename: "presupuesto.pdf", contentType: "application/pdf", content: pdf },
          { filename: "logo.png", contentType: "image/png", content: logo, cid: "logo@firma" },
          { filename: "foto.jpg", contentType: "image/jpeg", content: photo },
        ],
      }),
    );
    expect(parsed.attachments.map((file) => file.fileName)).toEqual(["presupuesto.pdf", "foto.jpg"]);
    expect(parsed.attachments[0].content.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("los ids de mensaje se normalizan y se separan", () => {
    expect(normalizeMessageId(" a@b ")).toBe("<a@b>");
    expect(normalizeMessageId("<a@b>")).toBe("<a@b>");
    expect(normalizeMessageId("sin-arroba")).toBeNull();
    expect(splitMessageIds("<a@b> <c@d>\r\n <a@b>")).toEqual(["<a@b>", "<c@d>"]);
  });
});

describe("nada de un correo impide guardarlo", () => {
  const utf16 = (text: string) => `=?utf-16le?B?${Buffer.from(text, "utf16le").toString("base64")}?=`;

  it("sin caracteres nulos ni mitades sueltas de pares sustitutos, en ningún campo", async () => {
    const raw = Buffer.from(
      [
        "From: Ana <ana@cliente.test>",
        "To: hola@negocio.test",
        `Subject: ${utf16("Cita\u0000 del\ud800 martes")}`,
        "Message-ID: <nu\u0000lo@cliente.test>",
        "References: <ra\u0000iz@cliente.test>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Hola\u0000, ¿tenéis hueco?",
      ].join("\r\n"),
    );
    const parsed = await parseRawEmail(raw);
    expect(parsed).toMatchObject({ subject: "Cita del� martes", messageId: "<nulo@cliente.test>", references: ["<raiz@cliente.test>"], text: "Hola, ¿tenéis hueco?" });
    const everything = JSON.stringify({ ...parsed, attachments: [] });
    expect(everything).not.toContain("\\u0000");
    expect(everything).not.toMatch(/\\ud[89a-f]/i);
  });

  it("una fecha que no puede ser real no es fecha (se usará la de llegada)", async () => {
    const withDate = async (date: string) => (await parseRawEmail(Buffer.from(`From: ana@cliente.test\r\nDate: ${date}\r\nSubject: x\r\n\r\nhola\r\n`))).date;
    expect(await withDate("-005000-01-01T00:00:00Z")).toBeNull();
    expect(await withDate("Fri, 13 Sep 275760 00:00:00 +0000")).toBeNull();
    expect(await withDate("Wed, 31 Dec 1969 23:59:59 +0000")).toBeNull();
    expect(await withDate("Sun, 27 Sep 2026 09:00:00 +0000")).toEqual(new Date("2026-09-27T09:00:00Z"));
  });

  it("una dirección más larga que ninguna real (254 caracteres) no es una dirección", async () => {
    const long = `${"a".repeat(250)}@cliente.test`;
    const parsed = await parseRawEmail(Buffer.from(`From: ${long}\r\nTo: hola@negocio.test, ${long}\r\nSubject: x\r\n\r\nhola\r\n`));
    expect(parsed.from).toBeNull();
    expect(parsed.to).toEqual([{ address: "hola@negocio.test", name: null }]);
  });
});

describe("[CAN-12] hilo de IMAP", () => {
  it("la raíz de References manda, después In-Reply-To y el propio id", () => {
    expect(imapThreadCandidates({ messageId: "<c@x>", inReplyTo: "<b@x>", references: ["<a@x>", "<b@x>"] })).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
    expect(imapThreadCandidates({ messageId: "<c@x>", inReplyTo: null, references: [] })).toEqual(["<c@x>"]);
  });
});
