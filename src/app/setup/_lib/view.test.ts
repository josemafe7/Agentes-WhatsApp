import { describe, expect, it } from "vitest";
import { SETUP_STEP, SETUP_STEP_COUNT } from "@/data/setup";
import type { Role } from "@/lib/enums";
import { SETUP_STEPS } from "./steps";
import { minutesToTime, timeToMinutes } from "./time";
import { parseStepParam, resolveSetupView, setupStepHref } from "./view";

const empty = { hasUsers: false, completed: false, currentStep: 1 };
const halfway = { hasUsers: true, completed: false, currentStep: 4 };

describe("resolveSetupView", () => {
  it("[ASI-01] an empty installation always shows the owner step, with or without ?paso", () => {
    expect(resolveSetupView({ status: empty, actorRole: null, requestedStep: null })).toEqual({ kind: "step", step: 1 });
    expect(resolveSetupView({ status: empty, actorRole: null, requestedStep: 5 })).toEqual({ kind: "step", step: 1 });
  });

  it("[ASI-01] a finished wizard cannot be opened: it goes to the inbox", () => {
    const done = { hasUsers: true, completed: true, currentStep: 7 };
    for (const actorRole of [null, "owner", "viewer"] as (Role | null)[]) {
      expect(resolveSetupView({ status: done, actorRole, requestedStep: 2 })).toEqual({ kind: "redirect", to: "/bandeja" });
    }
  });

  it("[ASI-11] once the owner exists, the wizard needs a session and comes back to /setup after login", () => {
    expect(resolveSetupView({ status: halfway, actorRole: null, requestedStep: 3 })).toEqual({
      kind: "redirect",
      to: "/login?next=%2Fsetup",
    });
  });

  it.each(["admin", "supervisor", "agent", "viewer"] as Role[])("[ASI-11] %s cannot continue the wizard", (role) => {
    expect(resolveSetupView({ status: halfway, actorRole: role, requestedStep: 2 })).toEqual({ kind: "owner-only" });
  });

  it("[ASI-11] the owner resumes at the first pending step, may reopen done steps and cannot jump ahead", () => {
    const at = (requestedStep: number | null) => resolveSetupView({ status: halfway, actorRole: "owner", requestedStep });
    expect(at(null)).toEqual({ kind: "step", step: 4 });
    expect(at(2)).toEqual({ kind: "step", step: 2 });
    expect(at(4)).toEqual({ kind: "step", step: 4 });
    expect(at(6)).toEqual({ kind: "step", step: 4 });
    expect(at(1)).toEqual({ kind: "step", step: 4 });
  });

  it("?paso is read only when it is a step number", () => {
    expect(parseStepParam("3")).toBe(3);
    for (const value of [undefined, "", "0", "8", "2.5", "abc", ["2", "3"]]) expect(parseStepParam(value)).toBeNull();
    expect(setupStepHref(3)).toBe("/setup?paso=3");
  });
});

describe("step list", () => {
  it("has the seven steps of the spec, numbered like the data layer", () => {
    expect(SETUP_STEPS.map((step) => step.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(SETUP_STEPS).toHaveLength(SETUP_STEP_COUNT);
    expect(SETUP_STEPS.map((step) => step.id)).toEqual(["propietario", "negocio", "horario", "ia", "agente", "chat-web", "canales"]);
    expect(Object.values(SETUP_STEP)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("helpers", () => {
  it("converts times of the hours form", () => {
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("24:00")).toBe(1440);
    for (const bad of ["9:30", "25:00", "12:60", "", "mediodía"]) expect(timeToMinutes(bad)).toBeNull();
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(1440)).toBe("24:00");
  });
});
