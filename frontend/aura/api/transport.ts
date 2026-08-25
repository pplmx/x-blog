import type { AvailableRouterMethod, NitroFetchRequest } from "nitropack/types";
import type { AsyncData, NuxtError, UseFetchOptions } from "nuxt/app";
import type { Ref } from "vue";

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
	return useFetch<unknown>(path, resolvedOptions);
}

export function command<T>(path: string, options?: ApiCommandOptions): Promise<T> {
	return $fetch<T>(path, {
		baseURL: apiBaseUrl(),
		...(options ?? {}),
	} as ApiCommandOptions);
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
