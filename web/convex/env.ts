// Which server keys are present (names only, booleans). Additive; used by the Settings page.
import { query } from "./_generated/server";

const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "NESSIE_KEY", "VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "CARTESIA_VOICE_ID", "TEST_PHONE_NUMBERS", "APIFY_TOKEN", "ACCOUNT_HMAC_KEY", "ACCOUNT_ENC_KEY", "EVAL_KEY", "RAIL", "VOICE", "VAPI_WEBHOOK_SECRET", "SITE_URL", "JWT_PRIVATE_KEY", "JWKS"] as const;

export const presence = query({
  args: {},
  handler: async () => {
    const out: Record<string, boolean> = {};
    for (const k of KEYS) out[k] = !!process.env[k];
    return out;
  },
});
