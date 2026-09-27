// «Quién puede hacer qué» of docs/spec.md, row by row, for the five roles ([PER-01]–[PER-07]).
// The expected matrix is copied from the spec table, not from the code.
import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "./enums";
import { ALL_ACTIONS, can, channelFilter, PERMISSIONS as P, type Action, type Actor } from "./permissions";

/** yes = allowed; no = denied; own = only on the agent's channels ([PER-02]); notOwner = not over the owner ([PER-05]). */
type Expect = "yes" | "no" | "own" | "notOwner";
const Y: Expect = "yes";
const N: Expect = "no";
const OWN: Expect = "own";
const NOT_OWNER: Expect = "notOwner";

//                                   owner admin supervisor agent viewer
const EXPECTED: Record<Action, [Expect, Expect, Expect, Expect, Expect]> = {
  // Bandeja
  [P.inbox.view]: [Y, Y, Y, OWN, Y], // ver conversaciones, mensajes, fuentes y notas
  [P.inbox.reply]: [Y, Y, Y, OWN, N], // responder, enviar plantillas y adjuntos
  [P.inbox.drafts]: [Y, Y, Y, OWN, N], // aprobar, editar o descartar borradores
  [P.inbox.notes]: [Y, Y, Y, OWN, N], // escribir notas internas
  [P.inbox.pauseAi]: [Y, Y, Y, OWN, N], // pausar o reanudar la IA de una conversación
  [P.inbox.manage]: [Y, Y, Y, OWN, N], // traspasar a mano, cambiar estado y etiquetas
  [P.inbox.assign]: [Y, Y, Y, N, N], // asignar a cualquier persona
  [P.inbox.claim]: [Y, Y, Y, OWN, N], // agente: solo tomar para sí una sin asignar de sus canales
  [P.inbox.changeAgent]: [Y, Y, Y, N, N], // elegir otro agente para una conversación
  [P.inbox.convertFaq]: [Y, Y, Y, N, N], // convertir una respuesta en FAQ
  // Contactos
  [P.contacts.view]: [Y, Y, Y, OWN, Y],
  [P.contacts.edit]: [Y, Y, Y, OWN, N], // crear y editar datos, etiquetas y campos
  [P.contacts.merge]: [Y, Y, Y, N, N], // fusionar duplicados y quitar una baja
  [P.contacts.export]: [Y, Y, N, N, N], // exportar y borrar datos
  [P.contacts.delete]: [Y, Y, N, N, N],
  // Agenda
  [P.agenda.view]: [Y, Y, Y, Y, Y], // ver citas y disponibilidad
  [P.agenda.bookings]: [Y, Y, Y, Y, N], // crear, editar, mover y cancelar citas
  [P.agenda.block]: [Y, Y, Y, N, N], // bloquear huecos y poner ausencias
  [P.agenda.configure]: [Y, Y, N, N, N], // servicios, recursos, horarios, terminología y recordatorios
  [P.agenda.deleteTestBookings]: [Y, Y, Y, N, N], // borrar las citas de prueba
  // Agentes
  [P.agents.view]: [Y, Y, Y, N, Y], // ver configuración y versiones
  [P.agents.manage]: [Y, Y, N, N, N], // crear, editar, borrar, recuperar versiones y archivos de contexto
  [P.agents.test]: [Y, Y, Y, N, N], // probar agente
  [P.agents.customTools]: [Y, Y, N, N, N], // herramientas HTTP personalizadas
  // Conocimiento
  [P.knowledge.view]: [Y, Y, Y, N, Y],
  [P.knowledge.manage]: [Y, Y, Y, N, N],
  [P.knowledge.testSearch]: [Y, Y, Y, N, N],
  // Canales
  [P.channels.view]: [Y, Y, N, N, Y], // ver lista, estado y panel, sin credenciales
  [P.channels.manage]: [Y, Y, N, N, N], // crear, conectar, configurar, desconectar, borrar; agente activo e IA
  // Informes
  [P.reports.view]: [Y, Y, Y, N, Y],
  [P.reports.export]: [Y, Y, N, N, N], // descargar cada tabla en CSV ([INF-09])
  // Ajustes
  [P.settings.business]: [Y, Y, N, N, N], // Negocio, Horario, Privacidad y legal, Notificaciones y Tarifas
  [P.settings.integrations]: [Y, Y, N, N, N], // IA (claves y modelos) y Correo del sistema
  [P.settings.users]: [Y, NOT_OWNER, N, N, N], // invitar, roles, canales, desactivar, borrar y exigir 2FA
  [P.settings.transferOwnership]: [Y, N, N, N, N],
  [P.settings.auditLog]: [Y, Y, N, N, N],
  [P.settings.diagnostics]: [Y, Y, N, N, N], // Diagnóstico y simulador
  [P.account.self]: [Y, Y, Y, Y, Y], // Mi cuenta, Acerca de y Ayuda
  // [PER-07]: solo propietario y administrador ven un secreto enmascarado; [PER-03]: solo lectura, ninguno.
  [P.secrets.viewMasked]: [Y, Y, N, N, N],
};

const actor = (role: Role, channelIds: string[] | null = null): Actor => ({
  userId: `user-${role}`,
  role,
  name: role,
  channelIds: role === "agent" ? channelIds : null,
});

describe("permission matrix [PER-01]", () => {
  it("covers every action of the spec, and nothing else", () => {
    expect([...ALL_ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const action of ALL_ACTIONS) {
    ROLES.forEach((role, index) => {
      const expected = EXPECTED[action][index];
      it(`${role} × ${action} → ${expected}`, () => {
        const restricted = actor(role, ["channel-mine"]);
        const other = { channelId: "channel-other" };
        const mine = { channelId: "channel-mine" };
        switch (expected) {
          case "yes":
            expect(can(restricted, action)).toBe(true);
            expect(can(restricted, action, other)).toBe(true);
            break;
          case "no":
            expect(can(restricted, action)).toBe(false);
            expect(can(restricted, action, mine)).toBe(false);
            break;
          case "own":
            expect(can(restricted, action)).toBe(true);
            expect(can(restricted, action, mine)).toBe(true);
            expect(can(restricted, action, other)).toBe(false);
            expect(can(restricted, action, { channelIds: ["x", "channel-mine"] })).toBe(true);
            expect(can(restricted, action, { channelIds: ["x"] })).toBe(false);
            // [PER-02]: an agent without assigned channels sees all channels.
            expect(can(actor(role, null), action, other)).toBe(true);
            break;
          case "notOwner":
            expect(can(restricted, action, { targetUserId: "u2", targetRole: "agent" })).toBe(true);
            expect(can(restricted, action, { targetUserId: "u1", targetRole: "owner" })).toBe(false);
            break;
        }
      });
    });
  }
});

describe("special rules", () => {
  it("nobody is allowed anything without a session [PER-09]", () => {
    for (const action of ALL_ACTIONS) expect(can(null, action)).toBe(false);
  });

  it("nobody makes someone owner through user management: only the transfer does [PER-05] [PER-06]", () => {
    expect(can(actor("owner"), P.settings.users, { targetUserId: "u2", targetRole: "admin", newRole: "owner" })).toBe(false);
    expect(can(actor("admin"), P.settings.users, { targetUserId: "u2", targetRole: "agent", newRole: "owner" })).toBe(false);
    expect(can(actor("owner"), P.settings.users, { targetUserId: "u2", targetRole: "agent", newRole: "admin" })).toBe(true);
  });

  it("an agent does not see conversations without a channel (tests) when restricted", () => {
    expect(can(actor("agent", ["c1"]), P.inbox.view, { channelId: null })).toBe(false);
    expect(can(actor("agent", null), P.inbox.view, { channelId: null })).toBe(true);
  });

  it("an agent restricted to channels sees no contact without conversations there [PER-02]", () => {
    expect(can(actor("agent", ["c1"]), P.contacts.view, { channelIds: [] })).toBe(false);
  });

  it("channelFilter: null (all) for everyone except restricted agents", () => {
    expect(channelFilter(actor("supervisor"))).toBeNull();
    expect(channelFilter(actor("viewer"))).toBeNull();
    expect(channelFilter(actor("agent", null))).toBeNull();
    expect(channelFilter(actor("agent", ["c1", "c2"]))).toEqual(["c1", "c2"]);
  });

  it("unknown actions are denied", () => {
    expect(can(actor("owner"), "inbox.delete_everything" as Action)).toBe(false);
  });
});
