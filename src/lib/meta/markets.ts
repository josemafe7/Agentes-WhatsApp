// The pricing market of a WhatsApp recipient ([WA-47]): from the phone's country calling code or, without a phone,
// from the ISO prefix of the BSUID (docs/integracion-whatsapp-mensajes.md §6 and §8.3). The table below maps E.164
// country codes (prefix-free) to ISO 3166-1 alpha-2 countries: data, not prices. When a calling code is shared by
// several countries (+1, +7, +44…) and the BSUID names one of them, that one wins; otherwise the first listed.

const CALLING_CODES: Readonly<Record<string, readonly string[]>> = {
  "1": ["US", "CA", "PR", "DO", "JM", "TT", "BS", "BB", "AG", "DM", "GD", "KN", "LC", "VC", "BM", "KY", "VG", "VI", "TC", "AI", "MS", "SX", "GU", "AS", "MP"],
  "7": ["RU", "KZ"],
  "20": ["EG"], "27": ["ZA"], "30": ["GR"], "31": ["NL"], "32": ["BE"], "33": ["FR"], "34": ["ES"], "36": ["HU"], "39": ["IT", "VA"],
  "40": ["RO"], "41": ["CH"], "43": ["AT"], "44": ["GB", "GG", "JE", "IM"], "45": ["DK"], "46": ["SE"], "47": ["NO", "SJ"], "48": ["PL"],
  "49": ["DE"], "51": ["PE"], "52": ["MX"], "53": ["CU"], "54": ["AR"], "55": ["BR"], "56": ["CL"], "57": ["CO"], "58": ["VE"],
  "60": ["MY"], "61": ["AU", "CX", "CC"], "62": ["ID"], "63": ["PH"], "64": ["NZ"], "65": ["SG"], "66": ["TH"], "81": ["JP"],
  "82": ["KR"], "84": ["VN"], "86": ["CN"], "90": ["TR"], "91": ["IN"], "92": ["PK"], "93": ["AF"], "94": ["LK"], "95": ["MM"], "98": ["IR"],
  "211": ["SS"], "212": ["MA", "EH"], "213": ["DZ"], "216": ["TN"], "218": ["LY"], "220": ["GM"], "221": ["SN"], "222": ["MR"],
  "223": ["ML"], "224": ["GN"], "225": ["CI"], "226": ["BF"], "227": ["NE"], "228": ["TG"], "229": ["BJ"], "230": ["MU"], "231": ["LR"],
  "232": ["SL"], "233": ["GH"], "234": ["NG"], "235": ["TD"], "236": ["CF"], "237": ["CM"], "238": ["CV"], "239": ["ST"], "240": ["GQ"],
  "241": ["GA"], "242": ["CG"], "243": ["CD"], "244": ["AO"], "245": ["GW"], "246": ["IO"], "248": ["SC"], "249": ["SD"], "250": ["RW"],
  "251": ["ET"], "252": ["SO"], "253": ["DJ"], "254": ["KE"], "255": ["TZ"], "256": ["UG"], "257": ["BI"], "258": ["MZ"], "260": ["ZM"],
  "261": ["MG"], "262": ["RE", "YT"], "263": ["ZW"], "264": ["NA"], "265": ["MW"], "266": ["LS"], "267": ["BW"], "268": ["SZ"],
  "269": ["KM"], "290": ["SH"], "291": ["ER"], "297": ["AW"], "298": ["FO"], "299": ["GL"],
  "350": ["GI"], "351": ["PT"], "352": ["LU"], "353": ["IE"], "354": ["IS"], "355": ["AL"], "356": ["MT"], "357": ["CY"], "358": ["FI", "AX"],
  "359": ["BG"], "370": ["LT"], "371": ["LV"], "372": ["EE"], "373": ["MD"], "374": ["AM"], "375": ["BY"], "376": ["AD"], "377": ["MC"],
  "378": ["SM"], "380": ["UA"], "381": ["RS"], "382": ["ME"], "383": ["XK"], "385": ["HR"], "386": ["SI"], "387": ["BA"], "389": ["MK"],
  "420": ["CZ"], "421": ["SK"], "423": ["LI"],
  "500": ["FK"], "501": ["BZ"], "502": ["GT"], "503": ["SV"], "504": ["HN"], "505": ["NI"], "506": ["CR"], "507": ["PA"], "508": ["PM"],
  "509": ["HT"], "590": ["GP", "BL", "MF"], "591": ["BO"], "592": ["GY"], "593": ["EC"], "594": ["GF"], "595": ["PY"], "596": ["MQ"],
  "597": ["SR"], "598": ["UY"], "599": ["CW", "BQ"],
  "670": ["TL"], "672": ["NF"], "673": ["BN"], "674": ["NR"], "675": ["PG"], "676": ["TO"], "677": ["SB"], "678": ["VU"], "679": ["FJ"],
  "680": ["PW"], "681": ["WF"], "682": ["CK"], "683": ["NU"], "685": ["WS"], "686": ["KI"], "687": ["NC"], "688": ["TV"], "689": ["PF"],
  "690": ["TK"], "691": ["FM"], "692": ["MH"],
  "850": ["KP"], "852": ["HK"], "853": ["MO"], "855": ["KH"], "856": ["LA"], "880": ["BD"], "886": ["TW"],
  "960": ["MV"], "961": ["LB"], "962": ["JO"], "963": ["SY"], "964": ["IQ"], "965": ["KW"], "966": ["SA"], "967": ["YE"], "968": ["OM"],
  "970": ["PS"], "971": ["AE"], "972": ["IL"], "973": ["BH"], "974": ["QA"], "975": ["BT"], "976": ["MN"], "977": ["NP"],
  "992": ["TJ"], "993": ["TM"], "994": ["AZ"], "995": ["GE"], "996": ["KG"], "998": ["UZ"],
};

/** A BSUID: ISO alpha-2 country, a dot and up to 128 alphanumerics (the parent variant has «ENT.» in between). */
export const BSUID_PATTERN = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

export function isBsuid(value: string | null | undefined): value is string {
  return typeof value === "string" && BSUID_PATTERN.test(value);
}

/** Digits only: «+34 600-111 222» → «34600111222». */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Countries of the phone's calling code (longest match), or [] when unknown. */
export function countriesForPhone(phone: string | null | undefined): readonly string[] {
  const digits = phoneDigits(phone);
  for (const length of [1, 2, 3]) {
    const found = CALLING_CODES[digits.slice(0, length)];
    if (found && digits.length > length) return found;
  }
  return [];
}

/** Country of a BSUID («US.1349…» → «US»), or null. */
export function countryFromBsuid(bsuid: string | null | undefined): string | null {
  return isBsuid(bsuid) ? bsuid.slice(0, 2) : null;
}

/**
 * The market of a recipient: the phone's country (the BSUID's when it is one of the countries of that calling code),
 * or the BSUID's country without a phone. null when neither says it.
 */
export function resolveMarket(input: { phone?: string | null; bsuid?: string | null }): string | null {
  const fromBsuid = countryFromBsuid(input.bsuid);
  const candidates = countriesForPhone(input.phone);
  if (candidates.length === 0) return fromBsuid;
  return fromBsuid && candidates.includes(fromBsuid) ? fromBsuid : candidates[0];
}
