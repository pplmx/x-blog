<template>
  <div class="flex items-center justify-center gap-4 py-6 my-8 border-y border-gray-200 dark:border-gray-700">
    <span class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
      <Icon icon="lucide:share-2" class="w-4 h-4" />
      {{ t('components.share.shareTo') }}
    </span>

    <!-- Weibo -->
    <button
      type="button"
      @click="shareToWeibo"
      class="p-2 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
      :title="t('components.share.weibo')"
      :aria-label="t('components.share.weibo')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.739 5.443zM9.05 17.219c-.384.616-1.208.884-1.829.602-.612-.279-.793-.991-.406-1.593.379-.595 1.176-.861 1.793-.601.622.263.82.972.442 1.592zm1.27-1.627c-.141.237-.449.353-.689.253-.236-.09-.313-.361-.177-.586.138-.227.436-.346.672-.24.239.09.315.36.194.573zm.176-2.719c-1.893-.493-4.033.45-4.857 2.118-.836 1.704-.026 3.591 1.886 4.21 1.983.64 4.318-.341 5.132-2.179.8-1.793-.201-3.642-2.161-4.149zm7.563-1.224c-.346-.105-.578-.172-.399-.623.389-.985.428-1.833.003-2.441-.801-1.145-3.22-.932-5.822-.206-3.107.868-5.001 2.127-5.32 3.396-.318 1.265.453 2.22 1.991 2.878 1.833.784 4.237.58 5.641-.359 1.053-.703 1.2-1.536.788-2.229-.371-.625-1.27-.973-2.314-1.033-.853-.049-1.564.057-1.615.195-.051.138.33.418 1.103.676-.857.435-1.134.907-1.014 1.438.177.78 1.281 1.239 3.062 1.326 2.196.108 3.961-.624 4.351-1.73.391-1.106-.266-1.684-1.455-2.288z" />
      </svg>
    </button>

    <!-- X / Twitter -->
    <button
      type="button"
      @click="shareToX"
      class="p-2 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      :title="t('components.share.x')"
      :aria-label="t('components.share.x')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    </button>

    <!-- Facebook -->
    <button
      type="button"
      @click="shareToFacebook"
      class="p-2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
      :title="t('components.share.facebook')"
      :aria-label="t('components.share.facebook')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z"/>
      </svg>
    </button>

    <!-- LinkedIn -->
    <button
      type="button"
      @click="shareToLinkedIn"
      class="p-2 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
      :title="t('components.share.linkedin')"
      :aria-label="t('components.share.linkedin')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    </button>

    <!-- Copy Link -->
    <button
      type="button"
      @click="handleCopyLink"
      class="p-2 rounded-full bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      :title="copied ? t('components.share.linkCopied') : (copyFailed ? t('components.share.copyFailed') : t('components.share.copyLink'))"
      :aria-label="copied ? t('components.share.linkCopied') : (copyFailed ? t('components.share.copyFailed') : t('components.share.copyLink'))"
    >
      <Icon
        v-if="copied"
        icon="lucide:check"
        class="w-5 h-5 text-green-600"
      />
      <Icon
        v-else-if="copyFailed"
        icon="lucide:x"
        class="w-5 h-5 text-red-500"
      />
      <Icon
        v-else
        icon="lucide:link-2"
        class="w-5 h-5"
      />
    </button>

    <!-- Live region: screen-reader users hear the clipboard outcome (success
         and failure), not just a silent icon swap. -->
    <span class="sr-only" role="status" aria-live="polite">
      {{
        copied
          ? t('components.share.linkCopied')
          : copyFailed
            ? t('components.share.copyFailed')
            : ''
      }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

interface Props {
	title: string;
	url?: string;
}

const props = defineProps<Props>();

const { t } = useLang();

const copied = ref(false);
const copyFailed = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function flashCopy(ok: boolean) {
	copied.value = ok;
	copyFailed.value = !ok;
	if (copyTimer) clearTimeout(copyTimer);
	copyTimer = setTimeout(() => {
		copied.value = false;
		copyFailed.value = false;
	}, 2000);
}

const currentUrl = computed(
	() => props.url || (typeof window === "undefined" ? "" : window.location.href),
);
const encodedUrl = computed(() => encodeURIComponent(currentUrl.value));
const encodedTitle = computed(() => encodeURIComponent(props.title));

function shareToWeibo() {
	if (typeof window === "undefined") return;
	window.open(
		`https://service.weibo.com/share/share.php?url=${encodedUrl.value}&title=${encodedTitle.value}`,
		"_blank",
		"width=550,height=450",
	);
}

function shareToX() {
	if (typeof window === "undefined") return;
	window.open(
		`https://twitter.com/intent/tweet?url=${encodedUrl.value}&text=${encodedTitle.value}`,
		"_blank",
		"width=600,height=450",
	);
}

function shareToFacebook() {
	if (typeof window === "undefined") return;
	window.open(
		`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl.value}`,
		"_blank",
		"width=600,height=500",
	);
}

function shareToLinkedIn() {
	if (typeof window === "undefined") return;
	window.open(
		`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl.value}`,
		"_blank",
		"width=600,height=500",
	);
}

async function handleCopyLink() {
	try {
		await navigator.clipboard.writeText(currentUrl.value);
		flashCopy(true);
	} catch {
		// No clipboard permission (non-secure context / denied): never fail
		// silently — flip the icon to a red X and announce the outcome.
		flashCopy(false);
	}
}
</script>
