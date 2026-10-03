// The official Khronos validator ships no types; this covers the part the export test uses.
declare module "gltf-validator" {
  export interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: { code: string; message: string; severity: number; pointer?: string }[] };
  }
  export function validateBytes(data: Uint8Array, options?: object): Promise<ValidationReport>;
}
