import { describe, expect, it } from "vitest";
import { channelPath, splitLines, webchatAddress, webchatEmbedSnippet, widgetDemoHref } from "./webchat";

const ID = "3f2c9a4e-8b1d-4c6e-9f0a-1b2c3d4e5f60";

describe("código del chat web [WEB-01]", () => {
  it("is the script tag of the spec with the app's address and the channel id", () => {
    expect(webchatEmbedSnippet("https://agentes.mipeluqueria.es", ID)).toBe(
      `<script src="https://agentes.mipeluqueria.es/widget.js" data-channel="${ID}" async></script>`,
    );
  });

  it("does not repeat the slash when the address ends with one", () => {
    expect(webchatEmbedSnippet("http://localhost:3000/", ID)).toBe(`<script src="http://localhost:3000/widget.js" data-channel="${ID}" async></script>`);
  });
});

describe("enlaces del canal [WEB-12]", () => {
  it("opens /widget-demo on this chat", () => {
    expect(widgetDemoHref(ID)).toBe(`/widget-demo?canal=${ID}`);
  });

  it("builds the panel's tab routes", () => {
    expect(channelPath(ID)).toBe(`/canales/${ID}`);
    expect(channelPath(ID, "apariencia")).toBe(`/canales/${ID}/apariencia`);
  });
});

describe("dónde funciona el chat, en su tarjeta [CAN-01] [WEB-10]", () => {
  it("shows its domain, how many more there are, or that it only works inside the app", () => {
    expect(webchatAddress(["www.mipeluqueria.es"])).toBe("www.mipeluqueria.es");
    expect(webchatAddress(["www.mipeluqueria.es", "mipeluqueria.es", "reservas.mipeluqueria.es"])).toBe("www.mipeluqueria.es y 2 más");
    expect(webchatAddress([])).toBe("solo en la app (/widget-demo)");
  });
});

describe("listas de una por línea [WEB-10] [CAN-06]", () => {
  it("trims, drops blank lines and repeats", () => {
    expect(splitLines(" www.mipeluqueria.es \r\n\n mipeluqueria.es\nwww.mipeluqueria.es\n  ")).toEqual(["www.mipeluqueria.es", "mipeluqueria.es"]);
    expect(splitLines("")).toEqual([]);
  });
});
