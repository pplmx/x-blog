/**
 * Shared test helpers for admin page tests.
 *
 * Provides a reusable mount helper that stubs Nuxt composables
 * (useFetch, useRuntimeConfig, navigateTo, etc.) and the Icon
 * component, so admin page tests can focus on page behavior.
 *
 * Pages that use `await useFetch(...)` in <script setup> require a
 * <Suspense> wrapper (same pattern as page tests).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ref, type Ref } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';

export interface FetchMockState {
  data: Ref<any>;
  pending: Ref<boolean>;
  error: Ref<any>;
  refresh: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock useFetch result object.
 */
export function mockFetchResult(
  data: any = null,
  options: { pending?: boolean; error?: any } = {},
): FetchMockState {
  return {
    data: ref(data),
    pending: ref(options.pending ?? false),
    error: ref(options.error ?? null),
    refresh: vi.fn(),
  };
}

/**
 * Stub global Nuxt composables for admin page tests.
 * Pass a map of URL patterns to mock data or custom handlers.
 */
export function stubNuxtGlobals(
  runtimeConfig: Record<string, any> = { public: { apiUrl: 'http://localhost:18888' } },
) {
  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);
  vi.stubGlobal('useHead', vi.fn());
  vi.stubGlobal('useRoute', () => ({ params: {}, query: {} }));
  vi.stubGlobal('navigateTo', vi.fn());
  vi.stubGlobal('ref', ref);
}

/**
 * Create a NuxtLink stub that renders an <a> tag.
 */
export const NuxtLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot/></a>',
};

/**
 * Create an Icon stub that renders an SVG with data-icon attribute.
 */
export const IconStub = {
  props: ['icon', 'width', 'height', 'class'],
  template: '<svg class="iconstub" :data-icon="icon" :data-width="width" :data-height="height" />',
};

/**
 * Wrap a page component in a <Suspense> boundary for async setup.
 * Returns the mounted wrapper.
 */
export async function mountWithSuspense(
  PageComponent: any,
  stubs: Record<string, any> = {},
): Promise<VueWrapper> {
  const SuspenseWrapper: any = {
    components: { PageComponent },
    template:
      '<Suspense>' +
      '<template #default><PageComponent /></template>' +
      '<template #fallback>Loading...</template>' +
      '</Suspense>',
  };

  const wrapper = mount(SuspenseWrapper, {
    global: {
      stubs: {
        NuxtLink: NuxtLinkStub,
        Icon: IconStub,
        ...stubs,
      },
    },
  });

  // Wait for async setup + Suspense to resolve
  await flushPromises();
  return wrapper;
}
