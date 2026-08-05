/**
 * Phone normalization shared by guest checkout and phone sign-in.
 *
 * WHY THIS EXISTS: a guest payment is claimed by matching the phone captured at
 * checkout (`pendingClaims.phone`) against the Firebase Auth `phoneNumber`
 * proven by OTP at sign-in. /api/subscription/reconcile does that with an exact
 * equality query, so the two call sites must produce byte-identical E.164 or a
 * completed purchase is silently stranded on the throwaway anonymous account —
 * with no error shown to anyone.
 *
 * Checkout used to build `countryCode + digits` and login used
 * `countryCode + raw input`, neither stripping a leading trunk zero or a
 * re-typed country code. Someone entering "09876543210" under +91 stored
 * "+9109876543210" while Auth registered "+919876543210".
 */

/**
 * Exact national-number length per country code offered in the checkout/login
 * pickers. Per-country rather than one global minimum: a single loose bound
 * would let a truncated Indian number (8 of its 10 digits) through checkout —
 * the buyer pays, and the claim is recorded against a number they can never
 * receive an OTP on, so the purchase is unrecoverable.
 */
const NATIONAL_DIGITS: Record<string, number> = {
  "91": 10, // India
  "1": 10, // US/Canada
  "44": 10, // UK mobile
  "61": 9, // Australia mobile
  "971": 9, // UAE mobile
};

/** Fallback for a country code not in the table above. */
const MIN_NATIONAL_DIGITS = 8;

/** Digits-only country code, e.g. "+91" -> "91". */
function ccDigits(countryCode: string): string {
  return countryCode.replace(/\D/g, "");
}

/** The national part of a normalized number, given its country code. */
function nationalPart(countryCode: string, e164: string): string {
  return e164.replace(/^\+/, "").slice(ccDigits(countryCode).length);
}

/**
 * Build an E.164 number from a country-code selection and whatever the user
 * typed in the national field.
 *
 * Handles the ways people actually type numbers: spaces, dashes and brackets;
 * a leading trunk/STD zero ("09876543210"); the international prefix
 * ("00919876543210"); and the country code repeated in the national box
 * ("+91" selected, "919876543210" typed).
 */
export function normalizePhone(countryCode: string, input: string): string {
  const cc = ccDigits(countryCode);
  let national = input.replace(/\D/g, "");

  // Order matters: strip leading zeros FIRST so an international prefix
  // ("00" + "91" + number) reduces to a plain country-code-prefixed number and
  // is then caught by the duplicate-country-code rule below.
  national = national.replace(/^0+/, "");

  // Country code re-typed in the national field. Only strip when what's left
  // is still a plausible national number, so a genuine number that merely
  // starts with the same digits ("9198765432" under +91) is left alone.
  if (cc && national.length > 10 && national.startsWith(cc)) {
    national = national.slice(cc.length);
    // "+91" selected, "9109876543210" typed — a trunk zero can resurface once
    // the duplicated country code is removed.
    national = national.replace(/^0+/, "");
  }

  return `+${cc}${national}`;
}

/**
 * The shape the server enforces in /api/checkout/guest-init and
 * /api/auth/verify-otp. Exported so client and server agree on the format.
 */
export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

/**
 * Full check for a phone the user is about to pay against: correct E.164 shape
 * AND a national part long enough to be a real number. Use this at every
 * checkout / sign-in entry point.
 */
export function isCompletePhone(countryCode: string, e164: string): boolean {
  if (!isValidE164(e164)) return false;
  const cc = ccDigits(countryCode);
  const digits = nationalPart(countryCode, e164).length;
  const expected = NATIONAL_DIGITS[cc];
  return expected === undefined ? digits >= MIN_NATIONAL_DIGITS : digits === expected;
}
