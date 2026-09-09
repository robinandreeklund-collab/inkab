"use client";

import { useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import type { LayoutResult, Configuration, Placement } from "@/lib/types";

/**
 * 3D-vy med riktiga maskinmodeller.
 *
 * Ladas lat: three.js och GLTFLoader importeras först när vyn öppnas, så
 * huvudbundlen påverkas inte. Varje SKU laddas en gång och instansieras —
 * en anläggning har 10–40 maskiner men bara 10–15 unika modeller, och det är
 * antalet unika som kostar.
 *
 * Maskiner utan modell ritas som en låda i sitt fotavtryck, så vyn fungerar
 * medan biblioteket fylls på.
 */
export function ModelView() {
  const config = useConfigStore((s) => s.config);
  const layout = useConfigStore((s) => s.layout);
  const selectedId = useConfigStore((s) => s.selectedId);

  const mount = useRef<HTMLDivElement | null>(null);
  const api = useRef<{ update: (c: Configuration, l: LayoutResult, sel: string | null) => void; dispose: () => void } | null>(null);

  const [status, setStatus] = useState("Startar 3D-vyn…");
  const [loaded, setLoaded] = useState<{ withModel: number; total: number } | null>(null);
  /** Maskiner där modellens mått inte stämmer med bibliotekets. */
  const [mismatches, setMismatches] = useState<string[]>([]);
  /**
   * Modeller som är inlagda på maskinen men inte gick att hämta. Tidigare
   * ritades maskinen bara som en låda, vilket ser likadant ut som "ingen
   * modell" — och den vanligaste orsaken är att servern startat om utan
   * DATABASE_URL, alltså precis det man behöver få veta.
   */
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => {
    let disposed = false;
    const element = mount.current;
    if (!element) return;

    (async () => {
      const [THREE, { GLTFLoader }, { OrbitControls }, { MeshoptDecoder }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      element.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#eceef0");

      const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 500);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2.05;

      // Enkel studioljussättning. Läsbarhet före fotorealism.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9099a5, 2.1));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(24, 34, 16);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const s = 60;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 200 });
      scene.add(sun);

      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const cache = new Map<string, Promise<import("three").Object3D>>();

      /** Laddar en SKU en gång; alla instanser klonar samma geometri. */
      const loadModel = (url: string) => {
        let existing = cache.get(url);
        if (!existing) {
          existing = loader.loadAsync(url).then((gltf) => {
            gltf.scene.traverse((node) => {
              const mesh = node as import("three").Mesh;
              if (!mesh.isMesh) return;
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            });
            return gltf.scene;
          });
          cache.set(url, existing);
        }
        return existing;
      };

      const world = new THREE.Group();
      scene.add(world);

      const clear = (group: import("three").Object3D) => {
        while (group.children.length) group.remove(group.children[0]);
      };

      let generation = 0;

      const update = async (cfg: Configuration, result: LayoutResult, sel: string | null) => {
        const mine = ++generation;
        clear(world);

        const hallL = cfg.hall.lengthMm / 1000;
        const hallW = cfg.hall.widthMm / 1000;

        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(hallL, hallW),
          new THREE.MeshStandardMaterial({ color: "#e2e5e8", roughness: 0.95 }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(hallL / 2, 0, hallW / 2);
        floor.receiveShadow = true;
        world.add(floor);

        const grid = new THREE.GridHelper(Math.max(hallL, hallW), Math.round(Math.max(hallL, hallW)), 0xb8bec5, 0xd3d8dd);
        grid.position.set(hallL / 2, 0.002, hallW / 2);
        world.add(grid);

        // Ritade objekt: väggar, portar, truckzoner.
        for (const object of cfg.drawn) {
          const l = object.l / 1000;
          const w = object.w / 1000;
          const h = Math.max(object.h, 1) / 1000;
          const colour = { wall: "#c8ccd1", door: "#5980a6", truck: "#cfd6dd", nogo: "#c98a9a" }[object.kind];
          const flat = object.kind === "truck" || object.kind === "nogo";
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(l, flat ? 0.01 : h, w),
            new THREE.MeshStandardMaterial({
              color: colour,
              roughness: 0.9,
              transparent: object.kind !== "wall",
              opacity: object.kind === "wall" ? 1 : object.kind === "door" ? 0.35 : 0.55,
            }),
          );
          mesh.position.set(object.x / 1000 + l / 2, flat ? 0.006 : h / 2, object.y / 1000 + w / 2);
          mesh.receiveShadow = true;
          if (object.kind === "wall") mesh.castShadow = true;
          world.add(mesh);
        }

        const withModel = result.placements.filter((p) => p.machine.model?.glb).length;
        const found: string[] = [];
        const absent: string[] = [];
        setLoaded({ withModel, total: result.placements.length });
        setMismatches([]);
        setMissing([]);
        setStatus(
          withModel === 0
            ? "Inga maskinmodeller inlagda ännu — visar fotavtryck. Kör scripts/step-to-glb.mjs och peka ut GLB:n i admin."
            : `${withModel} av ${result.placements.length} maskiner har modell.`,
        );

        for (const placement of result.placements) {
          const url = placement.machine.model?.glb;
          const group = new THREE.Group();
          // Solverns origo är maskinens minhörn; modellens origo är
          // inmatningsporten i golvnivå, alltså samma punkt.
          group.position.set(placement.bbox.x / 1000, 0, placement.bbox.y / 1000);
          world.add(group);

          if (url) {
            try {
              const model = await loadModel(url);
              if (mine !== generation) return;
              const clone = model.clone(true);
              // Rotationen kommer ur solvern; modellen är byggd med X i flödet.
              clone.rotation.y = -(placement.rotation * Math.PI) / 180;
              if (placement.mirrored) clone.scale.z *= -1;

              const fit = alignToFootprint(THREE, clone, placement);
              if (fit && Math.abs(fit.scale - 1) > 0.05) {
                found.push(
                  `${placement.machine.name}: modellen är ${meters(fit.modelLengthMm)} × ` +
                    `${meters(fit.modelWidthMm)} m men biblioteket säger ` +
                    `${meters(placement.size.lengthMm)} × ${meters(placement.size.widthMm)} m`,
                );
                if (mine === generation) setMismatches([...found]);
              }
              group.add(clone);
              continue;
            } catch {
              // Faller igenom till lådan nedan, men tyst gör det inte.
              absent.push(placement.machine.name);
              if (mine === generation) setMissing([...absent]);
            }
          }

          group.add(footprintBox(THREE, placement, placement.instanceId === sel));
        }

        if (mine === generation) frameCamera(THREE, camera, controls, hallL, hallW);
      };

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = element;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();

      let frame = 0;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
      };
      tick();

      api.current = {
        update,
        dispose: () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          controls.dispose();
          renderer.dispose();
          element.removeChild(renderer.domElement);
        },
      };
      update(config, layout, selectedId);
    })();

    return () => {
      disposed = true;
      api.current?.dispose();
      api.current = null;
    };
    // Scenen byggs en gång; innehållet uppdateras nedan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.update(config, layout, selectedId);
  }, [config, layout, selectedId]);

  return (
    <div className="relative h-full w-full">
      <div ref={mount} className="h-full w-full" />
      {missing.length > 0 ? (
        <div className="absolute left-2 top-2 max-w-md border border-danger bg-white/95 p-2">
          <div className="kicker mb-1 text-danger">Modellfilen gick inte att hämta</div>
          <ul className="space-y-0.5">
            {missing.map((name, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-ink">
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Maskinen ritas som sitt fotavtryck så länge. Vanligaste orsaken är att servern
            saknar <code className="num">DATABASE_URL</code> — då ligger uppladdade modeller
            bara i minnet och försvinner när instansen startar om.
          </p>
        </div>
      ) : mismatches.length > 0 ? (
        <div className="absolute left-2 top-2 max-w-md border border-warn bg-white/95 p-2">
          <div className="kicker mb-1 text-warn">Modell och mått skiljer sig</div>
          <ul className="space-y-0.5">
            {mismatches.map((m, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-ink">
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted">
            Modellen visas skalad till bibliotekets mått. Rätta fotavtrycket i admin.
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-2">
        <span className="kicker max-w-[60%] bg-paper/85 px-1 leading-relaxed">{status}</span>
        {loaded ? (
          <span className="kicker bg-paper/85 px-1">
            {loaded.withModel}/{loaded.total} modeller
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ställer modellen på golvet i maskinens hörn och skalar den likformigt till
 * den deklarerade längden.
 *
 * Modellen är måttriktig ur STEP:en, så skalan borde vara 1. Är den det inte
 * betyder det att fotavtrycket i biblioteket inte stämmer med konstruktionen —
 * och då är 3D-vyn en kontroll av datan, inte bara en bild. Avvikelsen
 * rapporteras uppåt i stället för att döljas med en förvrängning.
 */
function alignToFootprint(
  THREE: typeof import("three"),
  object: import("three").Object3D,
  placement: Placement,
): { scale: number; modelLengthMm: number; modelWidthMm: number } | null {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 1e-4 || size.z < 1e-4) return null;

  const along = placement.rotation % 180 === 0;
  const targetL = (along ? placement.size.lengthMm : placement.size.widthMm) / 1000;
  const scale = targetL / size.x;
  object.scale.multiplyScalar(scale);

  const after = new THREE.Box3().setFromObject(object);
  object.position.x -= after.min.x;
  object.position.z -= after.min.z;
  object.position.y -= after.min.y;

  return {
    scale,
    modelLengthMm: Math.round(size.x * 1000),
    modelWidthMm: Math.round(size.z * 1000),
  };
}

/** Fotavtryck som låda, för maskiner utan modell. */
function footprintBox(
  THREE: typeof import("three"),
  placement: Placement,
  selected: boolean,
) {
  const l = placement.bbox.l / 1000;
  const w = placement.bbox.w / 1000;
  const h = Math.max(placement.size.heightMm, 200) / 1000;

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(l, h, w),
    new THREE.MeshStandardMaterial({
      color: placement.aux ? "#dfe3e7" : "#f2f3f5",
      roughness: 0.8,
      transparent: placement.aux,
      opacity: placement.aux ? 0.75 : 1,
    }),
  );
  mesh.position.set(l / 2, h / 2, w / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: selected ? 0x5980a6 : 0x1d1f20 }),
  );
  edges.position.copy(mesh.position);
  group.add(edges);
  return group;
}

function frameCamera(
  THREE: typeof import("three"),
  camera: import("three").PerspectiveCamera,
  controls: { target: import("three").Vector3; update: () => void },
  hallL: number,
  hallW: number,
) {
  const centre = new THREE.Vector3(hallL / 2, 0, hallW / 2);
  const span = Math.max(hallL, hallW);
  camera.position.set(centre.x - span * 0.55, span * 0.5, centre.z + span * 0.75);
  controls.target.copy(centre);
  controls.update();
}
