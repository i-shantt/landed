// Account-number protection. Uses Web Crypto (available in Convex actions and in
// the vitest edge runtime), so no "use node" is needed. Only ever call these from
// actions; mutations receive the already-computed hash and ciphertext.
//
// Deviation from the brief (which said "use node"): Web Crypto is available in the
// default Convex runtime and keeps bankAccounts/probes actions out of the Node
// runtime. Noted in BUILD_LOG.md.

const te = new TextEncoder();
let warned = false;

function warnDevKeys(which: string) {
  if (!warned) {
    warned = true;
    console.warn(
      `[landed] WARNING: ${which} is not set. Using a deterministic DEV key. ` +
        `Run: npx convex env set ACCOUNT_HMAC_KEY <random> && npx convex env set ACCOUNT_ENC_KEY <base64 32 bytes>`
    );
  }
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function normalizeDigits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

async function hmacKey(): Promise<CryptoKey> {
  let raw = process.env.ACCOUNT_HMAC_KEY;
  if (!raw) {
    warnDevKeys("ACCOUNT_HMAC_KEY");
    raw = "landed-dev-hmac-key-not-for-production";
  }
  return crypto.subtle.importKey("raw", te.encode(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function aesKey(): Promise<CryptoKey> {
  const env = process.env.ACCOUNT_ENC_KEY;
  let keyBytes: Uint8Array;
  if (env) {
    keyBytes = b64decode(env);
    if (keyBytes.length !== 32) throw new Error("ACCOUNT_ENC_KEY must be 32 bytes base64");
  } else {
    warnDevKeys("ACCOUNT_ENC_KEY");
    keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode("landed-dev-enc-key-not-for-production")));
  }
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** HMAC-SHA256(key, routing:account) hex, digits normalized. */
export async function hashAccount(routing: string, account: string): Promise<string> {
  const key = await hmacKey();
  const msg = `${normalizeDigits(routing)}:${normalizeDigits(account)}`;
  return hex(await crypto.subtle.sign("HMAC", key, te.encode(msg)));
}

/** AES-256-GCM; output base64(iv | tag | ciphertext). */
export async function encryptAccount(account: string): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctWithTag = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(normalizeDigits(account))));
  const tag = ctWithTag.slice(ctWithTag.length - 16);
  const ct = ctWithTag.slice(0, ctWithTag.length - 16);
  const out = new Uint8Array(12 + 16 + ct.length);
  out.set(iv, 0);
  out.set(tag, 12);
  out.set(ct, 28);
  return b64encode(out);
}

export async function decryptAccount(ciphertext: string): Promise<string> {
  const key = await aesKey();
  const buf = b64decode(ciphertext);
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct = buf.slice(28);
  const joined = new Uint8Array(ct.length + 16);
  joined.set(ct, 0);
  joined.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, joined);
  return new TextDecoder().decode(plain);
}

export async function hashAndEncrypt(routing: string, account: string) {
  const normalized = normalizeDigits(account);
  const [accountHash, accountCiphertext] = await Promise.all([hashAccount(routing, normalized), encryptAccount(normalized)]);
  return { accountHash, accountCiphertext, accountLast4: normalized.slice(-4), routing: normalizeDigits(routing) };
}

export function randomToken(bytes = 24): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return hex(arr.buffer as ArrayBuffer);
}
