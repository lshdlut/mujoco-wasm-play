export interface ForgeModule {
  [key: string]: any;
}

export function installForgeAbiCompat(mod: ForgeModule | null | undefined): void;

declare const _default: typeof installForgeAbiCompat;
export default _default;
