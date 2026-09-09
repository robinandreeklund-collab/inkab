/**
 * occt-import-js levererar ingen typdeklaration. Här beskrivs bara den del av
 * ytan vi använder: läs en STEP och få tillbaka tessellerade delar.
 */
declare module "occt-import-js" {
  export type OcctMesh = {
    name?: string;
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  };

  export type OcctReadResult = {
    success: boolean;
    meshes?: OcctMesh[];
  };

  export type OcctReadParams = {
    linearUnit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
    linearDeflectionType?: "bounding_box_ratio" | "absolute_value";
    linearDeflection?: number;
    angularDeflection?: number;
  };

  export type OcctInstance = {
    ReadStepFile(buffer: Uint8Array, params: OcctReadParams | null): OcctReadResult;
    ReadBrepFile(buffer: Uint8Array, params: OcctReadParams | null): OcctReadResult;
    ReadIgesFile(buffer: Uint8Array, params: OcctReadParams | null): OcctReadResult;
  };

  /**
   * Emscriptens standardöverskrivningar. Bara locateFile behövs: i
   * webbläsaren måste modulen få veta var .wasm-filen ligger, eftersom den
   * annars letar bredvid det bundlade skriptet.
   */
  export type OcctModuleOverrides = {
    locateFile?: (path: string, prefix: string) => string;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  };

  export default function occtimportjs(
    overrides?: OcctModuleOverrides,
  ): Promise<OcctInstance>;
}
