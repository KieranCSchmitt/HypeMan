import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ChatGPTAuth } from "./chatgpt-auth";

const redirect = "http://127.0.0.1:8787/auth/callback";
const issuer = "https://auth.openai.com";
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const directory = () => {
  const value = mkdtempSync(join(tmpdir(), "hypeman-chatgpt-test-"));
  directories.push(value);
  return value;
};
const tokens = (client = "one", scope = scopes, expires = 3600) => ({
  access_token: `private-access-${client}`, refresh_token: `private-refresh-${client}`,
  id_token: `private-id-${client}`, token_type: "Bearer", expires_in: expires, scope,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function callback(authorize: URL, clientId?: string, extra: Record<string, string> = {}) {
  const result = new URL(redirect);
  result.search = new URLSearchParams({
    state: authorize.searchParams.get("state")!, code: "one-time-code",
    ...(clientId ? { client_id: clientId } : {}), ...extra,
  }).toString();
  return result;
}
function fixture(options: { expires?: number; scope?: string; storage?: string } = {}) {
  const storage = options.storage ?? directory();
  const calls: { url: string; form: URLSearchParams; signal?: AbortSignal | null }[] = [];
  let tokenReply: (form: URLSearchParams) => Promise<Response> = async (form) =>
    json(tokens(form.get("client_id")!, options.scope, options.expires));
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url), form = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url: address, form, signal: init?.signal });
    if (address.endsWith("/openid-configuration"))
      return json({ issuer, revocation_endpoint: `${issuer}/api/accounts/oauth/revoke` });
    if (address.endsWith("/revoke")) return new Response(null, { status: 200 });
    if (!address.endsWith("/token")) throw new Error("Unexpected test provider endpoint");
    return tokenReply(form);
  }) as typeof fetch;
  const verifyIdentity = vi.fn(async (_token: string, expected: { clientId: string; nonce?: string }) => ({
    subject: `subject-${expected.clientId}`, email: "same@example.com",
  }));
  const auth = new ChatGPTAuth({ directory: storage, fetcher, verifyIdentity });
  const signIn = async (client = "oaiapp_one", input: { profileId?: string; newProfile?: boolean } = { newProfile: true }) => {
    const authorize = new URL((await auth.start(input, redirect)).url);
    await auth.callback(callback(authorize, authorize.searchParams.get("client_id") === "dynamic_agent_client" ? client : undefined));
    return authorize;
  };
  return { auth, calls, fetcher, verifyIdentity, storage, signIn,
    reply: (fn: typeof tokenReply) => { tokenReply = fn; } };
}

describe("ChatGPT public-client sign-in", () => {
  it("binds PKCE and identity to an issued client, with protected atomic persistence and safe status", async () => {
    const test = fixture();
    test.reply(async (form) => {
      const saved = JSON.parse(readFileSync(join(test.storage, "chatgpt-auth.json"), "utf8"));
      expect(saved.profiles[0]).toMatchObject({ clientId: "oaiapp_one" });
      expect(saved.profiles[0]).not.toHaveProperty("tokens");
      return json(tokens(form.get("client_id")!));
    });
    const authorize = await test.signIn();
    expect(authorize.origin + authorize.pathname).toBe(`${issuer}/api/accounts/authorize`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: "dynamic_agent_client", agent_name_hint: "HypeMan",
      response_type: "code", redirect_uri: redirect, resource: "https://api.openai.com/v1",
      scope: scopes, code_challenge_method: "S256",
    });
    const form = test.calls[0].form;
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "authorization_code", client_id: "oaiapp_one", redirect_uri: redirect,
      code: "one-time-code", resource: "https://api.openai.com/v1",
    });
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url"))
      .toBe(authorize.searchParams.get("code_challenge"));
    expect(test.verifyIdentity).toHaveBeenCalledWith("private-id-oaiapp_one", {
      clientId: "oaiapp_one", nonce: authorize.searchParams.get("nonce"),
    });
    // POSIX mode bits have no owner-only meaning on Windows; its profile ACLs
    // provide access control. Keep persistence and credential isolation checks
    // on every platform, and assert POSIX permissions where they are supported.
    if (process.platform !== "win32") {
      expect(statSync(test.storage).mode & 0o777).toBe(0o700);
      expect(statSync(join(test.storage, "chatgpt-auth.json")).mode & 0o777).toBe(0o600);
    }
    expect(test.auth.status()).toMatchObject({ connected: true, sharing: true, pending: false });
    const publicStatus = JSON.stringify(test.auth.status());
    for (const secret of ["private-access", "private-refresh", "private-id", "oaiapp_one", "urn:uuid:"])
      expect(publicStatus).not.toContain(secret);
    test.auth.setModel("chosen-chatgpt-model");
    const resumed = new ChatGPTAuth({ directory: test.storage, fetcher: test.fetcher, verifyIdentity: test.verifyIdentity });
    expect(resumed.status()).toMatchObject({ connected: true, sharing: true, model: "chosen-chatgpt-model" });
    const returning = new URL((await resumed.start({}, redirect)).url);
    expect(returning.searchParams.get("client_id")).toBe("oaiapp_one");
    expect(returning.searchParams.get("ext_agent_host_id")).toBe(authorize.searchParams.get("ext_agent_host_id"));
    expect(returning.searchParams.get("login_hint")).toBe("same@example.com");
    expect(returning.searchParams.has("id_token_hint")).toBe(false);
    expect(returning.searchParams.has("agent_name_hint")).toBe(false);
    expect(returning.searchParams.has("prompt")).toBe(false);
    for (const name of ["state", "nonce", "code_challenge"])
      expect(returning.searchParams.get(name)).not.toBe(authorize.searchParams.get(name));
  });

  it("retains issued registration when code exchange fails, for safe reauthorization", async () => {
    const test = fixture();
    test.reply(async () => json({ error: "invalid_grant", error_description: "private-upstream-detail" }, 400));
    const authorize = new URL((await test.auth.start({}, redirect)).url);
    await expect(test.auth.callback(callback(authorize, "oaiapp_retained")))
      .rejects.toMatchObject({ code: "chatgpt_session_expired" });
    expect(test.auth.status()).toMatchObject({ activeProfileId: null, pending: false });
    expect(JSON.stringify(test.auth.status())).not.toContain("private-upstream-detail");
    const saved = test.auth.status().profiles[0];
    expect(saved).toMatchObject({ connected: false, sharing: false });
    const retry = new URL((await test.auth.start({ profileId: saved.id }, redirect)).url);
    expect(retry.searchParams.get("client_id")).toBe("oaiapp_retained");
    expect(retry.searchParams.has("agent_name_hint")).toBe(false);
  });

  it("rejects invalid, expired, duplicated, and reused state before contacting the token endpoint", async () => {
    const test = fixture();
    const authorize = new URL((await test.auth.start({}, redirect)).url);
    await expect(test.auth.callback(callback(authorize, "oaiapp_one", { state: "wrong-state" })))
      .rejects.toMatchObject({ code: "chatgpt_invalid_state" });
    expect(test.calls).toHaveLength(0);
    await expect(test.auth.callback(callback(authorize, "oaiapp_one")))
      .rejects.toMatchObject({ code: "chatgpt_invalid_callback" });
    const repeated = new URL((await test.auth.start({}, redirect)).url);
    const duplicate = callback(repeated, "oaiapp_one");
    duplicate.searchParams.append("state", repeated.searchParams.get("state")!);
    await expect(test.auth.callback(duplicate)).rejects.toMatchObject({ code: "chatgpt_invalid_state" });
    const expired = new URL((await test.auth.start({}, redirect)).url);
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    try {
      await expect(test.auth.callback(callback(expired, "oaiapp_one")))
        .rejects.toMatchObject({ code: "chatgpt_sign_in_expired" });
    } finally { time.mockRestore(); }
    expect(test.calls).toHaveLength(0);
    const successful = await test.signIn();
    await expect(test.auth.callback(callback(successful, "oaiapp_one")))
      .rejects.toMatchObject({ code: "chatgpt_invalid_callback" });
    expect(test.calls).toHaveLength(1);
  });

  it("validates state before honoring an OAuth denial and never exposes its description", async () => {
    const test = fixture();
    const authorize = new URL((await test.auth.start({}, redirect)).url);
    await expect(test.auth.callback(callback(authorize, undefined, {
      error: "access_denied", error_description: "private-provider-error",
    }))).rejects.toMatchObject({ status: 403, code: "chatgpt_access_denied" });
    expect(test.calls).toHaveLength(0);
    expect(test.auth.status()).toMatchObject({ connected: false, pending: false, profiles: [] });
    expect(JSON.stringify(test.auth.status())).not.toContain("private-provider-error");
  });

  it("requires granted plan permission and requests consent for an identity-only saved account", async () => {
    const test = fixture({ scope: "openid profile email offline_access" });
    await test.signIn();
    expect(test.auth.status()).toMatchObject({ connected: true, sharing: false });
    await expect(test.auth.accessToken()).rejects.toMatchObject({ code: "chatgpt_plan_sharing_required" });
    const reconsent = new URL((await test.auth.start({}, redirect)).url);
    expect(reconsent.searchParams.get("client_id")).toBe("oaiapp_one");
    expect(reconsent.searchParams.get("prompt")).toBe("consent");
    expect(test.calls).toHaveLength(1);
  });

  it("keeps same-email registrations distinct and refuses identity or client substitution", async () => {
    const test = fixture();
    await test.signIn("oaiapp_one");
    test.auth.setModel("model-one");
    const first = test.auth.status().activeProfileId!;
    await test.signIn("oaiapp_two");
    const second = test.auth.status().activeProfileId!;
    test.auth.setModel("model-two");
    expect(test.auth.status().profiles).toHaveLength(2);
    expect(new Set(test.auth.status().profiles.map((p) => p.label)).size).toBe(2);
    await test.auth.select(first);
    expect(test.auth.model).toBe("model-one");
    const authorize = new URL((await test.auth.start({ profileId: second }, redirect)).url);
    expect(test.auth.status().activeProfileId).toBe(first);
    await expect(test.auth.callback(callback(authorize, "oaiapp_attacker")))
      .rejects.toMatchObject({ code: "chatgpt_registration_mismatch" });
    expect(test.auth.status().activeProfileId).toBe(first);
    const returning = new URL((await test.auth.start({ profileId: second }, redirect)).url);
    test.verifyIdentity.mockResolvedValueOnce({ subject: "wrong-account", email: "same@example.com" });
    await expect(test.auth.callback(callback(returning)))
      .rejects.toMatchObject({ code: "chatgpt_identity_mismatch" });
    expect(test.auth.status().activeProfileId).toBe(first);
    expect(await test.auth.accessToken()).toBe("private-access-oaiapp_one");
    await test.auth.select(second);
    expect(test.auth.model).toBe("model-two");
  });

  it("cancels an in-flight sign-in without replacing the active account", async () => {
    const test = fixture();
    await test.signIn("oaiapp_one");
    const first = test.auth.status().activeProfileId;
    let finish!: (response: Response) => void;
    test.reply(() => new Promise((resolve) => { finish = resolve; }));
    const authorize = new URL((await test.auth.start({ newProfile: true }, redirect)).url);
    const pending = test.auth.callback(callback(authorize, "oaiapp_two"));
    test.auth.cancel();
    finish(json(tokens("oaiapp_two")));
    await expect(pending).rejects.toMatchObject({ code: "chatgpt_sign_in_expired" });
    expect(test.auth.status()).toMatchObject({ activeProfileId: first, pending: false, connected: true });
    expect(await test.auth.accessToken()).toBe("private-access-oaiapp_one");
  });
});

describe("ChatGPT identity signature verification", () => {
  it.each(["valid", "nonce", "audience", "issuer", "expired", "signature"])("checks %s ID token against OpenAI JWKS", async (variant) => {
    const storage = directory();
    const keys = await generateKeyPair("RS256");
    const jwk = await exportJWK(keys.publicKey);
    let idToken = "";
    const fetcher = vi.fn(async (url: unknown) => {
      if (String(url).endsWith("/jwks.json")) return json({ keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-key" }] });
      return json({ ...tokens("signed"), id_token: idToken });
    }) as typeof fetch;
    const auth = new ChatGPTAuth({ directory: storage, fetcher });
    const authorize = new URL((await auth.start({}, redirect)).url);
    const signingKey = variant === "signature" ? (await generateKeyPair("RS256")).privateKey : keys.privateKey;
    idToken = await new SignJWT({ nonce: variant === "nonce" ? "wrong-nonce" : authorize.searchParams.get("nonce"), email: "verified@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(variant === "issuer" ? "https://attacker.example" : issuer)
      .setAudience(variant === "audience" ? "oaiapp_other" : "oaiapp_signed")
      .setSubject("verified-subject").setIssuedAt()
      .setExpirationTime(variant === "expired" ? Math.floor(Date.now() / 1000) - 60 : "5m")
      .sign(signingKey);
    if (variant === "valid") {
      await auth.callback(callback(authorize, "oaiapp_signed"));
      expect(auth.status()).toMatchObject({ connected: true, sharing: true });
    } else {
      await expect(auth.callback(callback(authorize, "oaiapp_signed")))
        .rejects.toMatchObject({ code: "chatgpt_identity_invalid" });
      expect(auth.status()).toMatchObject({ activeProfileId: null, connected: false });
      expect(JSON.stringify(auth.status())).not.toContain(idToken);
    }
  });
});

describe("ChatGPT renewable sessions", () => {
  it("serializes refresh, rotates the full token set atomically, and retains grants if scope is omitted", async () => {
    const test = fixture({ expires: 1 });
    await test.signIn();
    let finish!: (response: Response) => void;
    test.reply(() => new Promise((resolve) => { finish = resolve; }));
    const first = test.auth.accessToken(), second = test.auth.accessToken();
    expect(test.calls).toHaveLength(2);
    const form = test.calls[1].form;
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "refresh_token", client_id: "oaiapp_one", refresh_token: "private-refresh-oaiapp_one",
      resource: "https://api.openai.com/v1",
    });
    const { scope: _scope, ...replacement } = tokens("rotated");
    finish(json(replacement));
    expect(await Promise.all([first, second])).toEqual(["private-access-rotated", "private-access-rotated"]);
    expect(test.auth.sharing).toBe(true);
    const saved = JSON.parse(readFileSync(join(test.storage, "chatgpt-auth.json"), "utf8"));
    expect(saved.profiles[0].tokens).toMatchObject({
      accessToken: "private-access-rotated", refreshToken: "private-refresh-rotated", idToken: "private-id-rotated",
    });
    expect(saved.profiles[0].tokens.scopes).toContain("chatgpt.tokens.use.direct");
  });

  it.each([
    "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
    "refresh_token_invalidated", "refresh_token_reused",
  ])("fails closed on unusable %s refresh without dropping the selected registration", async (code) => {
    const test = fixture({ expires: 1 });
    await test.signIn();
    const selected = test.auth.status().activeProfileId;
    test.reply(async () => json({ error: code, error_description: "private-expired-refresh" }, 400));
    await expect(test.auth.accessToken()).rejects.toMatchObject({ code: "chatgpt_session_expired" });
    expect(test.auth.status()).toMatchObject({ activeProfileId: selected, connected: false, sharing: false });
    expect(test.auth.status().profiles).toHaveLength(1);
    expect(JSON.stringify(test.auth.status())).not.toContain("private-expired-refresh");
    const saved = JSON.parse(readFileSync(join(test.storage, "chatgpt-auth.json"), "utf8"));
    expect(saved.profiles[0]).not.toHaveProperty("tokens");
    expect(saved.profiles[0].clientId).toBe("oaiapp_one");
  });

  it("retains credentials for temporary service and client configuration failures", async () => {
    const test = fixture({ expires: 1 });
    await test.signIn();
    for (const [error, status, expected] of [
      ["temporary_failure", 503, "chatgpt_auth_unavailable"],
      ["invalid_client", 400, "chatgpt_client_configuration"],
    ] as const) {
      test.reply(async () => json({ error, error_description: "private-diagnostic" }, status));
      await expect(test.auth.accessToken()).rejects.toMatchObject({ code: expected });
      expect(test.auth.status()).toMatchObject({ connected: true, sharing: true });
      expect(readFileSync(join(test.storage, "chatgpt-auth.json"), "utf8")).toContain("private-refresh-oaiapp_one");
      expect(JSON.stringify(test.auth.status())).not.toContain("private-diagnostic");
    }
  });

  it("honors a refresh that removes plan permission without using the new access token", async () => {
    const test = fixture({ expires: 1 });
    await test.signIn();
    test.reply(async () => json(tokens("identity-only", "openid profile email")));
    await expect(test.auth.accessToken()).rejects.toMatchObject({ code: "chatgpt_plan_sharing_required" });
    expect(test.auth.status()).toMatchObject({ connected: true, sharing: false });
  });

  it.each(["logout", "switch"])("invalidates an old refresh after %s even when the provider ignores cancellation", async (operation) => {
    const test = fixture({ expires: 1 });
    await test.signIn("oaiapp_one");
    const firstId = test.auth.status().activeProfileId!;
    await test.signIn("oaiapp_two");
    const secondId = test.auth.status().activeProfileId!;
    await test.auth.select(firstId);
    let finish!: (response: Response) => void;
    test.reply(() => new Promise((resolve) => { finish = resolve; }));
    const refreshing = test.auth.accessToken();
    const upstream = test.calls[2].signal!;
    if (operation === "logout") await test.auth.logout();
    else await test.auth.select(secondId);
    expect(upstream.aborted).toBe(true);
    finish(json(tokens("stale")));
    await expect(refreshing).rejects.toMatchObject({ code: "chatgpt_account_changed" });
    expect(test.auth.status().activeProfileId).toBe(operation === "logout" ? null : secondId);
    const stored = readFileSync(join(test.storage, "chatgpt-auth.json"), "utf8");
    expect(stored).not.toContain("private-access-stale");
    if (operation === "logout") {
      expect(test.auth.status().profiles.find((p) => p.id === firstId)).toMatchObject({ connected: false });
      const revocation = test.calls.find((call) => call.url.endsWith("/revoke"))!;
      expect(Object.fromEntries(revocation.form)).toEqual({
        token: "private-refresh-oaiapp_one", token_type_hint: "refresh_token", client_id: "oaiapp_one",
      });
      const returning = new URL((await test.auth.start({ profileId: firstId }, redirect)).url);
      expect(returning.searchParams.get("client_id")).toBe("oaiapp_one");
    }
  });

  it("clears tokens locally and warns if remote revocation cannot be confirmed", async () => {
    const test = fixture();
    await test.signIn();
    const offlineFetcher = vi.fn(async () => { throw new Error("private-network-error"); }) as typeof fetch;
    const resumed = new ChatGPTAuth({ directory: test.storage, fetcher: offlineFetcher, verifyIdentity: test.verifyIdentity });
    await resumed.logout();
    expect(resumed.status()).toMatchObject({ activeProfileId: null, connected: false, sharing: false });
    expect(resumed.status().warning).toContain("Remote sign-out could not be confirmed");
    expect(JSON.stringify(resumed.status())).not.toContain("private-network-error");
    const stored = readFileSync(join(test.storage, "chatgpt-auth.json"), "utf8");
    expect(stored).not.toContain("private-access");
    expect(stored).not.toContain("private-refresh");
    expect(stored).not.toContain("private-id");
    expect(stored).toContain("oaiapp_one");
    expect(offlineFetcher).toHaveBeenCalledTimes(3);
  });

  it("does not let a slow sign-out warning overwrite a newer successful sign-in", async () => {
    const test = fixture();
    await test.signIn();
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith("/revoke")) return new Promise<Response>((resolve) => { finish = resolve; });
      return test.fetcher(url as string, init);
    }) as typeof fetch;
    const auth = new ChatGPTAuth({ directory: test.storage, fetcher, verifyIdentity: test.verifyIdentity });
    const signingOut = auth.logout();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const authorize = new URL((await auth.start({ newProfile: true }, redirect)).url);
    await auth.callback(callback(authorize, "oaiapp_new"));
    finish(new Response(null, { status: 400 }));
    await signingOut;
    expect(auth.status()).toMatchObject({ connected: true, sharing: true });
    expect(auth.status().warning).toBeUndefined();
  });
});


describe("HypeMan credential storage", () => {
  it("keeps sign-ins isolated to the selected application directory", async () => {
    const account = fixture();
    await account.signIn("oaiapp_personal");
    const before = readFileSync(join(account.storage, "chatgpt-auth.json"), "utf8");
    const separate = fixture();
    expect(separate.auth.status()).toMatchObject({ connected: false, activeProfileId: null });
    expect(readFileSync(join(account.storage, "chatgpt-auth.json"), "utf8")).toBe(before);
    if (process.platform !== "win32") {
      expect(statSync(separate.storage).mode & 0o777).toBe(0o700);
      expect(statSync(join(separate.storage, "chatgpt-auth.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects corrupt stored credentials without overwriting the source file", () => {
    const storage = directory();
    const path = join(storage, "chatgpt-auth.json");
    const invalid = '{"version":1,"profiles":[]}';
    writeFileSync(path, invalid);
    expect(() => new ChatGPTAuth({ directory: storage }))
      .toThrow("ChatGPT credential storage could not be opened");
    expect(readFileSync(path, "utf8")).toBe(invalid);
  });
});
