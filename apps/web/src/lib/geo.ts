// Resolve a visitor's ISO-3166 alpha-2 country without calling a third-party
// geo API.
//
// Why this exists: the checkout attribution route used to read the country from
// edge headers only (cf-ipcountry / x-vercel-ip-country / x-appengine-country /
// x-country-code). Bistar runs on Firebase App Hosting, whose front end forwards
// none of them, so every attribution doc was written with `country: null` and
// the marketing dashboard's "By country" breakdown could never show anything but
// "(direct / none)".
//
// The browser already knows two things that are good, free proxies for location:
// its IANA timezone and its locale. Timezone wins — it tracks where the device
// actually is, while a locale is a language preference that often points
// somewhere else (plenty of Indian users run en-GB). A locale *region* subtag is
// the fallback when the timezone is unknown to the table below.

// IANA zone -> ISO-3166 alpha-2. Covers every zone with meaningful traffic plus
// the one-zone-per-country cases; unknown zones fall through to the locale.
const TZ_COUNTRY: Record<string, string> = {
  // --- South Asia (primary market) ---
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Colombo": "LK",
  "Asia/Kathmandu": "NP",
  "Asia/Katmandu": "NP",
  "Asia/Thimphu": "BT",
  "Asia/Kabul": "AF",
  "Indian/Maldives": "MV",

  // --- Middle East ---
  "Asia/Dubai": "AE",
  "Asia/Muscat": "OM",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Bahrain": "BH",
  "Asia/Kuwait": "KW",
  "Asia/Baghdad": "IQ",
  "Asia/Tehran": "IR",
  "Asia/Jerusalem": "IL",
  "Asia/Tel_Aviv": "IL",
  "Asia/Amman": "JO",
  "Asia/Beirut": "LB",
  "Asia/Damascus": "SY",
  "Asia/Nicosia": "CY",
  "Europe/Istanbul": "TR",
  "Asia/Istanbul": "TR",
  "Asia/Yerevan": "AM",
  "Asia/Baku": "AZ",
  "Asia/Tbilisi": "GE",

  // --- East / South-East Asia ---
  "Asia/Shanghai": "CN",
  "Asia/Chongqing": "CN",
  "Asia/Urumqi": "CN",
  "Asia/Hong_Kong": "HK",
  "Asia/Macau": "MO",
  "Asia/Taipei": "TW",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Pyongyang": "KP",
  "Asia/Ulaanbaatar": "MN",
  "Asia/Singapore": "SG",
  "Asia/Kuala_Lumpur": "MY",
  "Asia/Kuching": "MY",
  "Asia/Bangkok": "TH",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",
  "Asia/Phnom_Penh": "KH",
  "Asia/Vientiane": "LA",
  "Asia/Yangon": "MM",
  "Asia/Rangoon": "MM",
  "Asia/Jakarta": "ID",
  "Asia/Pontianak": "ID",
  "Asia/Makassar": "ID",
  "Asia/Jayapura": "ID",
  "Asia/Manila": "PH",
  "Asia/Brunei": "BN",
  "Asia/Dili": "TL",

  // --- Central Asia ---
  "Asia/Tashkent": "UZ",
  "Asia/Samarkand": "UZ",
  "Asia/Almaty": "KZ",
  "Asia/Aqtobe": "KZ",
  "Asia/Bishkek": "KG",
  "Asia/Dushanbe": "TJ",
  "Asia/Ashgabat": "TM",

  // --- Europe ---
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Lisbon": "PT",
  "Atlantic/Azores": "PT",
  "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES",
  "Europe/Paris": "FR",
  "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL",
  "Europe/Luxembourg": "LU",
  "Europe/Berlin": "DE",
  "Europe/Zurich": "CH",
  "Europe/Vienna": "AT",
  "Europe/Rome": "IT",
  "Europe/Malta": "MT",
  "Europe/Copenhagen": "DK",
  "Europe/Oslo": "NO",
  "Europe/Stockholm": "SE",
  "Europe/Helsinki": "FI",
  "Europe/Tallinn": "EE",
  "Europe/Riga": "LV",
  "Europe/Vilnius": "LT",
  "Europe/Warsaw": "PL",
  "Europe/Prague": "CZ",
  "Europe/Bratislava": "SK",
  "Europe/Budapest": "HU",
  "Europe/Ljubljana": "SI",
  "Europe/Zagreb": "HR",
  "Europe/Sarajevo": "BA",
  "Europe/Belgrade": "RS",
  "Europe/Podgorica": "ME",
  "Europe/Skopje": "MK",
  "Europe/Tirane": "AL",
  "Europe/Athens": "GR",
  "Europe/Sofia": "BG",
  "Europe/Bucharest": "RO",
  "Europe/Chisinau": "MD",
  "Europe/Kiev": "UA",
  "Europe/Kyiv": "UA",
  "Europe/Minsk": "BY",
  "Europe/Moscow": "RU",
  "Europe/Kaliningrad": "RU",
  "Europe/Samara": "RU",
  "Asia/Yekaterinburg": "RU",
  "Asia/Novosibirsk": "RU",
  "Asia/Krasnoyarsk": "RU",
  "Asia/Irkutsk": "RU",
  "Asia/Vladivostok": "RU",
  "Atlantic/Reykjavik": "IS",

  // --- Africa ---
  "Africa/Cairo": "EG",
  "Africa/Tripoli": "LY",
  "Africa/Tunis": "TN",
  "Africa/Algiers": "DZ",
  "Africa/Casablanca": "MA",
  "Africa/Lagos": "NG",
  "Africa/Accra": "GH",
  "Africa/Abidjan": "CI",
  "Africa/Dakar": "SN",
  "Africa/Bamako": "ML",
  "Africa/Nairobi": "KE",
  "Africa/Kampala": "UG",
  "Africa/Dar_es_Salaam": "TZ",
  "Africa/Addis_Ababa": "ET",
  "Africa/Khartoum": "SD",
  "Africa/Kinshasa": "CD",
  "Africa/Luanda": "AO",
  "Africa/Lusaka": "ZM",
  "Africa/Harare": "ZW",
  "Africa/Maputo": "MZ",
  "Africa/Johannesburg": "ZA",
  "Indian/Mauritius": "MU",

  // --- North America ---
  "America/New_York": "US",
  "America/Detroit": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Phoenix": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "Pacific/Honolulu": "US",
  "America/Toronto": "CA",
  "America/Montreal": "CA",
  "America/Winnipeg": "CA",
  "America/Edmonton": "CA",
  "America/Vancouver": "CA",
  "America/Halifax": "CA",
  "America/St_Johns": "CA",
  "America/Mexico_City": "MX",
  "America/Tijuana": "MX",
  "America/Monterrey": "MX",
  "America/Guatemala": "GT",
  "America/Costa_Rica": "CR",
  "America/Panama": "PA",
  "America/Havana": "CU",
  "America/Santo_Domingo": "DO",
  "America/Port-au-Prince": "HT",
  "America/Jamaica": "JM",
  "America/Puerto_Rico": "PR",

  // --- South America ---
  "America/Bogota": "CO",
  "America/Caracas": "VE",
  "America/Lima": "PE",
  "America/Guayaquil": "EC",
  "America/La_Paz": "BO",
  "America/Santiago": "CL",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Buenos_Aires": "AR",
  "America/Montevideo": "UY",
  "America/Asuncion": "PY",
  "America/Sao_Paulo": "BR",
  "America/Bahia": "BR",
  "America/Fortaleza": "BR",
  "America/Manaus": "BR",
  "America/Recife": "BR",

  // --- Oceania ---
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Adelaide": "AU",
  "Australia/Perth": "AU",
  "Australia/Darwin": "AU",
  "Australia/Hobart": "AU",
  "Pacific/Auckland": "NZ",
  "Pacific/Fiji": "FJ",
  "Pacific/Port_Moresby": "PG",
  "Pacific/Guam": "GU",
};

/** ISO country for an IANA timezone id, or null when the zone isn't mapped. */
export function countryFromTimezone(tz?: string | null): string | null {
  if (!tz) return null;
  return TZ_COUNTRY[tz.trim()] ?? null;
}

/**
 * ISO country from a BCP-47 tag's region subtag: "en-IN" -> IN,
 * "zh-Hans-CN" -> CN. Language-only tags ("en") carry no region and yield null.
 */
export function countryFromLocale(locale?: string | null): string | null {
  if (!locale) return null;
  const m = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})(?:-|$)/.exec(locale.trim());
  return m ? m[1].toUpperCase() : null;
}

/** Two-letter uppercase code, or null for the "unknown" sentinels edges emit. */
export function normalizeCountry(raw?: string | null): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase();
  if (c.length !== 2 || c === "ZZ" || c === "XX" || c === "T1") return null;
  return c;
}
