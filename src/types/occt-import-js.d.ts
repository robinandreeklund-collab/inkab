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

  export default function occtimportjs(): Promise<OcctInstance>;
}
