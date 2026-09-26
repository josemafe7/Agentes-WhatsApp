import { describe, expect, it } from "vitest";
import { AUTH_COOKIE_PREFIX as SERVER_COOKIE_PREFIX } from "@/server/auth";
import { AUTH_COOKIE_PREFIX, isPublicPath, loginPathFor, pathnameOf, sanitizeNextPath, twoFactorPathFor } from "./auth-paths";

describe("return target after signing in: only in-app paths [USU-02] [SEG-05]", () => {
  it("keeps in-app paths with their query", () => {
    expect(sanitizeNextPath("/bandeja")).toBe("/bandeja");
    expect(sanitizeNextPath("/contactos?filtro=vip&pagina=2")).toBe("/contactos?filtro=vip&pagina=2");
    expect(sanitizeNextPath("/ajustes/usuarios")).toBe("/ajustes/usuarios");
  });

  it("refuses other sites, protocol-relative and disguised URLs", () => {
    for (const value of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/.//evil.example",
      "javascript:alert(1)",
      "bandeja",
      "",
      `/${"a".repeat(2000)}`,
    ]) {
      expect(sanitizeNextPath(value), value).toBeNull();
    }
  });

  it("refuses non-strings and the sign-in pages themselves", () => {
    expect(sanitizeNextPath(undefined)).toBeNull();
    expect(sanitizeNextPath(["/bandeja"])).toBeNull();
    expect(sanitizeNextPath("/login")).toBeNull();
    expect(sanitizeNextPath("/login?next=/bandeja")).toBeNull();
    expect(sanitizeNextPath("/dos-pasos")).toBeNull();
    expect(sanitizeNextPath("/api/auth/sign-out")).toBeNull();
  });

  it("builds /login and /dos-pasos with an encoded next, or without it when unsafe", () => {
    expect(loginPathFor("/contactos?filtro=vip")).toBe("/login?next=%2Fcontactos%3Ffiltro%3Dvip");
    expect(loginPathFor("https://evil.example")).toBe("/login");
    expect(loginPathFor(null)).toBe("/login");
    expect(twoFactorPathFor("/agenda")).toBe("/dos-pasos?next=%2Fagenda");
    expect(twoFactorPathFor(undefined)).toBe("/dos-pasos");
  });

  it("reads the path part of a path and query", () => {
    expect(pathnameOf("/perfil?dos-pasos=obligatorio")).toBe("/perfil");
    expect(pathnameOf(null)).toBeNull();
    expect(pathnameOf("https://x.example/perfil")).toBeNull();
  });
});

describe("pages without a session [PER-09]", () => {
  it("sign-in pages, invitation, setup, legal pages and the web chat demo are public", () => {
    for (const path of ["/", "/login", "/recuperar", "/restablecer", "/dos-pasos", "/invitacion/abc", "/setup", "/legal/privacidad", "/widget-demo"]) {
      expect(isPublicPath(path), path).toBe(true);
    }
  });

  it("the panel is private, including look-alike paths", () => {
    for (const path of ["/bandeja", "/perfil", "/ajustes/usuarios", "/ayuda", "/loginx", "/setupx", "/legalidad"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("uses the same cookie prefix as Better Auth", () => {
    expect(AUTH_COOKIE_PREFIX).toBe(SERVER_COOKIE_PREFIX);
  });
});
