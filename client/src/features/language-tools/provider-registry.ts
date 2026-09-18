import type { LanguageProvider } from "./types";

const providerLoaders: Record<string, () => Promise<LanguageProvider>> = {
  harper: async () => (await import("./providers/harper-provider")).harperProvider,
};

export async function getLanguageProvider(id: string | null | undefined) {
  if (!id) return null;
  const loader = providerLoaders[id];
  return loader ? loader() : null;
}

export async function getLanguageProviderMetadata() {
  const entries = await Promise.all(
    Object.entries(providerLoaders).map(async ([id, loader]) => {
      const provider = await loader();
      return { id, name: provider.name, capabilities: provider.capabilities };
    }),
  );
  return entries;
}
