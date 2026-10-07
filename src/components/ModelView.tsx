"use client";

import { useEffect, useRef, useState } from "react";
import { useConfigStore } from "@/store/useConfigStore";
import { meters } from "@/lib/format";
import { orientationEuler } from "@/lib/cad/orientation";
import { MACHINE_DRAG_TYPE } from "@/lib/dragTypes";
import { useT } from "@/lib/i18n";
import { Tip } from "./ui";
import type { LayoutResult, Configuration, Machine, Placement, Vec2 } from "@/lib/types";

/** Maskiner snappar till samma raster som i planvyn, mm. */
const SNAP_MM = 250;
const snap = (v: number) => Math.round(v / SNAP_MM) * SNAP_MM;

/** Fördefinierade kameravinklar. */
export type CameraPreset = "overview" | "top" | "infeed" | "side" | "outfeed";

type ViewApi = {
  update: (c: Configuration, l: LayoutResult, sel: string | null) => void;
  dispose: () => void;
  /** Punkten på golvet under en skärmkoordinat, i hallens mm. */
  floorAt: (clientX: number, clientY: number) => Vec2 | null;
  /** Visar fotavtrycket av en maskin som dras in ur katalogen. */
  ghost: (machine: Machine | null, at: Vec2 | null) => void;
  preset: (name: CameraPreset) => void;
  orbit: (azimuthDeg: number, polarDeg: number) => void;
  zoom: (factor: number) => void;
};

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
  const library = useConfigStore((s) => s.library);
  const t = useT();

  const mount = useRef<HTMLDivElement | null>(null);
  const api = useRef<ViewApi | null>(null);
  /** Kamerans riktning runt hallen, grader — för kompassen i orbitkontrollen. */
  const [azimuth, setAzimuth] = useState(0);

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
      let lastAzimuth = 0;
      controls.addEventListener("change", () => {
        const deg = (controls.getAzimuthalAngle() * 180) / Math.PI;
        if (Math.abs(deg - lastAzimuth) < 1) return;
        lastAzimuth = deg;
        setAzimuth(deg);
      });

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

      /*
       * Markering, drag och släpp.
       *
       * Varje maskin är en grupp märkt med sitt instans-id. Ett klick träffar
       * en mesh någonstans i modellen; vi går uppåt tills vi hittar gruppen.
       * Under ett drag flyttas bara gruppen i scenen — konfigurationen ändras
       * när man släpper, så att ett drag blir ett steg att ångra och modellerna
       * inte laddas om för varje millimeter.
       */
      const groups = new Map<string, import("three").Group>();
      const origins = new Map<string, Vec2>();
      const raycaster = new THREE.Raycaster();
      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      let selection: import("three").BoxHelper | null = null;
      let ghostMesh: import("three").Mesh | null = null;

      const ndc = (clientX: number, clientY: number) => {
        const rect = renderer.domElement.getBoundingClientRect();
        return new THREE.Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        );
      };
      const floorAt = (clientX: number, clientY: number): Vec2 | null => {
        raycaster.setFromCamera(ndc(clientX, clientY), camera);
        const hit = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
        return hit ? { x: hit.x * 1000, y: hit.z * 1000 } : null;
      };
      const machineAt = (clientX: number, clientY: number): string | null => {
        raycaster.setFromCamera(ndc(clientX, clientY), camera);
        const hits = raycaster.intersectObjects([...groups.values()], true);
        for (const hit of hits) {
          let node: import("three").Object3D | null = hit.object;
          while (node && !node.userData.instanceId) node = node.parent;
          if (node) return node.userData.instanceId as string;
        }
        return null;
      };
      const highlight = (id: string | null) => {
        if (selection) {
          scene.remove(selection);
          selection.dispose();
          selection = null;
        }
        const group = id ? groups.get(id) : undefined;
        if (!group) return;
        selection = new THREE.BoxHelper(group, 0x5980a6);
        scene.add(selection);
      };

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || event.target !== renderer.domElement) return;
        const store = useConfigStore.getState();
        const id = machineAt(event.clientX, event.clientY);
        const startScreen = { x: event.clientX, y: event.clientY };

        if (!id) {
          // Tomt golv: ett klick utan rörelse avmarkerar, ett drag vrider kameran.
          const up = (e: PointerEvent) => {
            window.removeEventListener("pointerup", up);
            if (Math.hypot(e.clientX - startScreen.x, e.clientY - startScreen.y) < 4) store.select(null);
          };
          window.addEventListener("pointerup", up);
          return;
        }

        store.select(id);
        const group = groups.get(id);
        const origin = origins.get(id);
        const start = floorAt(event.clientX, event.clientY);
        if (!group || !origin || !start) return;
        controls.enabled = false;
        const from = group.position.clone();
        let delta = { x: 0, y: 0 };

        const move = (e: PointerEvent) => {
          const now = floorAt(e.clientX, e.clientY);
          if (!now) return;
          delta = { x: snap(now.x - start.x), y: snap(now.y - start.y) };
          group.position.set(from.x + delta.x / 1000, from.y, from.z + delta.y / 1000);
          selection?.update();
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          controls.enabled = true;
          if (delta.x !== 0 || delta.y !== 0) {
            useConfigStore.getState().moveMachine(id, { x: origin.x + delta.x, y: origin.y + delta.y });
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      };
      // På föräldern i capture-fasen: då hinner vi stänga av orbitkontrollen
      // innan den tar pekaren, när man tar tag i en maskin.
      element.addEventListener("pointerdown", onPointerDown, { capture: true });

      const ghost = (machine: Machine | null, at: Vec2 | null) => {
        if (ghostMesh) {
          scene.remove(ghostMesh);
          ghostMesh.geometry.dispose();
          ghostMesh = null;
        }
        if (!machine || !at) return;
        const l = machine.footprint.lengthMm / 1000;
        const w = machine.footprint.widthMm / 1000;
        const h = Math.max(machine.footprint.heightMm, 200) / 1000;
        ghostMesh = new THREE.Mesh(
          new THREE.BoxGeometry(l, h, w),
          new THREE.MeshStandardMaterial({ color: "#5980a6", transparent: true, opacity: 0.35 }),
        );
        ghostMesh.position.set(at.x / 1000, h / 2, at.y / 1000);
        scene.add(ghostMesh);
      };

      /*
       * Kamerarörelser. Förinställda vyer och orbitknapparna glider dit i
       * stället för att hoppa, så att man ser var man hamnade i förhållande
       * till var man var.
       */
      let hallSize = { l: 40, w: 20 };
      let flight: {
        from: import("three").Vector3;
        to: import("three").Vector3;
        targetFrom: import("three").Vector3;
        targetTo: import("three").Vector3;
        start: number;
      } | null = null;
      const fly = (to: import("three").Vector3, target: import("three").Vector3) => {
        flight = {
          from: camera.position.clone(),
          to,
          targetFrom: controls.target.clone(),
          targetTo: target,
          start: performance.now(),
        };
      };
      const preset = (name: CameraPreset) => {
        const centre = new THREE.Vector3(hallSize.l / 2, 0, hallSize.w / 2);
        const span = Math.max(hallSize.l, hallSize.w);
        const at = {
          overview: new THREE.Vector3(centre.x - span * 0.55, span * 0.5, centre.z + span * 0.75),
          // Rakt uppifrån, med en hårsmån lutning så att orbitkontrollen vet var norr är.
          top: new THREE.Vector3(centre.x, span * 1.15, centre.z + 0.01),
          infeed: new THREE.Vector3(centre.x - span * 0.85, span * 0.22, centre.z),
          side: new THREE.Vector3(centre.x, span * 0.3, centre.z + span * 0.9),
          outfeed: new THREE.Vector3(centre.x + span * 0.85, span * 0.22, centre.z),
        }[name];
        fly(at, centre);
      };
      const orbit = (azimuthDeg: number, polarDeg: number) => {
        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += (azimuthDeg * Math.PI) / 180;
        spherical.phi = Math.min(
          controls.maxPolarAngle,
          Math.max(0.05, spherical.phi + (polarDeg * Math.PI) / 180),
        );
        fly(new THREE.Vector3().setFromSpherical(spherical).add(controls.target), controls.target.clone());
      };
      const zoom = (factor: number) => {
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
        fly(offset.add(controls.target), controls.target.clone());
      };
      let framedFor = "";

      const clear = (group: import("three").Object3D) => {
        while (group.children.length) group.remove(group.children[0]);
      };

      let generation = 0;

      const update = async (cfg: Configuration, result: LayoutResult, sel: string | null) => {
        const mine = ++generation;
        clear(world);
        groups.clear();
        origins.clear();

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
          group.userData.instanceId = placement.instanceId;
          world.add(group);
          groups.set(placement.instanceId, group);
          origins.set(placement.instanceId, placement.origin);

          if (url) {
            try {
              const model = await loadModel(url);
              if (mine !== generation) return;

              // Två lager rotation, med flit. Det inre bär modellens egen
              // orientering — vilken axel som var upp i CAD:en och hur den
              // ska vridas för att peka med flödet. Det yttre bär solverns
              // placering. Hålls de isär kan de ställas in var för sig utan
              // att man behöver räkna ut hur de kombineras.
              const oriented = model.clone(true);
              const euler = orientationEuler(placement.machine.model);
              oriented.rotation.set(euler.x, euler.y, 0, euler.order);

              const clone = new THREE.Group();
              clone.add(oriented);
              clone.rotation.y = -(placement.rotation * Math.PI) / 180;
              if (placement.mirrored !== !!placement.machine.model?.flipped) {
                clone.scale.z *= -1;
              }

              const fit = alignToFootprint(THREE, clone, placement);
              const off =
                fit &&
                (Math.abs(fit.modelLengthMm - placement.size.lengthMm) >
                  placement.size.lengthMm * 0.05 ||
                  Math.abs(fit.modelWidthMm - placement.size.widthMm) >
                    placement.size.widthMm * 0.05);
              if (fit && off) {
                found.push(
                  `${placement.machine.name}: modellen är ${meters(fit.modelLengthMm)} × ` +
                    `${meters(fit.modelWidthMm)} m men biblioteket säger ` +
                    `${meters(placement.size.lengthMm)} × ${meters(placement.size.widthMm)} m`,
                );
                if (mine === generation) setMismatches([...found]);
              }
              group.add(clone);
              if (placement.instanceId === sel) highlight(sel);
              continue;
            } catch {
              // Faller igenom till lådan nedan, men tyst gör det inte.
              absent.push(placement.machine.name);
              if (mine === generation) setMissing([...absent]);
            }
          }

          group.add(footprintBox(THREE, placement, placement.instanceId === sel));
          if (placement.instanceId === sel) highlight(sel);
        }
        if (!sel || !groups.has(sel)) highlight(null);

        /*
         * Kameran ramas in när vyn öppnas och när hallen byter storlek — inte
         * vid varje ändring. Förut hoppade den tillbaka till översikten varje
         * gång en maskin flyttades, och man tappade bort det man tittade på.
         */
        hallSize = { l: hallL, w: hallW };
        const key = `${hallL}x${hallW}`;
        if (mine === generation && key !== framedFor) {
          framedFor = key;
          frameCamera(THREE, camera, controls, hallL, hallW);
        }
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
        if (flight) {
          const k = Math.min(1, (performance.now() - flight.start) / 450);
          const ease = 1 - Math.pow(1 - k, 3);
          camera.position.lerpVectors(flight.from, flight.to, ease);
          controls.target.lerpVectors(flight.targetFrom, flight.targetTo, ease);
          if (k >= 1) flight = null;
        }
        controls.update();
        renderer.render(scene, camera);
      };
      tick();

      api.current = {
        update,
        floorAt,
        ghost,
        preset,
        orbit,
        zoom,
        dispose: () => {
          cancelAnimationFrame(frame);
          element.removeEventListener("pointerdown", onPointerDown, { capture: true });
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

  const dropMachine = (event: React.DragEvent): Machine | null => {
    const id = useConfigStore.getState().draggingMachineId ?? event.dataTransfer.getData(MACHINE_DRAG_TYPE);
    return id ? (library.machines.find((m) => m.id === id) ?? null) : null;
  };

  const onDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(MACHINE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const at = api.current?.floorAt(event.clientX, event.clientY) ?? null;
    api.current?.ghost(dropMachine(event), at ? { x: snap(at.x), y: snap(at.y) } : null);
  };

  const onDrop = (event: React.DragEvent) => {
    api.current?.ghost(null, null);
    const id = event.dataTransfer.getData(MACHINE_DRAG_TYPE);
    if (!id) return;
    event.preventDefault();
    const at = api.current?.floorAt(event.clientX, event.clientY);
    if (at) useConfigStore.getState().addMachine(id, { pos: { x: snap(at.x), y: snap(at.y) } });
  };

  const selected = layout.placements.find((p) => p.instanceId === selectedId) ?? null;

  return (
    <div
      className="relative h-full w-full"
      onDragOver={onDragOver}
      onDragLeave={() => api.current?.ghost(null, null)}
      onDrop={onDrop}
    >
      <div ref={mount} className="h-full w-full" />

      <OrbitPanel
        azimuth={azimuth}
        onPreset={(name) => api.current?.preset(name)}
        onOrbit={(a, p) => api.current?.orbit(a, p)}
        onZoom={(f) => api.current?.zoom(f)}
      />

      {selected ? (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 border border-accent bg-white px-3 py-1.5 text-xs shadow-sm">
          <span className="max-w-[220px] truncate">{selected.machine.name}</span>
          <span className="text-muted">{t("model.dragHint")}</span>
          <Tip title={t("model.turnLeft")} shortcut="⇧R">
            <button
              onClick={() => useConfigStore.getState().turnMachine(selected.instanceId, -1)}
              className="border border-divider px-2 py-0.5 hover:border-accent"
              aria-label={t("model.turnLeft")}
            >
              ↺
            </button>
          </Tip>
          <Tip title={t("model.turnRight")} shortcut="R">
            <button
              onClick={() => useConfigStore.getState().turnMachine(selected.instanceId, 1)}
              className="border border-divider px-2 py-0.5 hover:border-accent"
              aria-label={t("model.turnRight")}
            >
              ↻
            </button>
          </Tip>
          <button
            onClick={() => useConfigStore.getState().removeItem(selected.instanceId)}
            className="px-1 text-muted hover:text-danger"
            aria-label={t("model.remove")}
          >
            ×
          </button>
        </div>
      ) : null}
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
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Modellen visas i sin verkliga storlek — den är måttriktig ur STEP-filen, så det
            är maskindatan som behöver rättas. Ladda upp filen igen i admin, så tas måtten
            därifrån.
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
 * Ställer modellen på golvet i maskinens hörn — i sin verkliga storlek.
 *
 * Modellen skalas INTE till det deklarerade måttet. Den kommer måttriktig ur
 * STEP:en, och att töja den för att fylla ut en siffra i biblioteket vore att
 * rita något som inte finns: en tre meter lång rullbana sträckt till tolv fick
 * rullar som var fyra gånger för stora. Skiljer sig måtten är det datan som
 * är fel, inte modellen, och då ska skillnaden synas — inte döljas med en
 * förvrängning. Avvikelsen rapporteras uppåt.
 */
function alignToFootprint(
  THREE: typeof import("three"),
  object: import("three").Object3D,
  placement: Placement,
): { modelLengthMm: number; modelWidthMm: number } | null {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 1e-4 || size.z < 1e-4) return null;

  const after = new THREE.Box3().setFromObject(object);
  object.position.x -= after.min.x;
  object.position.z -= after.min.z;
  object.position.y -= after.min.y;

  const along = placement.rotation % 180 === 0;
  return {
    modelLengthMm: Math.round((along ? size.x : size.z) * 1000),
    modelWidthMm: Math.round((along ? size.z : size.x) * 1000),
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

/**
 * Synlig orbitkontroll: en kompass som visar åt vilket håll man tittar, pilar
 * som vrider och lutar kameran, zoom, och de vanligaste vinklarna som knappar.
 *
 * Musens orbit finns kvar, men den är osynlig — den som inte vet att man kan
 * dra med höger musknapp hittar den aldrig. Här ser man vad som går att göra.
 */
function OrbitPanel({
  azimuth,
  onPreset,
  onOrbit,
  onZoom,
}: {
  azimuth: number;
  onPreset: (name: CameraPreset) => void;
  onOrbit: (azimuthDeg: number, polarDeg: number) => void;
  onZoom: (factor: number) => void;
}) {
  const t = useT();
  const arrow = (label: string, d: string, onClick: () => void, className: string) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`absolute flex h-7 w-7 items-center justify-center rounded-full text-steel hover:bg-accent hover:text-white ${className}`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d={d} />
      </svg>
    </button>
  );

  return (
    <div className="absolute right-3 top-3 z-10 flex w-[132px] flex-col items-center gap-2 border border-divider bg-white/95 p-2 shadow-sm">
      <div className="kicker">{t("model.orbit")}</div>
      <div className="relative h-[104px] w-[104px] rounded-full border border-divider bg-paper">
        {/* Kompassen: pilen pekar längs hallen (X), i den riktning kameran tittar. */}
        <svg
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0"
          style={{ transform: `rotate(${-azimuth}deg)` }}
        >
          <circle cx="50" cy="50" r="30" fill="none" stroke="#d4d4d7" />
          <path d="M50 22 L55 50 L50 46 L45 50Z" fill="#5980a6" />
          <path d="M50 78 L55 50 L50 54 L45 50Z" fill="#d4d4d7" />
          <text x="50" y="16" textAnchor="middle" fontSize="9" fill="#5980a6">
            X
          </text>
        </svg>
        {arrow(t("model.tiltUp"), "M6 2 L11 9 L1 9Z", () => onOrbit(0, -15), "left-1/2 top-0 -translate-x-1/2")}
        {arrow(t("model.tiltDown"), "M6 10 L11 3 L1 3Z", () => onOrbit(0, 15), "bottom-0 left-1/2 -translate-x-1/2")}
        {arrow(t("model.rotateLeft"), "M2 6 L9 1 L9 11Z", () => onOrbit(-45, 0), "left-0 top-1/2 -translate-y-1/2")}
        {arrow(t("model.rotateRight"), "M10 6 L3 1 L3 11Z", () => onOrbit(45, 0), "right-0 top-1/2 -translate-y-1/2")}
        <button
          onClick={() => onPreset("overview")}
          title={t("model.view.overview")}
          className="kicker absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-divider bg-white text-[9px] hover:border-accent"
        >
          {t("model.fit")}
        </button>
      </div>
      <div className="flex w-full gap-1">
        <button onClick={() => onZoom(0.8)} className="flex-1 border border-divider py-0.5 text-sm hover:border-accent" aria-label={t("model.zoomIn")} title={t("model.zoomIn")}>
          +
        </button>
        <button onClick={() => onZoom(1.25)} className="flex-1 border border-divider py-0.5 text-sm hover:border-accent" aria-label={t("model.zoomOut")} title={t("model.zoomOut")}>
          −
        </button>
      </div>
      <div className="grid w-full grid-cols-1 gap-1">
        {(["overview", "top", "infeed", "side", "outfeed"] as const).map((name) => (
          <button
            key={name}
            onClick={() => onPreset(name)}
            className="border border-divider px-1 py-0.5 text-left text-[11px] hover:border-accent hover:text-accent"
          >
            {t(`model.view.${name}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
