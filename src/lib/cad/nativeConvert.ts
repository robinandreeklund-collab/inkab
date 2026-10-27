import { WebIO } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * STEP → GLB med OpenCascade nativt.
 *
 * WASM-läsaren (stepConvert) har ett tak på 2 GB som sitter i bygget, och
 * mätningarna i stepSurvey visar att det räcker till omkring 30 000 delar.
 * En sammanställning med fler än så går inte att läsa där, hur man än
 * skruvar på tolerans och heap — minnet går åt till delarna.
 *
 * Samma OpenCascade finns som riktiga binärer i Python-paketet cadquery-ocp,
 * byggt för Windows, macOS och Linux. Där finns inget 2 GB-tak, och glTF
 * skrivs av OCCT:s egen RWGltf_CafWriter i stället för att varje koordinat
 * ska skickas en i taget över gränsen mellan C++ och JavaScript, vilket är
 * det som gör WASM-vägen långsam.
 *
 * Resultatet är samma geometri: provat på cax-if-filen as1-oc-214 ger båda
 * vägarna fotavtrycket 200 × 150 × 84 mm och 4 900 trianglar.
 *
 * Den här modulen importeras bara av skripten, aldrig av appen — den rör
 * barnprocesser och filsystemet.
 */

/** Vad som ska installeras när det saknas. */
export const NATIVE_SETUP = "pip install cadquery-ocp";

/** Python-kandidater att leta efter, i tur och ordning. */
const CANDIDATES: { command: string; args: string[] }[] = [
  { command: "python3", args: [] },
  { command: "python", args: [] },
  // Windows startar Python genom sin launcher.
  { command: "py", args: ["-3"] },
];

export type NativeTool = { command: string; args: string[] };

function run(
  command: string,
  args: string[],
  onLine?: (line: string) => void,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let rest = "";
    const take = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      output += text;
      if (!onLine) return;
      rest += text;
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", () => resolve({ code: -1, output }));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

/**
 * Letar upp en Python som har OCP installerat.
 *
 * `extra` är sökvägen kunden pekat ut själv och provas först, så att en
 * virtuell miljö eller en Python som inte ligger i PATH går att använda.
 */
export async function findNativeConverter(
  extra?: string,
): Promise<NativeTool | null> {
  const candidates = extra
    ? [{ command: extra, args: [] }, ...CANDIDATES]
    : CANDIDATES;
  for (const candidate of candidates) {
    const probe = await run(candidate.command, [
      ...candidate.args,
      "-c",
      "import OCP.STEPCAFControl, OCP.RWGltf; print('ok')",
    ]);
    if (probe.code === 0 && probe.output.includes("ok")) return candidate;
  }
  return null;
}

/**
 * Konverteringen, som Python.
 *
 * Ligger som text här så att skriptet är en fil att skicka vidare. Den
 * skrivs till en tillfällig katalog när den ska köras.
 *
 * Tesselleringen måste göras innan glTF skrivs — RWGltf_CafWriter skriver
 * det som redan finns och tessellerar ingenting själv.
 */
const PYTHON = String.raw`
import sys, time
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.XCAFApp import XCAFApp_Application
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem
from OCP.Message import Message_ProgressRange
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_ShapeEnum
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.collections import (
    Sequence_TDF_Label,
    IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString as FileInfo,
)

src, out = sys.argv[1], sys.argv[2]
tol, angular, min_part = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
started = time.time()


def say(what):
    print("%s|%.1f" % (what, time.time() - started), flush=True)


app = XCAFApp_Application.GetApplication_s()
doc = TDocStd_Document(TCollection_ExtendedString("doc"))
app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)

reader = STEPCAFControl_Reader()
reader.SetColorMode(True)
reader.SetNameMode(True)
if not reader.ReadFile(src):
    print("FEL|Filen gick inte att lasa som STEP.", flush=True)
    sys.exit(2)
say("last")
if not reader.Transfer(doc):
    print("FEL|Filen innehaller ingen geometri att overfora.", flush=True)
    sys.exit(2)
say("overford")

tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
roots = Sequence_TDF_Label()
tool.GetFreeShapes(roots)

# Tessellera solid for solid i stallet for hela trädet pa en gang. Da gar
# det att hoppa over smadelarna — skruv, lager, kablage — och en solid utan
# triangulering skrivs inte ut av glTF-skrivaren. Samma sallning som
# WASM-vagen gor, fast innan arbetet laggs ner i stallet for efterat.
kept = 0
skipped = 0
for i in range(1, roots.Length() + 1):
    explorer = TopExp_Explorer(tool.GetShape_s(roots.Value(i)), TopAbs_ShapeEnum.TopAbs_SOLID)
    while explorer.More():
        solid = explorer.Current()
        if min_part > 0:
            box = Bnd_Box()
            BRepBndLib.Add_s(solid, box, False)
            if box.IsVoid():
                biggest = 0.0
            else:
                lo, hi = box.CornerMin(), box.CornerMax()
                biggest = max(hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z())
            if biggest < min_part:
                skipped += 1
                explorer.Next()
                continue
        BRepMesh_IncrementalMesh(solid, tol, False, angular, True).Perform()
        kept += 1
        if (kept + skipped) % 2000 == 0:
            print("delar|%d av %d" % (kept, kept + skipped), flush=True)
        explorer.Next()

print("behallna|%d" % kept, flush=True)
print("overhoppade|%d" % skipped, flush=True)
if kept == 0:
    print("FEL|Alla delar var mindre an gransen for smadelar. Sank den.", flush=True)
    sys.exit(2)
say("tesselerad")

writer = RWGltf_CafWriter(TCollection_AsciiString(out), True)
# STEP raknar i millimeter och har Z uppat; glTF raknar i meter och har Y.
converter = writer.ChangeCoordinateSystemConverter()
converter.SetInputLengthUnit(0.001)
converter.SetOutputLengthUnit(1.0)
converter.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
converter.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Yup)
if not writer.Perform(doc, FileInfo(), Message_ProgressRange()):
    print("FEL|glTF gick inte att skriva.", flush=True)
    sys.exit(2)
say("skriven")
`;

export type NativeResult = {
  glb: Uint8Array;
  /** Delar som tesselerades och skrevs ut. */
  kept: number;
  /** Delar som var mindre än gränsen och hoppades över. */
  skipped: number;
};

/**
 * Kör den nativa konverteringen. Stegen rapporteras medan den går — en tung
 * fil tar minuter, och tystnad under tiden är inte att veta att det går bra.
 */
export async function convertStepNative(
  tool: NativeTool,
  stepFile: string,
  options: {
    toleranceMm?: number;
    angular?: number;
    /** Delar vars låda är mindre än detta tesselleras inte och skrivs inte ut. */
    minPartMm?: number;
    onStage?: (stage: string) => void;
  } = {},
): Promise<NativeResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "inkab-nativ-"));
  const script = path.join(dir, "step_till_glb.py");
  const out = path.join(dir, "ut.glb");
  await writeFile(script, PYTHON, "utf-8");

  let kept = 0;
  let skipped = 0;
  let failure: string | null = null;
  const result = await run(
    tool.command,
    [
      ...tool.args,
      script,
      path.resolve(stepFile),
      out,
      String(options.toleranceMm ?? 2),
      String(options.angular ?? 0.5),
      String(options.minPartMm ?? 0),
    ],
    (line) => {
      const [key, value] = line.split("|");
      if (key === "FEL") failure = value;
      else if (key === "behallna") kept = Number(value);
      else if (key === "overhoppade") skipped = Number(value);
      else if (key === "delar") options.onStage?.(`tessellerar ${value}`);
      else if (value !== undefined) options.onStage?.(`${key} ${value} s`);
    },
  );

  if (failure) throw new Error(failure);
  if (result.code !== 0) {
    // Python-felet är det som säger något; de sista raderna räcker.
    const tail = result.output
      .trim()
      .split("\n")
      .slice(-4)
      .join("\n             ");
    throw new Error(
      `Den nativa konverteringen misslyckades.\n             ${tail}`,
    );
  }

  return { glb: new Uint8Array(await readFile(out)), kept, skipped };
}

/**
 * Samma efterbehandling som WASM-vägen gör på sin GLB.
 *
 * OCCT:s glTF-skrivare lämnar geometrin som den är: okomprimerad, odeduplicerad
 * och i full flyttalsupplösning. Utan det här blir en nativ GLB mångdubbelt
 * större än en konverterad för samma maskin, och den skillnaden betalar
 * 3D-vyn hos kunden. Stegen är desamma som i stepConvert, så det spelar
 * ingen roll vilken väg en modell kom in.
 */
export async function optimiseGlb(bytes: Uint8Array): Promise<Uint8Array> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;

  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });

  const doc = await io.readBinary(bytes);
  await doc.transform(
    dedup(),
    weld(),
    prune(),
    quantize({ quantizePosition: 14, quantizeNormal: 10 }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
    });

  return io.writeBinary(doc);
}
