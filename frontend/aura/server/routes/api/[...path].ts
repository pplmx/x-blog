const BACKEND_URL = process.env.NUXT_API_URL || "http://localhost:18888";

export default defineEventHandler(async (event) => {
	const path = getRouterParam(event, "path") || "";
	const method = getMethod(event).toLowerCase();
	const url = `${BACKEND_URL}/api/${path}`;

	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(getHeaders(event))) {
		if (["host", "connection", "content-length"].includes(key)) continue;
		headers[key] = value as string;
	}

	const body = method === "get" || method === "head" ? undefined : await readBody(event);

	try {
		const response = await $fetch.raw(url, {
			method: method as any,
			headers,
			body,
		});

		setResponseStatus(event, response.status);
		for (const [key, value] of Object.entries(response.headers)) {
			if (["content-encoding", "transfer-encoding", "connection"].includes(key)) continue;
			setResponseHeader(event, key, value);
		}

		return response._data;
	} catch (err: any) {
		if (err.response) {
			setResponseStatus(event, err.response.status);
			return err.response._data;
		}
		throw createError({ statusCode: 502, message: "Backend unavailable" });
	}
});
