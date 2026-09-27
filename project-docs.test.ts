// What the repository explains to whoever clones it and to the business: the README ([ARR-22]), the start-up checklist
// and the data processing contract template ([ARR-23], [CUM-09], [CUM-10]) and the skills for a coding agent with their
// Claude Code bridges ([ARR-24]). The guides themselves are checked in src/app/(app)/ayuda/_lib/guides.test.ts.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { ROLE_LABELS } from "@/lib/permissions";
import { DEMO_PASSWORD, DEMO_USERS } from "./seed/users";

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const README = read("README.md");
const CHECKLIST = read("docs/checklist-puesta-en-marcha.md");
const CONTRACT = read("docs/contrato-encargo-tratamiento.md");

/** The text of a `## Heading` section of a Markdown file, up to the next one. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const end = text.indexOf("\n## ", start + 4);
  return text.slice(start, end < 0 ? undefined : end);
}

describe("the README [ARR-22]", () => {
  it("is in Spanish and has every section the specification asks for", () => {
    const headings = README.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3));
    for (const heading of [
      "Requisitos",
      "Arranque rápido",
      "Usuarios de prueba",
      "La clave de OpenRouter",
      "Recorrido de la demo",
      "Órdenes",
      "Variables de entorno",
      "Conectar WhatsApp real",
      "Conectar el correo real",
      "Despliegue",
      "Paso a un negocio real",
      "Solución de problemas",
    ]) {
      expect(headings, heading).toContain(heading);
    }
  });

  it("covers the requirements, the quick start, the demo tour, the real channels, publishing and the real business", () => {
    expect(section(README, "Requisitos")).toMatch(/Node\.js 24/);
    expect(section(README, "Requisitos")).toMatch(/pnpm 10/);
    expect(section(README, "Arranque rápido")).toContain("pnpm install && pnpm dev");
    expect(section(README, "La clave de OpenRouter")).toContain("Ajustes › IA");
    const tour = section(README, "Recorrido de la demo");
    for (const topic of ["Simulador", "/widget-demo", "Bandeja", "Traspaso", "Agente activo", "Agenda", "Conocimiento"]) expect(tour, topic).toContain(topic);
    for (const [heading, topics] of [
      ["Conectar WhatsApp real", ["docs/guia-whatsapp.md", "Meta"]],
      ["Conectar el correo real", ["docs/guia-correo.md", "Gmail", "Outlook", "IMAP"]],
      ["Despliegue", ["docs/guia-despliegue.md", "Vercel", "Supabase", "Storage", "cron"]],
      ["Paso a un negocio real", ["pnpm db:fresh", "docs/checklist-puesta-en-marcha.md"]],
    ] as const) {
      for (const topic of topics) expect(section(README, heading), `${heading}: ${topic}`).toContain(topic);
    }
    // A real business never runs the development server.
    expect(section(README, "Paso a un negocio real")).toContain("pnpm build && pnpm start");
    expect(section(README, "Paso a un negocio real")).not.toMatch(/arranca con `pnpm dev`/);
    expect(section(README, "Solución de problemas").length).toBeGreaterThan(500);
  });

  it("lists every command of package.json and every variable of .env.example", () => {
    const scripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
    for (const script of scripts) {
      expect(README.includes(`pnpm ${script}`) || README.includes(`pnpm run ${script}`), script).toBe(true);
    }
    const example = read(".env.example");
    const names = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    expect(Object.keys(parseEnv(example)).length).toBeGreaterThan(5);
    for (const name of names) expect(section(README, "Variables de entorno"), name).toContain(name);
  });

  it("has the table of test users, exactly those of the seed: email, password and role [ARR-09]", () => {
    const rows = section(README, "Usuarios de prueba")
      .split("\n")
      .filter((line) => /^\| `[^`]+@[^`]+` \|/.test(line))
      .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", "")));
    expect(rows).toEqual(DEMO_USERS.map((demo) => [demo.email, DEMO_PASSWORD, ROLE_LABELS[demo.role]]));
  });

  it("links every guide of docs/ and the contract template [ARR-23]", () => {
    const docs = fs.readdirSync(path.join(ROOT, "docs")).filter((file) => /^(guia-.+|checklist-puesta-en-marcha|contrato-encargo-tratamiento)\.md$/.test(file));
    expect(docs.length).toBeGreaterThanOrEqual(7);
    for (const file of docs) expect(README, file).toContain(`](docs/${file})`);
  });
});

describe("the start-up checklist [ARR-23] [CUM-10]", () => {
  it("goes from an empty installation to the first conversations, in Spanish, with room for screenshots", () => {
    for (const topic of ["pnpm db:fresh", "asistente de arranque", "SETUP_TOKEN", "Probar clave", "Simulador", "BAJA", "Pendiente de humano", "Cada semana", "Cada mes"]) {
      expect(CHECKLIST, topic).toContain(topic);
    }
    expect(CHECKLIST.match(/\[Captura: /g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("asks for the privacy of the OpenRouter account and a spending limit on the key", () => {
    expect(CHECKLIST).toContain("https://openrouter.ai/settings/privacy");
    expect(CHECKLIST).toMatch(/límite de gasto/);
    expect(CHECKLIST).toContain("https://openrouter.ai/settings/keys");
  });

  it("never starts a real business with `pnpm dev`: the published app, or `pnpm build && pnpm start` on a computer", () => {
    expect(CHECKLIST).toContain("pnpm build && pnpm start");
    expect(CHECKLIST).toContain("pnpm worker");
    expect(CHECKLIST).toMatch(/Nunca (con )?`pnpm dev`/);
    expect(CHECKLIST).not.toMatch(/arranca con `pnpm dev`/);
  });

  it("sends to the contract template and says to review it with a lawyer [CUM-09]", () => {
    expect(CHECKLIST).toContain("docs/contrato-encargo-tratamiento.md");
    expect(CHECKLIST).toMatch(/revísala con un abogado/i);
  });
});

describe("the data processing contract template [CUM-09] [ARR-23]", () => {
  it("is marked, on top, to be reviewed with a lawyer", () => {
    expect(CONTRACT.split("\n")[0]).toMatch(/revísala con un abogado/i);
  });

  it("has the parts of an article 28 contract, with the services that process data and OpenRouter's privacy", () => {
    for (const heading of ["## Reunidos", "## Exponen", "## Cláusulas", "## Anexo I", "## Anexo II", "## Anexo III"]) expect(CONTRACT, heading).toContain(heading);
    for (const topic of ["artículo 28", "RESPONSABLE", "ENCARGADO", "Subencargados", "Transferencias internacionales", "Violaciones de seguridad", "OpenRouter", "Supabase", "Vercel", "Meta"]) {
      expect(CONTRACT, topic).toContain(topic);
    }
    expect(CONTRACT).toMatch(/prohíbe a los proveedores guardar o usar los datos/);
  });
});

describe("skills for a coding agent [ARR-24]", () => {
  const AGENT_SKILLS = path.join(ROOT, ".agents", "skills");
  const CLAUDE_SKILLS = path.join(ROOT, ".claude", "skills");
  const SPEC_SKILLS = ["actualizar", "conectar-correo", "conectar-whatsapp", "crear-agente", "desplegar", "diagnostico", "nuevo-negocio"];
  /** Skills installed from outside, listed in skills-lock.json: they keep their own format and this rule does not check them. */
  const INSTALLED_SKILLS: ReadonlySet<string> = new Set(
    fs.existsSync(path.join(ROOT, "skills-lock.json"))
      ? Object.keys((JSON.parse(read("skills-lock.json")) as { skills?: Record<string, unknown> }).skills ?? {})
      : [],
  );
  /** The project's own skills: every folder of .agents/skills that was not installed from outside. */
  const ownSkillFolders = () =>
    fs
      .readdirSync(AGENT_SKILLS)
      .filter((entry) => fs.statSync(path.join(AGENT_SKILLS, entry)).isDirectory() && !INSTALLED_SKILLS.has(entry))
      .sort();

  it("the lock file of installed skills never covers a skill of the specification", () => {
    for (const spec of SPEC_SKILLS) expect(INSTALLED_SKILLS.has(spec), spec).toBe(false);
  });

  /** `name` and `description` of the frontmatter, and the text after it. */
  function skill(file: string): { name: string | null; description: string | null; body: string } {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    const front = match?.[1] ?? "";
    const quoted = /^description:\s*"(.*)"\s*$/m.exec(front)?.[1];
    return {
      name: /^name:\s*(\S+)\s*$/m.exec(front)?.[1] ?? null,
      description: quoted ?? /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? null,
      body: match?.[2] ?? "",
    };
  }

  it("the project has the skills of the specification, each with its SKILL.md: name = folder, and a description", () => {
    const folders = ownSkillFolders();
    expect(folders).toEqual(expect.arrayContaining(SPEC_SKILLS));
    for (const folder of folders) {
      expect(folder).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      const { name, description, body } = skill(path.join(AGENT_SKILLS, folder, "SKILL.md"));
      expect(name, folder).toBe(folder);
      expect(description?.length ?? 0, folder).toBeGreaterThan(40);
      expect(description, folder).toMatch(/Úsala cuando/);
      expect(body.trim().length, folder).toBeGreaterThan(200);
    }
    expect(skill(path.join(AGENT_SKILLS, "conectar-whatsapp", "SKILL.md")).description).toContain("WhatsApp Business Tools");
  });

  it("each one has its Claude Code bridge with the same name and description and only the instruction to read it", () => {
    const folders = ownSkillFolders();
    for (const folder of folders) {
      const bridgeDir = path.join(CLAUDE_SKILLS, folder);
      expect(fs.readdirSync(bridgeDir), folder).toEqual(["SKILL.md"]);
      const bridge = skill(path.join(bridgeDir, "SKILL.md"));
      const original = skill(path.join(AGENT_SKILLS, folder, "SKILL.md"));
      expect({ name: bridge.name, description: bridge.description }, folder).toEqual({ name: original.name, description: original.description });
      expect(bridge.body.trim(), folder).toBe(`Lee \`.agents/skills/${folder}/SKILL.md\` y sigue sus instrucciones. Las rutas que aparezcan en él parten de esa carpeta.`);
    }
    // No bridge without its skill (the installed skills keep their own copy there, not a bridge).
    expect(fs.readdirSync(CLAUDE_SKILLS).filter((entry) => !INSTALLED_SKILLS.has(entry)).sort()).toEqual(folders);
  });
});
