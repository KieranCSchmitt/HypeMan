import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { replaceFileAtomically } from "./atomic-file";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { ChatGPTStatus } from "@core";
import { GatewayError } from "./errors";

export type { ChatGPTStatus } from "@core";
const ISSUER = "https://auth.openai.com";
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const RESOURCE = "https://api.openai.com/v1";
const DYNAMIC_CLIENT = "dynamic_agent_client";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const REQUESTED_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const ATTEMPT_MS = 10 * 60_000;
const identityMessage = "ChatGPT could not verify this sign-in. Continue with ChatGPT again.";
const planMessage = "ChatGPT plan use is not enabled. Continue with ChatGPT to authorize plan sharing.";

interface Identity {
  subject: string;
  email?: string;
}
interface IdentityOptions {
  clientId: string;
  nonce?: string;
}
interface Tokens {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  scopes: string[];
  expiresAt: number;
}
interface Profile {
  id: string;
  label: string;
  clientId: string;
  subject?: string;
  email?: string;
  model?: string;
  tokens?: Tokens;
}
interface StoredState {
  version: 1;
  hostId: string;
  activeProfileId: string | null;
  profiles: Profile[];
}
interface Attempt {
  epoch: number;
  profileId: string;
  clientId: string;
  isNew: boolean;
  redirectUri: string;
  state: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
  processing: boolean;
}
interface AuthOptions {
  directory?: string;
  fetcher?: typeof fetch;
  /** Tests may replace signature verification; production always verifies OpenAI's JWKS. */
  verifyIdentity?: (token: string, options: IdentityOptions) => Promise<Identity>;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 65_536): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const same = (a: string, b: string): boolean => {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
};
const connected = (profile: Profile | undefined): boolean =>
  !!profile?.tokens && (profile.tokens.expiresAt > Date.now() || !!profile.tokens.refreshToken);
const sharing = (profile: Profile | undefined): boolean =>
  connected(profile) && !!profile?.tokens?.scopes.includes(PLAN_SCOPE);
const authError = (status: number, message: string, code = "chatgpt_auth_required") =>
  new GatewayError(status, message, code);

/** Public SIWC client. Only safe account display information leaves this class. */
export class ChatGPTAuth {
  private readonly path: string;
  private readonly fetcher: typeof fetch;
  private readonly verifyIdentity: NonNullable<AuthOptions["verifyIdentity"]>;
  private state: StoredState;
  private attempt: Attempt | null = null;
  private attemptEpoch = 0;
  private sessionEpoch = 0;
  private refresh: { epoch: number; profileId: string; controller: AbortController; result: Promise<string> } | null = null;
  private error: string | undefined;
  private warning: string | undefined;
  private revocationEndpoint: Promise<string> | null = null;

  constructor(options: AuthOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    const directory = options.directory ?? join(homedir(), ".config", "hypeman");
    this.path = join(directory, "chatgpt-auth.json");
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid directory");
      chmodSync(directory, 0o700);
      this.state = this.load(this.path);
      this.save();
    } catch {
      throw authError(503, "ChatGPT credential storage could not be opened. Check the local app directory.", "chatgpt_storage_error");
    }
    const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
      [customFetch]: (url, init) => this.fetcher(url, { ...init, redirect: "error" }),
      timeoutDuration: 10_000,
    });
    this.verifyIdentity = options.verifyIdentity ?? (async (token, expected) => {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: ISSUER,
        audience: expected.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", ...(expected.nonce ? ["nonce"] : [])],
      });
      if (!text(payload.sub, 512) || (expected.nonce && payload.nonce !== expected.nonce))
        throw new Error("Invalid identity");
      return {
        subject: payload.sub,
        ...(text(payload.email, 320) ? { email: payload.email } : {}),
      };
    });
  }

  private load(path = this.path): StoredState {
    if (!existsSync(path))
      return { version: 1, hostId: `urn:uuid:${randomUUID()}`, activeProfileId: null, profiles: [] };
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000) throw new Error("Invalid credential file");
    chmodSync(path, 0o600);
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      !object(value) || value.version !== 1 ||
      !text(value.hostId, 64) || !/^urn:uuid:[\da-f-]{36}$/i.test(value.hostId) ||
      !(value.activeProfileId === null || text(value.activeProfileId, 128)) ||
      !Array.isArray(value.profiles) || value.profiles.length > 100
    ) throw new Error("Invalid credential state");
    const profiles: Profile[] = value.profiles.map((raw) => {
      if (
        !object(raw) || !text(raw.id, 128) || !text(raw.clientId, 512) || raw.clientId === DYNAMIC_CLIENT ||
        !text(raw.label, 512) || (raw.subject !== undefined && !text(raw.subject, 512)) ||
        (raw.email !== undefined && !text(raw.email, 320)) ||
        (raw.model !== undefined && !text(raw.model, 128))
      ) throw new Error("Invalid registration");
      let tokens: Tokens | undefined;
      if (raw.tokens !== undefined) {
        const t = raw.tokens;
        if (
          !object(t) || !text(t.accessToken) || !text(t.idToken) || !text(raw.subject, 512) ||
          (t.refreshToken !== undefined && !text(t.refreshToken)) ||
          !Array.isArray(t.scopes) || t.scopes.length > 100 || !t.scopes.every((scope) => text(scope, 256)) ||
          typeof t.expiresAt !== "number" || !Number.isFinite(t.expiresAt) || t.expiresAt <= 0
        ) throw new Error("Invalid session");
        tokens = { accessToken: t.accessToken, idToken: t.idToken, scopes: t.scopes as string[], expiresAt: t.expiresAt,
          ...(t.refreshToken ? { refreshToken: t.refreshToken as string } : {}) };
      }
      return {
        id: raw.id, clientId: raw.clientId, label: raw.label,
        ...(raw.subject ? { subject: raw.subject as string } : {}),
        ...(raw.email ? { email: raw.email as string } : {}),
        ...(raw.model ? { model: raw.model as string } : {}),
        ...(tokens ? { tokens } : {}),
      };
    });
    if (new Set(profiles.map((p) => p.id)).size !== profiles.length ||
        new Set(profiles.map((p) => p.clientId)).size !== profiles.length ||
        (value.activeProfileId !== null && !profiles.some((p) => p.id === value.activeProfileId)))
      throw new Error("Invalid registration mapping");
    return { version: 1, hostId: value.hostId, activeProfileId: value.activeProfileId, profiles };
  }

  private save(): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeFileSync(descriptor, `${JSON.stringify(this.state)}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      replaceFileAtomically(temporary, this.path);
      chmodSync(this.path, 0o600);
    } catch {
      throw authError(503, "ChatGPT credentials could not be saved. Check the local app directory.", "chatgpt_storage_error");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* Already renamed or never created. */ }
    }
  }

  private get active(): Profile | undefined {
    return this.state.profiles.find((profile) => profile.id === this.state.activeProfileId);
  }
  get sharing(): boolean { return sharing(this.active); }
  get model(): string | undefined { return this.active?.model; }
  setModel(model: string): void {
    if (!this.active) throw authError(401, "Choose a ChatGPT account first.");
    if (!text(model, 128)) throw authError(400, "Choose a valid ChatGPT model.", "chatgpt_invalid_model");
    if (this.active.model === model) return;
    this.active.model = model;
    this.save();
  }
  status(): ChatGPTStatus {
    if (this.attempt && !this.attempt.processing && this.attempt.expiresAt <= Date.now()) {
      this.cancel();
      this.error = "ChatGPT sign-in expired. Continue with ChatGPT again.";
    }
    return {
      connected: connected(this.active), sharing: this.sharing,
      activeProfileId: this.state.activeProfileId,
      profiles: this.state.profiles.map((profile) => ({
        id: profile.id, label: profile.label, ...(profile.email ? { email: profile.email } : {}),
        connected: connected(profile), sharing: sharing(profile),
      })),
      pending: !!this.attempt,
      ...(this.error ? { error: this.error } : {}),
      ...(this.warning ? { warning: this.warning } : {}),
      ...(this.model ? { model: this.model } : {}),
    };
  }

  async start(input: { profileId?: string; newProfile?: boolean }, redirectUri: string): Promise<{ url: string }> {
    let callback: URL;
    try { callback = new URL(redirectUri); } catch { throw authError(400, "Use a loopback ChatGPT callback."); }
    if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || callback.username ||
        callback.password || callback.search || callback.hash || !callback.port || callback.pathname !== "/auth/callback")
      throw authError(400, "ChatGPT sign-in needs an HTTP callback at 127.0.0.1/auth/callback.");
    if (input.newProfile && input.profileId)
      throw authError(400, "Choose a saved ChatGPT account or add a new account.");
    const profileId = input.newProfile ? undefined : (input.profileId ?? this.state.activeProfileId ?? undefined);
    const profile = profileId ? this.state.profiles.find((entry) => entry.id === profileId) : undefined;
    if (profileId && !profile) throw authError(404, "That saved ChatGPT account is unavailable.");
    if (!profile && this.state.profiles.length >= 100)
      throw authError(400, "The saved ChatGPT account limit has been reached.");
    this.cancel();
    this.error = undefined;
    this.warning = undefined;
    const attempt: Attempt = {
      epoch: this.attemptEpoch, profileId: profile?.id ?? randomUUID(),
      clientId: profile?.clientId ?? DYNAMIC_CLIENT, isNew: !profile,
      redirectUri: callback.href, state: randomBytes(32).toString("base64url"),
      nonce: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url"),
      expiresAt: Date.now() + ATTEMPT_MS, processing: false,
    };
    this.attempt = attempt;
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: attempt.clientId, ext_agent_host_id: this.state.hostId,
      response_type: "code", redirect_uri: attempt.redirectUri, scope: REQUESTED_SCOPES,
      resource: RESOURCE, state: attempt.state, nonce: attempt.nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(attempt.verifier).digest("base64url"),
      ...(attempt.isNew ? { agent_name_hint: "HypeMan" } : {}),
      ...(profile?.email ? { login_hint: profile.email } : {}),
      ...(connected(profile) && !sharing(profile) ? { prompt: "consent" } : {}),
    }).toString();
    return { url: url.href };
  }

  cancel(): void {
    this.attemptEpoch++;
    this.attempt = null;
  }

  private checkAttempt(attempt: Attempt): void {
    if (attempt.epoch !== this.attemptEpoch || this.attempt !== attempt || attempt.expiresAt <= Date.now())
      throw authError(400, "ChatGPT sign-in expired or was cancelled. Continue with ChatGPT again.", "chatgpt_sign_in_expired");
  }

  async callback(url: URL): Promise<void> {
    const attempt = this.attempt;
    if (!attempt || attempt.processing)
      throw authError(400, "No ChatGPT sign-in is waiting for this callback.", "chatgpt_invalid_callback");
    try {
      this.checkAttempt(attempt);
      const expected = new URL(attempt.redirectUri);
      if (url.origin !== expected.origin || url.pathname !== expected.pathname ||
          url.searchParams.getAll("state").length !== 1 || !same(url.searchParams.get("state") ?? "", attempt.state))
        throw authError(400, "ChatGPT sign-in could not be matched to this request. Continue with ChatGPT again.", "chatgpt_invalid_state");
      // A valid matching callback consumes the state before exchanging any code.
      attempt.processing = true;
      if (url.searchParams.has("error"))
        throw authError(403, "ChatGPT sign-in was not authorized. Continue with ChatGPT when ready.", "chatgpt_access_denied");
      const code = url.searchParams.get("code"), issued = url.searchParams.get("client_id");
      if (!text(code, 8192) || url.searchParams.getAll("code").length !== 1 ||
          url.searchParams.getAll("client_id").length > 1)
        throw authError(400, "ChatGPT registration is incomplete. Continue with ChatGPT again.", "chatgpt_invalid_callback");
      let profile = this.state.profiles.find((entry) => entry.id === attempt.profileId);
      if (attempt.isNew) {
        if (!text(issued, 512) || issued === DYNAMIC_CLIENT || this.state.profiles.some((entry) => entry.clientId === issued))
          throw authError(400, "ChatGPT registration is incomplete. Continue with ChatGPT again.", "chatgpt_invalid_callback");
        profile = { id: attempt.profileId, clientId: issued, label: `ChatGPT account ${this.state.profiles.length + 1}` };
        this.state.profiles.push(profile);
        // Keep the issued registration even when the one-time code exchange fails.
        this.save();
      } else if (!profile || (issued !== null && issued !== attempt.clientId)) {
        throw authError(400, "ChatGPT returned a different registration. Choose the saved account and try again.", "chatgpt_registration_mismatch");
      }
      const response = await this.tokenRequest({
        grant_type: "authorization_code", client_id: profile!.clientId, code,
        code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE,
      });
      this.checkAttempt(attempt);
      const tokens = this.parseTokens(response);
      const identity = await this.verifyIdentity(tokens.idToken, { clientId: profile!.clientId, nonce: attempt.nonce });
      this.checkAttempt(attempt);
      if (!text(identity.subject, 512) || (profile!.subject && profile!.subject !== identity.subject))
        throw authError(403, "ChatGPT signed in a different account. Reconnect the selected saved account.", "chatgpt_identity_mismatch");
      profile!.subject = identity.subject;
      if (text(identity.email, 320)) profile!.email = identity.email;
      profile!.tokens = tokens;
      this.invalidateSession();
      this.state.activeProfileId = profile!.id;
      this.save();
      this.error = sharing(profile) ? undefined : planMessage;
    } catch (error) {
      const safe = error instanceof GatewayError ? error : authError(403, identityMessage, "chatgpt_identity_invalid");
      if (attempt.epoch === this.attemptEpoch) this.error = safe.message;
      throw safe;
    } finally {
      if (this.attempt === attempt) this.attempt = null;
    }
  }

  private invalidateSession(): void {
    this.sessionEpoch++;
    this.refresh?.controller.abort();
    this.refresh = null;
  }
  async select(profileId: string): Promise<void> {
    if (!this.state.profiles.some((profile) => profile.id === profileId))
      throw authError(404, "That saved ChatGPT account is unavailable.");
    this.cancel();
    this.invalidateSession();
    this.state.activeProfileId = profileId;
    this.error = this.active?.tokens && !this.sharing ? planMessage : undefined;
    this.warning = undefined;
    this.save();
  }

  private async tokenRequest(form: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(TOKEN, {
        method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      });
    } catch {
      throw authError(503, "ChatGPT could not be reached. Try again when the connection is available.", "chatgpt_auth_unavailable");
    }
    let data: unknown;
    try { data = await response.json(); } catch { /* Never surface provider responses or HTML. */ }
    if (!response.ok) {
      const code = object(data) && typeof data.error === "string" ? data.error :
        object(data) && object(data.error) && typeof data.error.code === "string" ? data.error.code : "";
      if (code === "invalid_client")
        throw authError(503, "ChatGPT could not recognize this app registration. Check the local client configuration before reconnecting.", "chatgpt_client_configuration");
      const terminal = [
        "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
        "refresh_token_invalidated", "refresh_token_reused",
      ].includes(code);
      throw authError(terminal ? 401 : 503,
        terminal ? "ChatGPT authorization expired. Continue with ChatGPT again." : "ChatGPT authorization is temporarily unavailable. Try again.",
        terminal ? "chatgpt_session_expired" : "chatgpt_auth_unavailable");
    }
    if (!object(data)) throw authError(502, "ChatGPT returned an incomplete authorization. Continue with ChatGPT again.", "chatgpt_invalid_token_response");
    return data;
  }

  private parseTokens(data: Record<string, unknown>, previous?: Tokens): Tokens {
    const idToken = data.id_token ?? previous?.idToken;
    const refreshToken = data.refresh_token ?? previous?.refreshToken;
    if (!text(data.access_token) || !text(idToken) ||
        (refreshToken !== undefined && !text(refreshToken)) ||
        typeof data.token_type !== "string" || data.token_type.toLowerCase() !== "bearer" ||
        typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
        (data.scope !== undefined && typeof data.scope !== "string"))
      throw authError(502, "ChatGPT returned an incomplete authorization. Continue with ChatGPT again.", "chatgpt_invalid_token_response");
    const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? [];
    if (scopes.length > 100 || !scopes.every((scope) => text(scope, 256)))
      throw authError(502, "ChatGPT returned invalid permissions. Continue with ChatGPT again.", "chatgpt_invalid_token_response");
    return {
      accessToken: data.access_token, idToken, ...(refreshToken ? { refreshToken } : {}),
      scopes, expiresAt: Date.now() + Math.min(data.expires_in, 365 * 24 * 60 * 60) * 1000,
    };
  }

  async accessToken(): Promise<string> {
    const profile = this.active;
    if (!profile?.tokens) throw authError(401, "Continue with ChatGPT to connect the selected account.");
    const tokens = profile.tokens;
    if (!tokens.scopes.includes(PLAN_SCOPE)) throw authError(403, planMessage, "chatgpt_plan_sharing_required");
    if (tokens.expiresAt > Date.now() + 60_000 || (!tokens.refreshToken && tokens.expiresAt > Date.now()))
      return tokens.accessToken;
    if (!tokens.refreshToken) {
      delete profile.tokens;
      this.error = "ChatGPT authorization expired. Continue with ChatGPT again.";
      this.save();
      throw authError(401, this.error);
    }
    if (this.refresh?.epoch === this.sessionEpoch && this.refresh.profileId === profile.id)
      return this.refresh.result;
    const epoch = this.sessionEpoch, controller = new AbortController();
    const selected = () => epoch === this.sessionEpoch && this.active === profile;
    const current = () => selected() && profile.tokens === tokens;
    const result = (async () => {
      try {
        const response = await this.tokenRequest({
          grant_type: "refresh_token", client_id: profile.clientId,
          refresh_token: tokens.refreshToken!, resource: RESOURCE,
        }, controller.signal);
        if (!current()) throw authError(409, "The selected ChatGPT account changed. Try again.", "chatgpt_account_changed");
        const replacement = this.parseTokens(response, tokens);
        if (response.id_token !== undefined) {
          const identity = await this.verifyIdentity(replacement.idToken, { clientId: profile.clientId });
          if (!text(identity.subject, 512) || identity.subject !== profile.subject)
            throw authError(401, "ChatGPT returned a different account. Continue with ChatGPT again.", "chatgpt_session_expired");
        }
        if (!current()) throw authError(409, "The selected ChatGPT account changed. Try again.", "chatgpt_account_changed");
        profile.tokens = replacement;
        this.error = sharing(profile) ? undefined : planMessage;
        this.save();
        if (!sharing(profile)) throw authError(403, planMessage, "chatgpt_plan_sharing_required");
        return replacement.accessToken;
      } catch (error) {
        if (!selected()) throw authError(409, "The selected ChatGPT account changed. Try again.", "chatgpt_account_changed");
        const safe = error instanceof GatewayError ? error : authError(401, identityMessage, "chatgpt_session_expired");
        this.error = safe.message;
        if (safe.code === "chatgpt_session_expired") {
          delete profile.tokens;
          this.save();
        }
        throw safe;
      } finally {
        if (this.refresh?.epoch === epoch && this.refresh.profileId === profile.id) this.refresh = null;
      }
    })();
    this.refresh = { epoch, profileId: profile.id, controller, result };
    return result;
  }

  private endpoint(): Promise<string> {
    if (this.revocationEndpoint) return this.revocationEndpoint;
    this.revocationEndpoint = (async () => {
      const response = await this.fetcher(`${ISSUER}/.well-known/openid-configuration`, {
        redirect: "error", signal: AbortSignal.timeout(5000),
      });
      const data: unknown = await response.json();
      if (!response.ok || !object(data) || data.issuer !== ISSUER || !text(data.revocation_endpoint, 1024))
        throw new Error("Invalid discovery");
      const endpoint = new URL(data.revocation_endpoint);
      if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw new Error("Invalid revocation endpoint");
      return endpoint.href;
    })().catch((error) => { this.revocationEndpoint = null; throw error; });
    return this.revocationEndpoint;
  }

  async logout(): Promise<void> {
    const profile = this.active, renewable = profile?.tokens?.refreshToken;
    this.cancel();
    this.invalidateSession();
    const epoch = this.sessionEpoch;
    if (profile) delete profile.tokens;
    this.state.activeProfileId = null;
    this.error = undefined;
    this.warning = undefined;
    this.save();
    if (!profile || !renewable) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetcher(await this.endpoint(), {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: renewable, token_type_hint: "refresh_token", client_id: profile.clientId }),
        });
        if (response.status === 200) return;
        if (response.status < 500) break;
      } catch { /* Retry while the captured refresh token is available. */ }
      if (attempt < 2) await new Promise<void>((resolve) => setTimeout(resolve, 150 * 3 ** attempt));
    }
    if (epoch === this.sessionEpoch && this.state.activeProfileId === null)
      this.warning = "Signed out locally. Remote sign-out could not be confirmed. Disconnect HypeMan in ChatGPT Settings.";
  }
}
