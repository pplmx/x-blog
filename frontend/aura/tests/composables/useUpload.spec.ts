import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));

describe("useUpload", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns initial state with isUploading false and error null", async () => {
		const { useUpload } = await import("~/composables/useUpload");
		const { isUploading, error } = useUpload();
		expect(isUploading.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it("uploads an image and returns the URL on success", async () => {
		const fakeUrl = "/static/uploads/2026/07/abc123.jpg";
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ url: fakeUrl }),
		});
		localStorage.setItem("admin_token", "test-token");

		const { useUpload } = await import("~/composables/useUpload");
		const { uploadImage, isUploading, error } = useUpload();

		const file = new File(["fake"], "test.png", { type: "image/png" });
		const result = await uploadImage(file);

		expect(result).toBe(fakeUrl);
		expect(isUploading.value).toBe(false);
		expect(error.value).toBeNull();

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/upload",
			expect.objectContaining({
				method: "POST",
				headers: { Authorization: "Bearer test-token" },
			}),
		);
	});

	it("sets error on upload failure", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 400,
			json: () => Promise.resolve({ detail: "Unsupported file type" }),
		});
		localStorage.setItem("admin_token", "test-token");

		const { useUpload } = await import("~/composables/useUpload");
		const { uploadImage, isUploading, error } = useUpload();

		const file = new File(["fake"], "test.gif", { type: "image/gif" });
		const result = await uploadImage(file);

		expect(result).toBeNull();
		expect(isUploading.value).toBe(false);
		expect(error.value).toBe("Unsupported file type");
	});

	it("sets error on network failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
		localStorage.setItem("admin_token", "test-token");

		const { useUpload } = await import("~/composables/useUpload");
		const { uploadImage, isUploading, error } = useUpload();

		const file = new File(["fake"], "test.png", { type: "image/png" });
		const result = await uploadImage(file);

		expect(result).toBeNull();
		expect(isUploading.value).toBe(false);
		expect(error.value).toBe("Network error");
	});

	it("sends request without auth header when no token exists", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ url: "/static/uploads/test.jpg" }),
		});

		const { useUpload } = await import("~/composables/useUpload");
		const { uploadImage } = useUpload();

		const file = new File(["fake"], "test.png", { type: "image/png" });
		await uploadImage(file);

		const callHeaders = (globalThis.fetch as any).mock.calls[0][1].headers;
		expect(callHeaders).toEqual({});
	});

	it("keeps isUploading true while any upload is still in flight", async () => {
		// Round-300 deep-dive: `isUploading` was a single shared boolean, so when
		// a second upload started while the first was in flight (paste a fresh
		// image under the uploading overlay), whichever upload finished FIRST
		// cleared the flag — the overlay/spinner vanished while the other upload
		// was still uploading. Track an in-flight counter instead.
		let resolveA: (v: Response) => void = () => {};
		let resolveB: (v: Response) => void = () => {};
		const promiseA = new Promise<Response>((res) => {
			resolveA = res;
		});
		const promiseB = new Promise<Response>((res) => {
			resolveB = res;
		});
		globalThis.fetch = vi
			.fn()
			.mockImplementationOnce(() => promiseA)
			.mockImplementationOnce(() => promiseB);

		const { useUpload } = await import("~/composables/useUpload");
		const { uploadImage, isUploading } = useUpload();

		const a = uploadImage(new File(["a"], "a.png", { type: "image/png" }));
		expect(isUploading.value).toBe(true);
		const b = uploadImage(new File(["b"], "b.png", { type: "image/png" }));
		expect(isUploading.value).toBe(true);

		// The FIRST upload resolves while the second is still pending.
		resolveA({ ok: true, json: () => Promise.resolve({ url: "/a.jpg" }) } as Response);
		await a;
		expect(isUploading.value).toBe(true); // B still uploading
		resolveB({ ok: true, json: () => Promise.resolve({ url: "/b.jpg" }) } as Response);
		await b;
		expect(isUploading.value).toBe(false);
	});

	it("handles json parsing errors with fallback error message", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			json: () => Promise.reject(new Error("Invalid JSON")),
		});
		localStorage.setItem("admin_token", "test-token");

		const { useUpload } = await import("~/composables/useUpload");
		const { uploadImage, error, isUploading } = useUpload();

		const file = new File(["fake"], "test.png", { type: "image/png" });
		const result = await uploadImage(file);

		expect(result).toBeNull();
		expect(isUploading.value).toBe(false);
		// The .catch() fallback returns {}, so error should use the generic message
		expect(error.value).toBe("Upload failed (500)");
	});
});
