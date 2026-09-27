// Choosing from a select the way a person does, whether the screen uses a native <select> or the shadcn/Radix one (a
// combobox that opens a listbox of options in a portal). Both have the role combobox, so tests only name the field.
import { expect, type Locator, type Page } from "@playwright/test";

/** What to pick: the exact label, the first label matching a pattern, or the first pattern (in order) that matches one. */
export type OptionWanted = string | RegExp | readonly RegExp[];

function pick(labels: readonly string[], wanted: OptionWanted): string | undefined {
  if (typeof wanted === "string") return labels.find((label) => label === wanted);
  const patterns: readonly RegExp[] = wanted instanceof RegExp ? [wanted] : wanted;
  for (const pattern of patterns) {
    const found = labels.find((label) => pattern.test(label));
    if (found !== undefined) return found;
  }
  return undefined;
}

async function isNativeSelect(field: Locator): Promise<boolean> {
  return field.evaluate((element) => element instanceof HTMLSelectElement);
}

/** Chooses an option of `field` and returns its label. Fails naming the options there were. */
export async function chooseOption(page: Page, field: Locator, wanted: OptionWanted): Promise<string> {
  await expect(field).toBeVisible();
  if (await isNativeSelect(field)) {
    const labels = (await field.locator("option").allTextContents()).map((label) => label.trim());
    const label = pick(labels, wanted);
    if (label === undefined) throw new Error(`No option ${String(wanted)} among: ${labels.join(" | ")}`);
    await field.selectOption({ label });
    return label;
  }
  await field.click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const labels = (await options.allInnerTexts()).map((label) => label.trim());
  const label = pick(labels, wanted);
  if (label === undefined) {
    await page.keyboard.press("Escape");
    throw new Error(`No option ${String(wanted)} among: ${labels.join(" | ")}`);
  }
  await page.getByRole("option", { name: label, exact: true }).first().click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  return label;
}

/** The label the field shows as chosen (a native select's text lists every option, so it reads the selected one). */
export async function chosenLabel(field: Locator): Promise<string> {
  return field.evaluate((element) =>
    element instanceof HTMLSelectElement ? (element.selectedOptions[0]?.textContent ?? "").trim() : (element.textContent ?? "").trim(),
  );
}
