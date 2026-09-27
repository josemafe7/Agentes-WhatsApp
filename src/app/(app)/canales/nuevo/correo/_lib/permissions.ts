// The permissions «Conectar con Google / Microsoft» asks for, said in Spanish ([COR-02], [COR-03], [COR-07];
// docs/integracion-correo.md §1.3 and §2.2). Pure: the connect forms list them before connecting and the page checks
// them against what was granted (./connection.ts).

export type PermissionInfo = { key: string; label: string };

export const GOOGLE_PERMISSIONS: readonly PermissionInfo[] = [
  { key: "gmail.modify", label: "Leer, enviar y organizar el correo de Gmail (sin borrarlo para siempre)" },
  { key: "email", label: "Ver la dirección de correo de la cuenta" },
  { key: "openid", label: "Identificar la cuenta de Google" },
];

export const MICROSOFT_PERMISSIONS: readonly PermissionInfo[] = [
  { key: "Mail.ReadWrite", label: "Leer y escribir el correo, también los borradores (Mail.ReadWrite)" },
  { key: "Mail.Send", label: "Enviar correo (Mail.Send)" },
  { key: "offline_access", label: "Seguir conectado sin que vuelvas a entrar (offline_access)" },
  { key: "User.Read", label: "Leer el perfil de la cuenta (User.Read)" },
];

export type PermissionCheck = PermissionInfo & { granted: boolean };
