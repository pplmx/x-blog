<!--
  Reader login / register (DEC-059, TASK-133).

  A single page toggling between sign-in and sign-up for reader accounts —
  the identity layer for cloud-synced bookmarks. Credentials are sent to
  /api/reader/login | /api/reader/register; the returned reader JWT is stored
  by useReaderAuth (distinct from admin auth).
-->
<script setup lang="ts">
import { ref } from "vue";

import { useBookmarkSync } from "~~/composables/useBookmarkSync";
import { useReaderAuth } from "~~/composables/useReaderAuth";

const readerAuth = useReaderAuth();

const { t } = useLang();

// Getter form: an in-app language switch re-evaluates the title/og tags
// (static object froze them in the initial language — deep-dive, ISS-372).
useSeo(() => ({
	title: t("reader.login.seoTitle"),
	description: t("reader.login.seoDesc"),
	path: "/login",
	// Reader auth flows are private surfaces — never index them (round 437).
	noindex: true,
}));

const { mergeLocalToCloud } = useBookmarkSync();

const mode = ref<"login" | "register">("login");
const email = ref("");
const password = ref("");
const displayName = ref("");
const error = ref<string | null>(null);
const isPending = ref(false);

// Second step of a 2FA login (round 364, DEC-401): after the password proves
// the account, a 2FA-enabled reader is handed a short-lived mfa_token and must
// present a 6-digit authenticator code before any session is stored.
const twoFactorStep = ref(false);
const mfaToken = ref("");
const totpCode = ref("");

/**
 * Turn a failed reader-auth call into a reader-presentable message. The api
 * layer (`command`) rethrows ofetch errors whose `.message` is the technical
 * "[POST] \"…\": 401 …" string — never show that (same rule as the comment
 * form, round-433).
 *
 * The reader-auth composables rethrow failures as a plain Error whose
 * `.message` is apiErrorMessage's output (backend envelope text or a safe
 * fallback) with the HTTP status preserved on `statusCode`. The backend is
 * deliberately anti-oracle: a wrong email/password and a bad authenticator
 * code are BOTH one indistinguishable 401 (reader.py, DEC-401) — so a 401 is
 * the signal to map to the localized credentials line; a duplicate registration
 * is the one 400. Everything else falls back to the backend's human envelope,
 * then any non-technical `.message` (a 429/5xx carries meaning), then a
 * generic network line.
 */
function readerAuthErrorMessage(e: unknown): string {
	const status = (e as { statusCode?: number })?.statusCode ?? (e as { status?: number })?.status;
	if (status === 401) {
		return twoFactorStep.value
			? t("reader.login.errors.twoFactorCode")
			: t("reader.login.errors.invalidCredentials");
	}
	if (mode.value === "register" && status === 400) {
		return t("reader.login.errors.emailRegistered");
	}
	const envelope = (e as { data?: { error?: { message?: string } } })?.data?.error?.message;
	if (typeof envelope === "string" && envelope.length > 0) return envelope;
	// The raw ofetch technical string always starts with "[" ([METHOD] "url": …);
	// a rendered message never does, so only surface it when it is not that.
	const message = (e as { message?: unknown } | undefined)?.message;
	if (typeof message === "string" && message.length > 0 && !message.startsWith("[")) return message;
	return t("reader.login.errors.network");
}

// Mode toggle announced to AT (aria-pressed) and, on switching to register,
// focus moves into the newly revealed display-name field so keyboard/AT users
// aren't left wondering where the extra input appeared.
const displayNameInput = ref<HTMLInputElement | null>(null);
function setMode(next: "login" | "register") {
	if (isPending.value || mode.value === next) return;
	mode.value = next;
	nextTick(() => {
		if (next === "register") displayNameInput.value?.focus();
	});
}

const route = useRoute();
// Sign in once, land where the reader started: /login?redirect=/account keeps a
// guest on the page that prompted their login instead of always dumping them on
// /bookmarks (the old behavior), which was jarring when the login link came from
// /account, /comments, or a push sign-in prompt. Only same-origin relative paths
// are honored (no open-redirect via an absolute URL).
const redirectTarget = computed(() => {
	const r = route.query.redirect;
	if (typeof r !== "string" || !r) return "/bookmarks";
	// Only same-origin relative paths: reject protocol-relative "//x" AND the
	// WHATWG backslash trick ("/\evil.com" is normalized to "//evil.com" →
	// http://evil.com when navigateTo resolves it — reader-auth deep-dive).
	if (r.startsWith("/") && !r.startsWith("//") && !r.includes("\\")) return r;
	return "/bookmarks";
});

async function handleSubmit() {
	// The submit button is disabled while pending, but a redundant submit event
	// (Enter then click, or a double fire before the disabled state paints)
	// would otherwise issue two login/register requests — a duplicate register
	// then fails with a server error the reader can't attribute. Same guard the
	// mode toggle uses (deep-dive finding).
	if (isPending.value) return;
	if (!(email.value && password.value)) return;
	error.value = null;
	isPending.value = true;
	try {
		if (mode.value === "register") {
			await readerAuth.register(email.value, password.value, displayName.value || undefined);
		} else {
			const res = await readerAuth.login(email.value, password.value);
			// 2FA reader: password accepted, but hold at the code step — no
			// navigation, no session yet. The mfa_token powers the second step.
			if (res?.two_factor_required && res.mfa_token) {
				mfaToken.value = res.mfa_token;
				twoFactorStep.value = true;
				return;
			}
		}
		// Once authenticated, push any local bookmarks up and adopt the merged
		// server list so /bookmarks is consistent post-login. (TASK-134)
		await mergeLocalToCloud();
		// Same for liked-post markers (round 359): a reader who liked posts
		// while signed-out (or on an old device) keeps those likes — they're
		// now durable cloud rows visible on /liked.
		const { useLikeSync } = await import("~~/composables/useLikeSync");
		await useLikeSync().mergeLocalToCloud();
		navigateTo(redirectTarget.value, { replace: true });
	} catch (e) {
		error.value = readerAuthErrorMessage(e);
	} finally {
		isPending.value = false;
	}
}

async function handle2faSubmit() {
	if (isPending.value) return;
	if (!mfaToken.value || !totpCode.value) return;
	error.value = null;
	isPending.value = true;
	try {
		await readerAuth.login2FA(mfaToken.value, totpCode.value);
		await mergeLocalToCloud();
		const { useLikeSync } = await import("~~/composables/useLikeSync");
		await useLikeSync().mergeLocalToCloud();
		navigateTo(redirectTarget.value, { replace: true });
	} catch (e) {
		error.value = readerAuthErrorMessage(e);
	} finally {
		isPending.value = false;
	}
}

// Back out of the code step to re-enter the password (a wrong code leaves the
// challenge open server-side for a few minutes, but a fresh password submit
// always issues a fresh challenge token).
function cancel2fa() {
	twoFactorStep.value = false;
	mfaToken.value = "";
	totpCode.value = "";
	error.value = null;
}
</script>

<template>
  <div class="max-w-md mx-auto px-4 py-12">
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-8">
      <div class="text-center mb-8">
        <div
          class="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center mx-auto mb-4"
        >
          <Icon icon="lucide:bookmark" class="w-8 h-8 text-white" />
        </div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {{ twoFactorStep
            ? t("reader.login.twoFactorTitle")
            : mode === "login"
              ? t("reader.login.title")
              : t("reader.login.registerTitle") }}
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {{ twoFactorStep
            ? t("reader.login.twoFactorSubtitle", { email })
            : mode === "login"
              ? t("reader.login.subtitle")
              : t("reader.login.registerSubtitle") }}
        </p>
      </div>

      <!-- Mode toggle (disabled mid-request so an in-flight register/login
           result can't land while the form has already switched modes) -->
      <div
        v-if="!twoFactorStep"
        class="grid grid-cols-2 gap-1 p-1 bg-gray-100 dark:bg-gray-900 rounded-xl mb-6"
      >
        <button
          type="button"
          :disabled="isPending"
          :aria-pressed="mode === 'login'"
          class="py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          :class="mode === 'login'
            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="setMode('login')"
        >
          {{ t("reader.login.hasAccount") }}
        </button>
        <button
          type="button"
          :disabled="isPending"
          :aria-pressed="mode === 'register'"
          class="py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          :class="mode === 'register'
            ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="setMode('register')"
        >
          {{ t("reader.login.noAccount") }}
        </button>
      </div>

      <form v-if="!twoFactorStep" @submit.prevent="handleSubmit" class="space-y-5">
        <div v-if="mode === 'register'">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {{ t("reader.login.displayName") }}
          </label>
          <input
            ref="displayNameInput"
            v-model="displayName"
            type="text"
            autocomplete="name"
            maxlength="50"
            :placeholder="t('reader.login.displayNamePlaceholder')"
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.login.email") }}
          </label>
          <input
            v-model="email"
            type="email"
            autocomplete="email"
            :placeholder="t('reader.login.emailPlaceholder')"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
        </div>

        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.login.password") }}
          </label>
          <input
            v-model="password"
            type="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            :placeholder="t('reader.login.passwordPlaceholder')"
            required
            :minlength="mode === 'register' ? 8 : undefined"
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
          <NuxtLink
            v-if="mode === 'login'"
            to="/forgot-password"
            class="inline-block mt-2 text-xs text-gray-500 hover:text-blue-600 transition-colors"
          >
            {{ t("reader.forgotPassword.link") }}
          </NuxtLink>
        </div>

        <div
          v-if="error"
          role="alert"
          class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
        >
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <button
          type="submit"
          :disabled="isPending || !email || !password"
          class="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          <span v-if="isPending" class="flex items-center justify-center gap-2">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ mode === "login" ? t("reader.login.loggingIn") : t("reader.login.registering") }}
          </span>
          <span v-else>
            {{ mode === "login" ? t("reader.login.login") : t("reader.login.registerAction") }}
          </span>
        </button>
      </form>

      <!-- Second step for a 2FA-enabled reader (round 364, DEC-401): the
           password was accepted; enter the authenticator's 6-digit code. -->
      <form v-else @submit.prevent="handle2faSubmit" class="space-y-5">
        <div>
          <label
            class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >{{ t("reader.login.twoFactorCodeLabel") }}
          </label>
          <input
            v-model="totpCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="8"
            :placeholder="t('reader.login.twoFactorCodePlaceholder')"
            required
            class="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-center tracking-[0.5em] font-mono text-lg"
          >
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {{ t("reader.login.twoFactorHint") }}
          </p>
        </div>

        <div
          v-if="error"
          role="alert"
          class="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
        >
          <p class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
        </div>

        <button
          type="submit"
          :disabled="isPending || !totpCode"
          class="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-500/20"
        >
          <span v-if="isPending" class="flex items-center justify-center gap-2">
            <Icon icon="lucide:loader-2" class="w-4 h-4 animate-spin" />
            {{ t("reader.login.verifying") }}
          </span>
          <span v-else>{{ t("reader.login.verify") }}</span>
        </button>

        <button
          type="button"
          :disabled="isPending"
          class="w-full text-center text-sm text-gray-500 hover:text-blue-600 transition-colors"
          @click="cancel2fa"
        >
          {{ t("reader.login.twoFactorBack") }}
        </button>
      </form>

      <div class="mt-6 pt-6 border-t text-center">
        <NuxtLink
          to="/bookmarks"
          class="text-sm text-gray-500 hover:text-blue-600 transition-colors"
        >
          ← {{ t("reader.login.backToBookmarks") }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
