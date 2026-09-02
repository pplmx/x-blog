import type { AvailableRouterMethod, NitroFetchRequest } from "nitropack/types";
import type { AsyncData, NuxtError, UseFetchOptions } from "nuxt/app";
import { type Ref, unref } from "vue";

import { useAdminAuth } from "~~/composables/useAdminAuth";
import { useRateLimitNotice } from "~~/composables/useRateLimitNotice";

export type ApiQueryPath = Parameters<typeof useFetch>[0];
export type ApiQueryOptions<
	ResT,
	DataT = ResT,
	PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = undefined,
	ReqT extends NitroFetchRequest = string & {},
	Method extends ApiQueryMethod<ReqT> = ApiQueryMethod<ReqT>,
> = UseFetchOptions<ResT, DataT, PickKeys, DefaultT, ReqT, Method>;
export type ApiCommandOptions = Parameters<typeof $fetch>[1];
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

type ApiQueryMethod<ReqT extends NitroFetchRequest> =
	| AvailableRouterMethod<ReqT>
	| Uppercase<AvailableRouterMethod<ReqT>>;
type KeysOf<T> = Array<T extends T ? (keyof T extends string ? keyof T : never) : never>;
type PickFrom<T, K extends Array<string>> =
	T extends Array<unknown>
		? T
		: T extends Record<string, any>
			? keyof T extends K[number]
				? T
				: K[number] extends never
					? T
					: Pick<T, K[number]>
			: T;
type ApiQueryTransformOptions<
	ResT,
	DataT,
	PickKeys extends KeysOf<DataT>,
	DefaultT,
	ReqT extends NitroFetchRequest,
	Method extends ApiQueryMethod<ReqT>,
> = Omit<ApiQueryOptions<ResT, DataT, PickKeys, DefaultT, ReqT, Method>, "transform"> & {
	transform: (input: ResT) => DataT | Promise<DataT>;
};

function apiBaseUrl(): string {
	return useRuntimeConfig().public.apiUrl;
}

export function query<
	ResT = unknown,
	ErrorT = NuxtError<unknown>,
	ReqT extends NitroFetchRequest = NitroFetchRequest,
	const Method extends ApiQueryMethod<ReqT> = ApiQueryMethod<ReqT>,
	DataT = ResT,
	const PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = undefined,
>(
	path: Ref<ReqT> | ReqT | (() => ReqT),
	options: ApiQueryTransformOptions<ResT, DataT, PickKeys, DefaultT, ReqT, Method>,
): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, ErrorT | undefined>;
export function query<
	ResT = unknown,
	ErrorT = NuxtError<unknown>,
	ReqT extends NitroFetchRequest = NitroFetchRequest,
	const Method extends ApiQueryMethod<ReqT> = ApiQueryMethod<ReqT>,
	DataT = ResT,
	const PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = DataT,
>(
	path: Ref<ReqT> | ReqT | (() => ReqT),
	options: ApiQueryTransformOptions<ResT, DataT, PickKeys, DefaultT, ReqT, Method>,
): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, ErrorT | undefined>;
export function query<
	ResT = unknown,
	ErrorT = NuxtError<unknown>,
	ReqT extends NitroFetchRequest = NitroFetchRequest,
	const Method extends ApiQueryMethod<ReqT> = ApiQueryMethod<ReqT>,
	DataT = ResT,
	const PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = undefined,
>(
	path: Ref<ReqT> | ReqT | (() => ReqT),
	options?: ApiQueryOptions<ResT, DataT, PickKeys, DefaultT, ReqT, Method>,
): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, ErrorT | undefined>;
export function query<
	ResT = unknown,
	ErrorT = NuxtError<unknown>,
	ReqT extends NitroFetchRequest = NitroFetchRequest,
	const Method extends ApiQueryMethod<ReqT> = ApiQueryMethod<ReqT>,
	DataT = ResT,
	const PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = DataT,
>(
	path: Ref<ReqT> | ReqT | (() => ReqT),
	options?: ApiQueryOptions<ResT, DataT, PickKeys, DefaultT, ReqT, Method>,
): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, ErrorT | undefined>;
export function query(path: ApiQueryPath, options: object = {}) {
	const resolvedOptions: UseFetchOptions<unknown> = {
		baseURL: apiBaseUrl(),
		...options,
	};
	// Merge a 429 detector + the 401 session-expiry handler in front of any
	// caller-provided handler so every query (useFetch) path surfaces them
	// without breaking local handling.
	const callerOnResponseError = resolvedOptions.onResponseError as
		| ResponseErrorHook
		| ResponseErrorHook[]
		| undefined;
	resolvedOptions.onResponseError = (context) => {
		const c = context as { response: { status?: number } };
		flagRateLimit(c.response);
		flagAdminUnauthorized(c.response, resolveRequestPath(path));
		return runResponseErrorHook(callerOnResponseError, context);
	};
	return useFetch<unknown>(path, resolvedOptions);
}

export function command<T>(path: string, options?: ApiCommandOptions): Promise<T> {
	// 429 detector + admin-401 handler on the promise (not in the options bag):
	// options stay byte-for-byte as the caller wrote them so per-call
	// option-assertion tests and ofetch hook semantics are untouched; on a
	// rate-limit failure we raise the app-wide notice and rethrow the original
	// error for local handling.
	return $fetch<T>(path, {
		baseURL: apiBaseUrl(),
		...(options ?? {}),
	} as ApiCommandOptions).catch((error: unknown) => {
		flagRateLimit(fetcherResponseError(error));
		flagAdminUnauthorized(fetcherResponseError(error), path);
		throw error;
	});
}

/**
 * Surface a friendly app-wide notice when the backend rate-limits a request
 * (HTTP 429). slowapi's body is a technical "Rate limit exceeded: N per
 * minute"; the RateLimitNotice banner renders a localized, actionable message
 * instead of whichever unhelpful text the page happened to show (round 211).
 */
function flagRateLimit(response: { status?: number } | undefined): void {
	if (response?.status === 429) useRateLimitNotice().show();
}

/** Detect a 429 on an ofetch error (FetchError carries `.response`). */
function fetcherResponseError(error: unknown): { status?: number } | undefined {
	const response = (error as { response?: { status?: number } } | undefined)?.response;
	return Array.isArray(response) ? undefined : response;
}

/**
 * Resolve the actually-requested path from a query() argument (string, ref,
 * or getter — the getter form is what reactive listings pass, e.g. the admin
 * posts list path built in api/admin/posts.ts, ISS-275). Used to scope the
 * admin-401 handler to /api/admin/* so a 401 on a reader endpoint (which the
 * reader pages handle by redirecting to /login) never kicks an admin redirect.
 */
function resolveRequestPath(path: ApiQueryPath): string {
	// ApiQueryPath derives from useFetch's request param, whose type widens to
	// NitroFetchRequest (string | Request | string[]) even though every call site
	// here passes a string path — String() keeps the resolved value a string
	// (identity for real paths) so the 401-scope check can safely startsWith it.
	if (typeof path === "string") return path;
	if (typeof path === "function") return String(path() ?? "");
	return String(unref(path) ?? "");
}

/**
 * React to a 401 from an ADMIN endpoint: an expired/revoked admin token makes
 * every admin call 401 — that is not a transient failure. Drop the stale token
 * and hard-redirect to /admin/login instead of letting the page render a
 * misleading generic error (RIL ISS-277, ISS-273). Scoped to /api/admin/* and
 * the login call explicitly excluded: a 401 from POST /api/admin/login means
 * wrong credentials, which the login page already handles in-place.
 */
function flagAdminUnauthorized(response: { status?: number } | undefined, path: string): void {
	if (response?.status !== 401) return;
	if (!path.startsWith("/api/admin/") || path.startsWith("/api/admin/login")) return;
	useAdminAuth().handleAdminUnauthorized();
}

/** An ofetch/useFetch onResponseError hook (single fn or array of fns). */
type ResponseErrorHook = (context: unknown) => void | Promise<void> | undefined;

/** Run an onResponseError hook that may be a function or an array. */
function runResponseErrorHook(
	hook: ResponseErrorHook | ResponseErrorHook[] | undefined,
	context: unknown,
): unknown {
	if (!hook) return undefined;
	if (Array.isArray(hook)) {
		for (const h of hook) h(context);
		return undefined;
	}
	return hook(context);
}

export function withQuery(path: string, params: QueryParams): string {
	const queryParams = new URLSearchParams();

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null || value === "") continue;
		queryParams.set(key, String(value));
	}

	const queryString = queryParams.toString();
	return queryString ? `${path}?${queryString}` : path;
}
