// Addresses of Herramientas HTTP (docs/pantallas.md «Herramientas HTTP»).
export const HTTP_TOOLS_PATH = "/agentes/herramientas";
export const NEW_HTTP_TOOL_PATH = `${HTTP_TOOLS_PATH}/nueva`;

export function httpToolPath(toolId: string): string {
  return `${HTTP_TOOLS_PATH}/${toolId}`;
}
