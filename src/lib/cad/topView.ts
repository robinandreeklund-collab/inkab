"use client";

import { orientationEuler } from "./orientation";
import type { Machine } from "../types";

/**
 * Maskinens 3D-modell sedd rakt uppifrån, som en bild för planvyn.
 *
 * Planvyn ritade varje maskin som en vit ruta, också när en riktig modell
 * fanns uppladdad. Här renderas modellen en gång ovanifrån med en ortografisk
 * kamera — samma orientering som i 3D-vyn — och bilden läggs i maskinens ruta.
 * Det kostar en rendering per unik modell, inte per maskin eller per bildruta:
 * bilden sparas och återanvänds så länge modellen och dess orientering är
 * desamma.
 *
 * Bilden är i maskinens eget läge (rotation 0, ospeglad), med modellens
 * verkliga mått. Planvyn vrider och speglar den som maskinen.
 */

export type TopView = {
  /** PNG med genomskinlig bakgrund. */
  url: string;
  /** Modellens utbredning längs maskinens längd (X) och bredd (Y), mm. */
  lengthMm: number;
  widthMm: number;
};

/** Bildens största sida i pixlar. Skarpt nog för en planritning på skärmen. */
const MAX_PX = 640;
/** Samma stålblå som i 3D-vyn, ljusare: uppifrån får ytorna mindre ljus, och planen ska gå att läsa. */
const TINT = "#7d9ab6";

const cache = new Map<string, Promise<TopView | null>>();

function cacheKey(machine: Machine): string | null {
  const model = machine.model;
  if (!model?.glb) return null;
  return [model.glb, model.upAxis ?? "z", model.yawDeg ?? 0, model.flipped ? 1 : 0].join("|");
}

/** Bilden ovanifrån, eller null om maskinen saknar modell eller den inte gick att läsa. */
export function topViewOf(machine: Machine): Promise<TopView | null> | null {
  const key = cacheKey(machine);
  if (!key || typeof window === "undefined") return null;
  let pending = cache.get(key);
  if (!pending) {
    pending = render(machine).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

async function render(machine: Machine): Promise<TopView | null> {
  const model = machine.model!;
  const [THREE, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(model.glb);
  const tint = new THREE.Color(TINT);
  gltf.scene.traverse((node) => {
    const mesh = node as import("three").Mesh;
    if (!mesh.isMesh) return;
    const recolour = (m: import("three").Material) => {
      const copy = m.clone() as import("three").MeshStandardMaterial;
      if (copy.color) copy.color.multiply(tint);
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolour) : recolour(mesh.material);
  });

  // Samma orientering som 3D-vyn: modellens egen axel och vridning, och
  // spegling om modellen är ritad åt andra hållet.
  const oriented = gltf.scene;
  const euler = orientationEuler(model);
  oriented.rotation.set(euler.x, euler.y, 0, euler.order);
  const holder = new THREE.Group();
  holder.add(oriented);
  if (model.flipped) holder.scale.z *= -1;

  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 1e-4 || size.z < 1e-4) return null;
  const centre = box.getCenter(new THREE.Vector3());

  const scene = new THREE.Scene();
  scene.add(holder);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2cc, 3.2));
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(centre.x + size.x, box.max.y + 10, centre.z + size.z * 0.6);
  scene.add(sun);

  // Rakt ovanifrån. Kamerans "upp" är −Z, så att bildens Y växer med
  // hallens Y, som i planvyn.
  const camera = new THREE.OrthographicCamera(
    -size.x / 2,
    size.x / 2,
    size.z / 2,
    -size.z / 2,
    0.01,
    size.y + 20,
  );
  camera.position.set(centre.x, box.max.y + 10, centre.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(centre.x, 0, centre.z);

  const scale = MAX_PX / Math.max(size.x, size.z);
  const width = Math.max(8, Math.round(size.x * scale));
  const height = Math.max(8, Math.round(size.z * scale));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    return { url, lengthMm: Math.round(size.x * 1000), widthMm: Math.round(size.z * 1000) };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
