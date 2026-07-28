<!--
  Admin Dashboard Page
  Migrated from Next.js /app/admin/page.tsx to Nuxt 4 / Vue 3.
  Fetches posts, categories, and tags in parallel for an overview dashboard.
-->
<script setup lang="ts">
import type { AdminComment } from "~~/composables/useApi";
import {
	approveAdminComment,
	fetchAdminComments,
	useCategories,
	usePosts,
	useTags,
} from "~~/composables/useApi";

// Fetch all data in parallel
const [postsResponse, categoriesResult, tagsResult, commentsResult] = await Promise.all([
	usePosts({ limit: 1000 }),
	useCategories(),
	useTags(),
	fetchAdminComments(),
]);

const posts = postsResponse.items;
const categories = categoriesResult.data.value;
