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
