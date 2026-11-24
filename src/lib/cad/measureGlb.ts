import { getBounds, WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

/**
 * Mäter upp en färdig GLB.
 *
 * Vägen in för maskiner som STEP-läsaren inte rår på. OpenCascade körs som
 * WebAssembly och har ett tak på 2 GB (se READER_MEMORY_CEILING_MB i
 * stepConvert); en sammanställning med tiotusentals delar går över det, och
 * taket sitter i bygget — det går inte att höja genom att köra någon
 * annanstans. Då konverteras filen i ett program som kör OpenCascade nativt,
 * och verktyget tar vid här: modellen rörs inte, den mäts bara.
 *
 * glTF är Y-upp och meter. Lådans x blir längd, z blir bredd och y blir
 * höjd — exakt samma avbildning som convertStep gör när den skriver sin GLB,
 * så en mätt och en konverterad fil ger samma mått på samma maskin. Mätt på
 * rullbana.glb ur repot ger det 3000 × 1568 × 600 mm, mot bibliotekets
 * 3000 × 1567 × 600.
 *
 * Origo spelar ingen roll: 3D-vyn ställer modellen i sitt eget hörn när den
 * ritas, så en fil som ligger var som helst i rymden hamnar ändå rätt.
 */

export type GlbMeasurement = {
  /** Måtten före riktningen, som convertStep rapporterar dem. */
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
  warnings: string[];
  stats: { glbBytes: number; trianglesIn: number; meshes: number };
};

export async function measureGlb(bytes: Uint8Array): Promise<GlbMeasurement> {
  await MeshoptDecoder.ready;
  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });

  const doc = await io.readBinary(bytes);
  const scene = doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("GLB:n innehåller ingen scen.");

  const box = getBounds(scene);
  const mm = (i: number) => Math.round((box.max[i] - box.min[i]) * 1000);
  const sizeMm = [mm(0), mm(2), mm(1)];
  if (sizeMm.some((v) => !Number.isFinite(v) || v <= 0)) {
    throw new Error("GLB:n har ingen geometri att mäta.");
  }

  /*
   * Trianglar räknade per instans, inte per unik mesh.
   *
   * Avdubbleringen slår ihop likadan geometri: 87 000 identiska kuber blir
   * en mesh om tolv trianglar som används 87 000 gånger. Räknat på mesharna
   * blev svaret "12 trianglar" om en modell som i själva verket ritar över
   * en miljon — och det är instanserna GPU:n betalar för, inte de unika.
   */
  let triangles = 0;
  const perMesh = new Map<unknown, number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    let count = 0;
    for (const primitive of mesh.listPrimitives()) {
      const n =
        primitive.getIndices()?.getCount() ??
        primitive.getAttribute("POSITION")?.getCount() ??
        0;
      count += n / 3;
    }
    perMesh.set(mesh, count);
  }
  let instances = 0;
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      triangles += perMesh.get(mesh) ?? 0;
      instances += 1;
    });
  }

  /* ── Rimlighetskontroll ──────────────────────────────────────────────── */
  const m = (v: number) => (v / 1000).toFixed(2).replace(".", ",");
  const warnings: string[] = [];
  const biggest = Math.max(...sizeMm);

  // Fel längdenhet är lika vanligt i en GLB som i en STEP, och syns på
  // storleksordningen: en modell exporterad i millimeter blir tusen gånger
  // för stor.
  if (biggest < 500) {
    warnings.push(
      `Största måttet är bara ${m(biggest)} m. Kontrollera längdenheten i exporten — ` +
        "glTF ska vara meter.",
    );
  } else if (biggest > 60_000) {
    warnings.push(
      `Största måttet är ${m(biggest)} m. Exporterades GLB:n i millimeter i stället för meter?`,
    );
  }
  if (sizeMm[2] < 100) {
    warnings.push(
      `Höjden ${m(sizeMm[2])} m är för låg för en maskin i biblioteket.`,
    );
  }
  if (triangles > 400_000) {
    warnings.push(
      `${Math.round(triangles).toLocaleString("sv-SE")} trianglar är mycket. Förenkla ` +
        "modellen i programmet som gjorde den, annars blir 3D-vyn trög.",
    );
  }

  return {
    footprint: { lengthMm: sizeMm[0], widthMm: sizeMm[1], heightMm: sizeMm[2] },
    warnings,
    stats: {
      glbBytes: bytes.length,
      trianglesIn: Math.round(triangles),
      /** Antalet uppritade delar — instanser, inte unika meshar. */
      meshes: instances || doc.getRoot().listMeshes().length,
    },
  };
}
