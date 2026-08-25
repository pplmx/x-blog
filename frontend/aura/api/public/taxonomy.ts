import type { Category, Tag } from "../contracts/shared";
import { command, query } from "../transport";

export function useCategories() {
	return query<Category[]>("/api/categories");
}

export function getCategories(): Promise<Category[]> {
	return command<Category[]>("/api/categories");
}

export function useTags() {
	return query<Tag[]>("/api/tags");
}
