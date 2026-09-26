import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "@/components/markdown-text";
import { headingAnchors, parseMarkdown } from "./markdown";

const render = (text: string, anchors = false) => renderToStaticMarkup(createElement(MarkdownText, { text, anchors }));

describe("simple format of the legal texts (no HTML) [CUM-08] [SEG-05]", () => {
  it("reads headings, paragraphs, lists and bold text", () => {
    const blocks = parseMarkdown(
      "# Quién es el responsable\n\nPeluquería Aurora.\nCalle Mayor 1.\n\n## Tus derechos\n- Acceso\n- **Supresión** de datos\n\n1. Primero\n2. Segundo",
    );
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "heading", "list", "list"]);
    expect(render("# Título\n\nTexto con **negrita**.\n\n- uno\n- dos")).toBe(
      '<h2 class="mt-8 text-lg font-semibold">Título</h2>' +
        '<p class="mt-4">Texto con <strong class="font-semibold">negrita</strong>.</p>' +
        '<ul class="mt-4 list-disc space-y-1 pl-6"><li>uno</li><li>dos</li></ul>',
    );
  });

  it("keeps single line breaks inside a paragraph", () => {
    expect(render("Línea uno\nLínea dos")).toBe('<p class="mt-4">Línea uno<br/>Línea dos</p>');
  });

  it("never renders HTML written in the text: it is shown escaped", () => {
    const html = render('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)> **<b>hola</b>**');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("links only web addresses and emails; other schemes stay as text", () => {
    const html = render(
      "Web: https://aurora.example/privacidad. Email: hola@aurora.example. [Aquí](https://aurora.example) y [malo](javascript:alert(1)).",
    );
    expect(html).toContain('<a href="https://aurora.example/privacidad" rel="noopener noreferrer nofollow"');
    expect(html).toContain('<a href="mailto:hola@aurora.example"');
    expect(html).toContain('>Aquí</a>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("[malo](javascript:alert(1))");
  });

  it("an empty text renders nothing", () => {
    expect(parseMarkdown("  \n\n ")).toEqual([]);
  });

  it("shows `code` and fenced blocks as text, never interpreting what is inside", () => {
    expect(render("Ejecuta `pnpm db:migrate` y **listo**.")).toBe(
      '<p class="mt-4">Ejecuta <code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">pnpm db:migrate</code> y ' +
        '<strong class="font-semibold">listo</strong>.</p>',
    );
    const html = render("```\nDATABASE_URL=libsql://base.turso.io\n  **no es negrita** <b>x</b>\n```");
    expect(html).toBe(
      '<pre class="mt-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm"><code>DATABASE_URL=libsql://base.turso.io\n' +
        "  **no es negrita** &lt;b&gt;x&lt;/b&gt;</code></pre>",
    );
    expect(parseMarkdown("```bash\nsin cerrar")).toEqual([{ type: "code", text: "sin cerrar" }]);
  });
});

describe("numbered steps of a guide [AJU-17]", () => {
  it("an indented line continues the step above, and a step's code block keeps the numbering going", () => {
    const html = render("1. Instala la CLI\n   y entra con `turso auth login`.\n2. Crea el grupo:\n\n   ```\n   turso group list\n   ```\n\n3. Crea la base.");
    expect(html).toBe(
      '<ol class="mt-4 list-decimal space-y-1 pl-6"><li>Instala la CLI y entra con ' +
        '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">turso auth login</code>.</li><li>Crea el grupo:</li></ol>' +
        '<pre class="mt-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm"><code>turso group list</code></pre>' +
        '<ol start="3" class="mt-4 list-decimal space-y-1 pl-6"><li>Crea la base.</li></ol>',
    );
  });
});

describe("headings with anchors, for the index of a guide [AJU-17]", () => {
  it("gives each heading a stable id without accents, unique within the text", () => {
    const blocks = parseMarkdown("# Guía\n\n## Crear la base en Turso\n\n## Qué hace el cron\n\n## Crear la base en Turso");
    expect(headingAnchors(blocks)).toEqual(["guia", "crear-la-base-en-turso", "que-hace-el-cron", "crear-la-base-en-turso-2"]);
    expect(render("## Qué hace el cron", true)).toBe('<h3 id="que-hace-el-cron" class="mt-6 text-base font-semibold">Qué hace el cron</h3>');
    // Without anchors (the legal pages) nothing changes.
    expect(render("## Qué hace el cron")).toBe('<h3 class="mt-6 text-base font-semibold">Qué hace el cron</h3>');
  });
});
