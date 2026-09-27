import { describe, expect, it } from "vitest";
import { countriesForPhone, countryFromBsuid, isBsuid, resolveMarket } from "./markets";
import { estimateMessageCost } from "./pricing";

const rates: Record<string, number> = { "ES:service": 0.02, "ES:utility": 0.02, "US:marketing": 0.025 };
const rateFor = (market: string, category: string) => rates[`${market}:${category}`] ?? null;

describe("estimated cost of a WhatsApp message [WA-47] [AJU-09]", () => {
  it("regular = the editable rate of the market and category, × 1", () => {
    expect(estimateMessageCost({ type: "regular", category: "service" }, "ES", rateFor)).toEqual({ cost: 0.02, reason: "rate" });
    expect(estimateMessageCost({ type: "regular", category: "Utility" }, "es", rateFor)).toEqual({ cost: 0.02, reason: "rate" });
  });

  it("any free_* type costs 0 (Meta already marks the 1,000 free service messages: no counter of ours)", () => {
    for (const type of ["free_customer_service", "free_entry_point", "free_group_customer_service"]) {
      expect(estimateMessageCost({ type, category: "service" }, "ES", rateFor)).toEqual({ cost: 0, reason: "free" });
    }
  });

  it("without a rate for that market, it is not estimated (the report flags it)", () => {
    expect(estimateMessageCost({ type: "regular", category: "service" }, "FR", rateFor)).toEqual({ cost: null, reason: "no_rate" });
    expect(estimateMessageCost({ type: "regular", category: "service" }, null, rateFor)).toEqual({ cost: null, reason: "no_market" });
    expect(estimateMessageCost(null, "ES", rateFor)).toEqual({ cost: null, reason: "no_pricing" });
    expect(estimateMessageCost({ type: "something_new", category: "service" }, "ES", rateFor)).toEqual({ cost: null, reason: "unknown_type" });
  });
});

describe("the recipient's market [WA-47]", () => {
  it("comes from the phone's calling code", () => {
    expect(countriesForPhone("34600111222")).toEqual(["ES"]);
    expect(countriesForPhone("+44 7700 900123")[0]).toBe("GB");
    expect(countriesForPhone("593991234567")).toEqual(["EC"]);
    expect(resolveMarket({ phone: "34600111222" })).toBe("ES");
  });

  it("without a phone, from the BSUID's ISO prefix; with a shared calling code, the BSUID's country when it is one of them", () => {
    expect(resolveMarket({ bsuid: "ES.20000000000000000002" })).toBe("ES");
    expect(resolveMarket({ phone: "15550002222", bsuid: "CA.1234" })).toBe("CA");
    expect(resolveMarket({ phone: "15550002222", bsuid: "ES.1234" })).toBe("US");
    expect(resolveMarket({})).toBeNull();
  });

  it("recognises BSUIDs (and parent BSUIDs) and nothing else", () => {
    expect(isBsuid("US.13491208655302741918")).toBe(true);
    expect(isBsuid("US.ENT.11815799212886844830")).toBe(true);
    expect(isBsuid("15550002222")).toBe(false);
    expect(isBsuid("us.123")).toBe(false);
    expect(countryFromBsuid("US.ENT.1")).toBe("US");
  });
});
