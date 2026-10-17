// What Ajustes › Recordatorios says next to a reminder by WhatsApp ([AGD-24], [WA-59], [CUM-14]): warnings that let it
// be saved, as the screen shows them.
import { describe, expect, it } from "vitest";
import { serviceWarning, whatsappReminderIssues, type ReminderRule, type ReminderTemplateInfo } from "./reminder-rules";

const template: ReminderTemplateInfo = {
  name: "recordatorio_cita",
  language: "es",
  status: "APPROVED",
  category: "UTILITY",
  variables: ["nombre", "servicio", "dia"],
  quickReplies: [],
  ttlSeconds: 3_600,
};

const rule = (variables: Record<string, string>): Pick<ReminderRule, "lead" | "whatsapp"> => ({
  lead: { kind: "hours", minutes: 24 * 60 },
  whatsapp: { channelId: "c", templateName: "recordatorio_cita", templateLanguage: "es", variables, confirmButton: null, changeButton: null },
});
const fields = ["contact.name", "service.name", "booking.date"];

describe("a reminder by WhatsApp [CUM-14]", () => {
  it("in a sector with health data, giving the service to a variable of the template shows the same warning as a text with {servicio}", () => {
    const withService = rule({ nombre: "contact.name", servicio: "service.name", dia: "booking.date" });
    const warning = serviceWarning("{servicio}", true);
    expect(whatsappReminderIssues(withService, template, { earliestOpeningMin: 540, fields, healthData: true })).toEqual({ errors: [], warnings: [warning] });
    expect(whatsappReminderIssues(withService, template, { earliestOpeningMin: 540, fields, healthData: false }).warnings).toEqual([]);
    const withoutService = rule({ nombre: "contact.name", servicio: "contact.name", dia: "booking.date" });
    expect(whatsappReminderIssues(withoutService, template, { earliestOpeningMin: 540, fields, healthData: true }).warnings).toEqual([]);
  });
});
