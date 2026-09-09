"use client";

import { useEffect, useRef, useState } from "react";
import { orientationEuler, type ModelOrientation } from "@/lib/cad/orientation";

/**
 * Liten 3D-vy för att ställa in modellens riktning.
 *
 * Poängen är återkopplingen. Att vrida en modell rätt genom att spara, byta
 * vy och titta är en loop på en halv minut per försök; här syns ändringen
 * direkt. Golvrutnätet och pilen visar flödesriktningen, och trådlådan visar
 * maskinens fotavtryck ur biblioteket — står modellen utanför lådan är det
 * antingen måtten eller riktningen som är fel, och det syns med en gång.
 */
export function ModelPreview({
  url,
  orientation,
  footprint,
}: {
  url: string;
  orientation: ModelOrientation;
  footprint: { lengthMm: number; widthMm: number; heightMm: number };
}) {
  const mount = useRef<HTMLDivElement | null>(null);
  const api = useRef<{
    setOrientation: (o: ModelOrientation) => void;
    dispose: () => void;
  } | null>(null);
  const [status, setStatus] = useState("Laddar modellen…");
  /** Satt när modellen behövde skalas för att fylla lådan. */
  const [scaled, setScaled] = useState<number | null>(null);

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
      element.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#eceef0");
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8f9296, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(6, 10, 4);
      scene.add(sun);

      const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      const l = footprint.lengthMm / 1000;
      const w = footprint.widthMm / 1000;
      const h = footprint.heightMm / 1000;

      // Golv och riktning. Pilen pekar dit paketen går.
      const grid = new THREE.GridHelper(Math.max(l, w) * 3, 24, 0xb8babd, 0xd6d8da);
      scene.add(grid);
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-l * 0.75, 0.01, 0),
        l * 0.6,
        0x5980a6,
        l * 0.12,
        l * 0.07,
      );
      scene.add(arrow);

      // Fotavtrycket ur biblioteket, som trådlåda kring origo i hörnet.
      const box = new THREE.Box3(
        new THREE.Vector3(0, 0, -w / 2),
        new THREE.Vector3(l, h, w / 2),
      );
      scene.add(new THREE.Box3Helper(box, new THREE.Color(0x9aa0a6)));

      const holder = new THREE.Group();
      scene.add(holder);

      const frame = () => {
        const radius = Math.max(l, w, h) * 1.1 || 1;
        camera.position.set(radius * 1.4, radius * 1.1, radius * 1.6);
        controls.target.set(l / 2, h / 3, 0);
        controls.update();
      };
      frame();

      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      let model: import("three").Object3D | null = null;

      try {
        const gltf = await loader.loadAsync(url);
        if (disposed) return;
        model = gltf.scene;
        holder.add(model);
        setStatus("");
      } catch {
        setStatus("Modellfilen gick inte att hämta.");
      }

      const setOrientation = (next: ModelOrientation) => {
        if (!model) return;
        const euler = orientationEuler(next);
        model.rotation.set(euler.x, euler.y, 0);
        model.scale.set(1, 1, 1);
        model.position.set(0, 0, 0);

        /*
         * Skalas in i lådan. Vyn ska svara på en enda fråga — står modellen
         * åt rätt håll — och den frågan får inte hänga på att måtten redan
         * stämmer. En modell i fel längdenhet vore annars en osynlig prick i
         * hörnet, och en felvriden modell krymper synligt när den ska fylla
         * lådan liggande. Avvikelsen skrivs ut i stället för att döljas.
         */
        const raw = new THREE.Box3().setFromObject(model);
        const size = raw.getSize(new THREE.Vector3());
        const fit = Math.min(l / (size.x || l), w / (size.z || w), h / (size.y || h));
        const scale = Number.isFinite(fit) && fit > 0 ? fit : 1;
        model.scale.set(scale, scale, next.flipped ? -scale : scale);
        setScaled(Math.abs(scale - 1) > 0.05 ? scale : null);

        // Ställ modellen i lådans hörn efter vridningen: golvet är golvet,
        // och inmatningsänden ska ligga i origo oavsett hur den vreds.
        const after = new THREE.Box3().setFromObject(model);
        model.position.x -= after.min.x;
        model.position.y -= after.min.y;
        model.position.z -= (after.min.z + after.max.z) / 2;
      };
      setOrientation(orientation);

      const resize = () => {
        const { clientWidth, clientHeight } = element;
        if (!clientWidth || !clientHeight) return;
        renderer.setSize(clientWidth, clientHeight, false);
        camera.aspect = clientWidth / clientHeight;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();

      let raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
      };
      tick();

      api.current = {
        setOrientation,
        dispose: () => {
          cancelAnimationFrame(raf);
          observer.disconnect();
          controls.dispose();
          renderer.dispose();
          element.removeChild(renderer.domElement);
        },
      };
    })();

    return () => {
      disposed = true;
      api.current?.dispose();
      api.current = null;
    };
    // Modellen laddas om bara när filen eller fotavtrycket byts; riktningen
    // ändras i den redan laddade scenen.
  }, [url, footprint.lengthMm, footprint.widthMm, footprint.heightMm]);

  useEffect(() => {
    api.current?.setOrientation(orientation);
  }, [orientation]);

  return (
    <div className="relative h-56 w-full border border-divider bg-paper">
      <div ref={mount} className="h-full w-full" />
      <span className="kicker absolute left-2 top-2 bg-paper/85 px-1">
        {status || "Pilen visar flödet · lådan är bibliotekets fotavtryck"}
      </span>
      {scaled ? (
        <span className="kicker absolute bottom-2 left-2 bg-paper/85 px-1 text-warn">
          Skalad {scaled < 1 ? `1:${(1 / scaled).toFixed(1)}` : `${scaled.toFixed(1)}:1`} för att
          fylla lådan — måtten stämmer inte med biblioteket
        </span>
      ) : null}
    </div>
  );
}
