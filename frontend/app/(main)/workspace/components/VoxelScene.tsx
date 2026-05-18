"use client";

import { useRef, useState, useMemo, useCallback } from "react";
import { Canvas, useFrame, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Html, ContactShadows, RoundedBox } from "@react-three/drei";
import * as THREE from "three";


/* ═══════════════════════════════════════════════════════
   建筑规范白皮书（Toy Diorama 比例系统）
   ═══════════════════════════════════════════════════════ */
const SCALE = {
  block: 1.0,
  wallHeight: 1.6,   // 更矮胖
  wallThickness: 0.25,
  roofOverhang: 1.4, // 屋顶更宽
  roofHeight: 1.2,   // 屋顶更高
  windowSize: 0.32,  // 窗户更小
  doorHeight: 0.9,
  doorWidth: 0.45,
  bevel: 0.06,       // 更圆润
  spacing: 6.5,      // 建筑更展开
};

/* 治愈系配色 */
const C = {
  grass: "#C8D98C", dirt: "#C4A882", stone: "#E8E0D0",
  wood: "#A08060", water: "#88C8E8", cloud: "#FFFFFF",
  hero:  { main: "#E8A838", neutral: "#FFF8E1" },
  blue:  { main: "#6BA0C8", neutral: "#FFF8E1" },
  green: { main: "#68B888", neutral: "#FFF8E1" },
  pink:  { main: "#D890A0", neutral: "#FFF8E1" },
  teal:  { main: "#58A8A8", neutral: "#FFF8E1" },
  purple:{ main: "#A890D0", neutral: "#FFF8E1" },
  orange:{ main: "#E0A060", neutral: "#FFF8E1" },
};

/* ═══════════════════════════════════════════════════════
   基础体块系统
   ═══════════════════════════════════════════════════════ */

// 1. 标准方块
function B({ p, c, s = [1,1,1], o = 1 }: any) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshToonMaterial color={c} transparent={o<1} opacity={o} />
    </mesh>
  );
}

// 2. 圆角方块（真正圆润）
function R({ p, c, s = [1,1,1] }: any) {
  return (
    <RoundedBox position={p} args={s} radius={SCALE.bevel} smoothness={2} castShadow receiveShadow>
      <meshToonMaterial color={c} />
    </RoundedBox>
  );
}

// 3. 屋顶体块（更夸张的阶梯）
function Roof({ p, c, w, h, d }: { p:[number,number,number]; c:string; w:number; h:number; d:number }) {
  return (
    <group position={p}>
      <R p={[0, 0, 0]} c={c} s={[w, h*0.35, d]} />
      <R p={[0, h*0.38, 0]} c={c} s={[w*0.72, h*0.32, d*0.72]} />
      <R p={[0, h*0.72, 0]} c={c} s={[w*0.42, h*0.33, d*0.42]} />
    </group>
  );
}

// 4. 圆柱
function Cyl({ p, c, r = 0.2, h = 0.8 }: any) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <cylinderGeometry args={[r, r*1.1, h, 8]} />
      <meshToonMaterial color={c} />
    </mesh>
  );
}

// 5. 窗户（发光 + 窗框）
function Win({ p, c = "#FFE8A0" }: { p:[number,number,number]; c?:string }) {
  const sz = SCALE.windowSize;
  return (
    <group position={p}>
      {/* 窗框 */}
      <B p={[0, 0, -0.01]} c="#B8A890" s={[sz+0.08, sz+0.08, 0.04]} />
      {/* 玻璃 */}
      <mesh castShadow>
        <boxGeometry args={[sz, sz, 0.05]} />
        <meshToonMaterial color={c} emissive={c} emissiveIntensity={0.5} />
      </mesh>
      {/* 窗格十字 */}
      <B p={[0, 0, 0.03]} c="#B8A890" s={[0.03, sz+0.04, 0.02]} />
      <B p={[0, 0, 0.03]} c="#B8A890" s={[sz+0.04, 0.03, 0.02]} />
    </group>
  );
}

// 6. 门（带门框）
function Door({ p, c }: { p:[number,number,number]; c:string }) {
  const dw = SCALE.doorWidth;
  const dh = SCALE.doorHeight;
  return (
    <group position={p}>
      <B p={[0, 0, -0.02]} c="#B8A890" s={[dw+0.1, dh+0.06, 0.05]} />
      <B p={[0, 0, 0.02]} c={c} s={[dw, dh, 0.06]} />
      <B p={[0, dh*0.25, 0.05]} c="#A08060" s={[0.04, 0.04, 0.04]} />
    </group>
  );
}

/* ═══════════════════════════════════════════════════════
   模块化建筑工厂
   ═══════════════════════════════════════════════════════ */
function ToyHouse({ pos, colors, w = 2.4, onHouseClick, houseKey, title, desc }: any) {
  const ref = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const off = useRef(Math.random() * Math.PI * 2);
  const { main, neutral } = colors;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = pos[1] + Math.sin(clock.getElapsedTime() + off.current) * 0.025;
    ref.current.scale.setScalar(hovered ? 1.05 : 1.0);
  });

  const wallW = w;
  const wallH = SCALE.wallHeight;
  const wallD = w;
  const roofW = w * SCALE.roofOverhang;
  const roofH = SCALE.roofHeight;

  return (
    <group ref={ref} position={pos}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onHouseClick(houseKey); }}>

      {/* Hover 发光底座 */}
      {hovered && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI/2, 0, 0]}>
          <circleGeometry args={[wallW*0.8, 32]} />
          <meshBasicMaterial color={main} transparent opacity={0.2} />
        </mesh>
      )}

      {/* ═══ 三层地基 ═══ */}
      <R p={[0, 0.06, 0]} c="#B8B0A0" s={[wallW+0.7, 0.12, wallD+0.7]} />
      <R p={[0, 0.16, 0]} c="#D0C8B8" s={[wallW+0.45, 0.12, wallD+0.45]} />
      <R p={[0, 0.26, 0]} c={neutral} s={[wallW+0.15, 0.12, wallD+0.15]} />

      {/* ═══ 墙体 ═══ */}
      <R p={[0, wallH/2 + 0.32, 0]} c={neutral} s={[wallW, wallH, wallD]} />

      {/* ═══ 门（正面中央）═══ */}
      <Door p={[0, 0.32 + SCALE.doorHeight/2, wallD/2 + 0.03]} c={main} />

      {/* ═══ 门廊小遮阳棚 ═══ */}
      <R p={[0, 0.32 + SCALE.doorHeight + 0.15, wallD/2 + 0.25]} c={main} s={[SCALE.doorWidth+0.35, 0.08, 0.45]} />
      <Cyl p={[-SCALE.doorWidth/2-0.1, 0.32 + SCALE.doorHeight/2, wallD/2+0.35]} c="#C0B8A8" r={0.04} h={SCALE.doorHeight+0.2} />
      <Cyl p={[SCALE.doorWidth/2+0.1, 0.32 + SCALE.doorHeight/2, wallD/2+0.35]} c="#C0B8A8" r={0.04} h={SCALE.doorHeight+0.2} />

      {/* ═══ 窗户（极小，左右各一）═══ */}
      <Win p={[-wallW*0.28, wallH*0.72 + 0.32, wallD/2 + 0.03]} />
      <Win p={[wallW*0.28, wallH*0.72 + 0.32, wallD/2 + 0.03]} />
      {/* 侧面窗户 */}
      <Win p={[-wallW/2 - 0.03, wallH*0.72 + 0.32, 0]} />
      <Win p={[wallW/2 + 0.03, wallH*0.72 + 0.32, 0]} />

      {/* ═══ 屋顶（巨大化阶梯）═══ */}
      <Roof p={[0, wallH + 0.32 + roofH*0.18, 0]} c={main} w={roofW} h={roofH} d={roofW} />

      {/* ═══ 烟囱（倾斜可爱）═══ */}
      <group position={[wallW*0.22, wallH + roofH*0.6 + 0.32, -wallD*0.18]} rotation={[0, 0, 0.08]}>
        <Cyl p={[0, 0, 0]} c="#B0A090" r={0.13} h={0.7} />
        <Cyl p={[0, 0.38, 0]} c="#A09080" r={0.16} h={0.1} />
      </group>

      {/* ═══ 小装饰：花盆 ═══ */}
      <B p={[-wallW*0.4, 0.3, wallD/2 + 0.2]} c="#C49050" s={[0.22, 0.18, 0.22]} />
      <B p={[-wallW*0.4, 0.42, wallD/2 + 0.2]} c="#E8A0A0" s={[0.1, 0.1, 0.1]} />
      <B p={[wallW*0.4, 0.3, wallD/2 + 0.2]} c="#C49050" s={[0.22, 0.18, 0.22]} />
      <B p={[wallW*0.4, 0.42, wallD/2 + 0.2]} c="#A5D6A7" s={[0.1, 0.1, 0.1]} />

      {/* ═══ 标签 ═══ */}
      {hovered ? (
        <Html position={[0, wallH + roofH + 1.4, 0]} center>
          <div className="pointer-events-none whitespace-nowrap rounded-xl border border-surface-border bg-surface-elevated/95 px-4 py-2.5 shadow-2xl backdrop-blur">
            <p className="text-sm font-semibold text-text-primary">{title}</p>
            <p className="text-[11px] text-text-tertiary">{desc}</p>
          </div>
        </Html>
      ) : (
        <Html position={[0, -0.2, 0]} center>
          <div className="pointer-events-none whitespace-nowrap rounded-full bg-black/40 px-3 py-1 text-[11px] text-white">
            {title}
          </div>
        </Html>
      )}
    </group>
  );
}

/* 风车（英雄建筑） */
function Windmill({ pos, onHouseClick }: any) {
  const ref = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const bladeRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.y = pos[1] + Math.sin(clock.getElapsedTime()) * 0.015;
    }
    if (bladeRef.current) {
      bladeRef.current.rotation.z = clock.getElapsedTime() * 0.45;
    }
  });

  return (
    <group ref={ref} position={pos}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onHouseClick("center"); }}>

      {hovered && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI/2, 0, 0]}>
          <circleGeometry args={[2.0, 32]} />
          <meshBasicMaterial color={C.hero.main} transparent opacity={0.2} />
        </mesh>
      )}

      {/* 地台 */}
      <R p={[0, 0.08, 0]} c="#D8D0C0" s={[3.0, 0.16, 3.0]} />
      <R p={[0, 0.2, 0]} c={C.hero.neutral} s={[2.4, 0.12, 2.4]} />

      {/* 塔身 */}
      <Cyl p={[0, 1.4, 0]} c={C.hero.neutral} r={0.85} h={2.4} />

      {/* 塔顶 */}
      <Roof p={[0, 2.7, 0]} c={C.hero.main} w={2.0} h={1.1} d={2.0} />

      {/* 小窗 */}
      <Win p={[0, 1.9, 0.85]} />
      <Win p={[0, 1.9, -0.85]} />
      <Win p={[-0.85, 1.9, 0]} />
      <Win p={[0.85, 1.9, 0]} />

      {/* 风车叶片 */}
      <group ref={bladeRef} position={[0, 2.7, 1.15]}>
        <B p={[0, 0, 0]} c="#E8D8B8" s={[0.12, 2.6, 0.06]} />
        <B p={[0, 0, 0]} c="#E8D8B8" s={[2.6, 0.12, 0.06]} />
        <B p={[0, 1.15, 0.03]} c={C.hero.main} s={[0.55, 0.28, 0.04]} />
        <B p={[0, -1.15, 0.03]} c={C.hero.main} s={[0.55, 0.28, 0.04]} />
        <B p={[1.15, 0, 0.03]} c={C.hero.main} s={[0.28, 0.55, 0.04]} />
        <B p={[-1.15, 0, 0.03]} c={C.hero.main} s={[0.28, 0.55, 0.04]} />
        {/* 中心轴 */}
        <B p={[0, 0, 0.06]} c="#A09080" s={[0.15, 0.15, 0.12]} />
      </group>

      {/* 标签 */}
      {hovered ? (
        <Html position={[0, 4.3, 0]} center>
          <div className="pointer-events-none whitespace-nowrap rounded-xl border border-surface-border bg-surface-elevated/95 px-4 py-2.5 shadow-2xl backdrop-blur">
            <p className="text-sm font-semibold text-text-primary">天空主城</p>
            <p className="text-[11px] text-text-tertiary">世界指挥中枢</p>
          </div>
        </Html>
      ) : (
        <Html position={[0, -0.2, 0]} center>
          <div className="pointer-events-none whitespace-nowrap rounded-full bg-black/40 px-3 py-1 text-[11px] text-white">
            天空主城
          </div>
        </Html>
      )}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════
   环境系统
   ═══════════════════════════════════════════════════════ */

// 浮空岛
function FloatingIsland() {
  const blocks = useMemo(() => {
    const arr: { p: [number,number,number]; c: string; o: number; s: [number,number,number] }[] = [];
    const core = 11, mid = 15, outer = 19;

    for (let x = -outer; x <= outer; x++) {
      for (let z = -outer; z <= outer; z++) {
        const d = Math.max(Math.abs(x), Math.abs(z));
        if (d > outer) continue;

        if (d <= core/2) {
          const v = Math.sin(x*0.35)*Math.cos(z*0.35)*0.12;
          arr.push({ p: [x, -0.4+v, z], c: C.grass, o: 1, s: [1, 1, 1] });
          arr.push({ p: [x, -1.4+v, z], c: C.dirt, o: 1, s: [1, 1, 1] });
        }
        else if (d <= mid/2) {
          const f = 1 - (d - core/2) / ((mid-core)/2);
          arr.push({ p: [x, -0.4, z], c: "#D8D8C0", o: f*0.5, s: [1,0.8,1] });
        }
        else {
          const f = 1 - (d - mid/2) / ((outer-mid)/2);
          if (f > 0) arr.push({ p: [x, -0.4, z], c: "#E8E8D8", o: f*0.2, s: [1,0.6,1] });
        }
      }
    }

    for (let x = -outer; x <= outer; x++) {
      for (let z = -outer; z <= outer; z++) {
        const d = Math.max(Math.abs(x), Math.abs(z));
        if (d === outer) {
          arr.push({ p: [x, -2.0, z], c: "#B8A880", o: 0.5, s: [1, 0.8, 1] });
          arr.push({ p: [x, -2.6, z], c: "#A89870", o: 0.3, s: [1, 0.6, 1] });
        }
      }
    }
    return arr;
  }, []);

  return (
    <group>
      {blocks.map((b, i) => (
        <mesh key={i} position={b.p} castShadow receiveShadow>
          <boxGeometry args={b.s} />
          <meshToonMaterial color={b.c} transparent opacity={b.o} />
        </mesh>
      ))}
    </group>
  );
}

// 3种树型
function TreeTall({ p, sc = 1 }: any) {
  return (
    <group position={p} scale={sc}>
      <Cyl p={[0, 0.5, 0]} c={C.wood} r={0.14} h={1.0} />
      <R p={[0, 1.6, 0]} c="#7CB342" s={[1.2, 1.0, 1.2]} />
      <R p={[0, 2.2, 0]} c="#8BC34A" s={[0.9, 0.85, 0.9]} />
      <R p={[0, 2.7, 0]} c="#AED581" s={[0.55, 0.6, 0.55]} />
    </group>
  );
}
function TreeRound({ p, sc = 1 }: any) {
  return (
    <group position={p} scale={sc}>
      <Cyl p={[0, 0.35, 0]} c={C.wood} r={0.16} h={0.7} />
      <R p={[0, 1.25, 0]} c="#8BC34A" s={[1.4, 1.2, 1.4]} />
      <R p={[0, 1.9, 0]} c="#7CB342" s={[1.0, 0.85, 1.0]} />
    </group>
  );
}
function TreeBush({ p, sc = 1 }: any) {
  return (
    <group position={p} scale={sc}>
      <Cyl p={[0, 0.25, 0]} c={C.wood} r={0.09} h={0.4} />
      <R p={[0, 0.75, 0]} c="#AED581" s={[0.8, 0.7, 0.8]} />
      <R p={[0.15, 0.85, 0.1]} c="#8BC34A" s={[0.45, 0.35, 0.45]} />
    </group>
  );
}
function Trees() {
  const data = useMemo(() => [
    { t: "tall", p: [-9, 0, -5], r: 0.3, s: 1.1 },
    { t: "round", p: [9, 0, -5], r: 1.2, s: 0.9 },
    { t: "bush", p: [-10, 0, 3], r: 0.8, s: 1.0 },
    { t: "tall", p: [10, 0, 3], r: 2.1, s: 0.85 },
    { t: "round", p: [0, 0, 9], r: 0.5, s: 1.15 },
    { t: "bush", p: [-7, 0, 8], r: 1.8, s: 0.95 },
    { t: "tall", p: [7, 0, 8], r: 0.2, s: 1.05 },
    { t: "round", p: [-8, 0, 1], r: 3.0, s: 0.8 },
    { t: "bush", p: [8, 0, -1], r: 0.6, s: 1.1 },
    { t: "bush", p: [-4, 0, -8], r: 1.5, s: 0.7 },
    { t: "round", p: [4, 0, -8], r: 2.5, s: 0.8 },
    { t: "tall", p: [-9, 0, -1], r: 0.9, s: 0.9 },
    { t: "round", p: [9, 0, -1], r: 1.8, s: 0.85 },
    { t: "bush", p: [-2, 0, 9], r: 0.3, s: 1.0 },
    { t: "bush", p: [2, 0, 9], r: 1.1, s: 0.9 },
  ], []);
  return (
    <group>
      {data.map((d: any, i: number) => (
        <group key={i} rotation={[0, d.r, 0]}>
          {d.t === "tall" && <TreeTall p={d.p} sc={d.s} />}
          {d.t === "round" && <TreeRound p={d.p} sc={d.s} />}
          {d.t === "bush" && <TreeBush p={d.p} sc={d.s} />}
        </group>
      ))}
    </group>
  );
}

// 微小装饰
function Decorations() {
  const data = useMemo(() => {
    const arr: any[] = [];
    const stones = [[-2,0.1,-1],[2.5,0.1,1.5],[-1.5,0.1,2.5],[3,0.1,-2],[-3.5,0.1,0.5],[1,0.1,3],[-0.5,0.1,-3.5],[4.5,0.1,0],[-4,0.1,-3],[2,0.1,4],[-5,0.1,-1],[5,0.1,2],[0,0.1,-5],[-3,0.1,5]];
    stones.forEach((p: any, i: number) => arr.push({ t: "box", p, c: ["#C8C4B8","#B8B4A8","#D0CCC0","#A8A090"][i%4], s: [0.15+Math.random()*0.1, 0.12+Math.random()*0.08, 0.15+Math.random()*0.1] }));
    const grasses = [[-1,0.1,1],[3,0.1,-1],[-2,0.1,3],[1,0.1,-2],[4,0.1,2],[-4,0.1,-2],[0.5,0.1,3.5],[-3,0.1,1.5],[2,0.1,-3.5],[-1.5,0.1,-1.5],[3.5,0.1,3.5],[-0.5,0.1,0.5],[5,0.1,0],[-5,0.1,3],[-6,0.1,-4],[6,0.1,-4]];
    grasses.forEach((p: any, i: number) => arr.push({ t: "box", p: [p[0], 0.05, p[2]], c: ["#A8D878","#98D068","#B8E088"][i%3], s: [0.08, 0.15+Math.random()*0.1, 0.08] }));
    const flowers = [[1.5,0.1,2],[-2.5,0.1,-0.5],[0,0.1,-1.5],[3.5,0.1,-3],[-4,0.1,3],[2,0.1,4],[-1,0.1,-4],[4,0.1,-1],[-3,0.1,4],[0.5,0.1,5],[-5,0.1,1],[5,0.1,-2]];
    flowers.forEach((p: any, i: number) => {
      arr.push({ t: "box", p: [p[0], 0.08, p[2]], c: ["#FFE082","#FFAB91","#CE93D8","#A5D6A7"][i%4], s: [0.08, 0.08, 0.08] });
      arr.push({ t: "box", p: [p[0], 0.02, p[2]], c: "#7CB342", s: [0.03, 0.08, 0.03] });
    });
    arr.push({ t: "box", p: [2.8, 0.2, 2.8], c: "#C49050", s: [0.25, 0.35, 0.25] });
    arr.push({ t: "box", p: [-2.5, 0.2, -2.8], c: "#B48040", s: [0.22, 0.3, 0.22] });
    arr.push({ t: "box", p: [0, 0.2, 5.5], c: "#C49050", s: [0.25, 0.35, 0.25] });
    arr.push({ t: "box", p: [-5, 0.2, 0], c: "#B48040", s: [0.22, 0.3, 0.22] });
    // 栅栏
    [[6.5,0.25,0],[6.5,0.25,1],[6.5,0.25,2],[-6.5,0.25,0],[-6.5,0.25,-1],[-6.5,0.25,-2],[0,0.25,6.5],[1,0.25,6.5]].forEach((p: any) => arr.push({ t: "box", p, c: "#C4A882", s: [0.06, 0.4, 0.06] }));
    // 小桥
    arr.push({ t: "box", p: [0, 0.08, 6.5], c: "#D0C8B8", s: [2, 0.12, 0.6] });
    return arr;
  }, []);

  return (
    <group>
      {data.map((d: any, i: number) => (
        <B key={i} p={d.p} c={d.c} s={d.s} />
      ))}
    </group>
  );
}

// 石板路
function Paths() {
  const pts = useMemo(() => {
    const arr: [number,number,number][] = [];
    const r = 4.5;
    for (let i = 0; i < 32; i++) {
      const a = (i/32) * Math.PI * 2;
      arr.push([Math.cos(a)*r + (Math.random()-0.5)*0.2, 0.02, Math.sin(a)*r + (Math.random()-0.5)*0.2]);
    }
    [[-6,-3],[0,-6.5],[6,-3],[-6,4],[6,4],[0,6.5]].forEach(([tx,tz]: any) => {
      for (let i = 1; i < 7; i++) {
        const t = i/7;
        arr.push([tx*t*0.7 + (Math.random()-0.5)*0.1, 0.02, tz*t*0.7 + (Math.random()-0.5)*0.1]);
      }
    });
    return arr;
  }, []);

  return (
    <group>
      {pts.map((p: any, i: number) => (
        <mesh key={i} position={p} receiveShadow>
          <boxGeometry args={[0.4+Math.random()*0.15, 0.04, 0.4+Math.random()*0.15]} />
          <meshToonMaterial color={C.stone} />
        </mesh>
      ))}
    </group>
  );
}

// 瀑布
function Waterfall({ p }: { p: [number,number,number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const mat = ref.current.material as THREE.MeshToonMaterial;
      mat.opacity = 0.5 + Math.sin(clock.getElapsedTime() * 2) * 0.15;
    }
  });

  return (
    <group position={p}>
      <mesh ref={ref} position={[0, -1.2, 0]}>
        <boxGeometry args={[1.8, 3.5, 0.3]} />
        <meshToonMaterial color={C.water} transparent opacity={0.6} />
      </mesh>
      <B p={[0, -3.0, 0]} c="#A8D8F0" s={[2.5, 0.15, 1.5]} o={0.5} />
    </group>
  );
}

// 云
function Cloud({ p, speed = 0.1 }: any) {
  const ref = useRef<THREE.Group>(null);
  const off = useRef(Math.random() * Math.PI * 2);

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.position.x = p[0] + Math.sin(clock.getElapsedTime() * speed + off.current) * 0.8;
    }
  });

  return (
    <group ref={ref} position={p}>
      <R p={[0,0,0]} c={C.cloud} s={[2.2, 0.6, 1.2]} />
      <R p={[0.8, 0.1, 0]} c={C.cloud} s={[1.5, 0.5, 1.0]} />
      <R p={[-0.7, 0.05, 0.2]} c={C.cloud} s={[1.4, 0.5, 0.9]} />
    </group>
  );
}

// 星星
function Stars() {
  const data = useMemo(() => {
    const arr: { p: [number,number,number]; s: number }[] = [];
    for (let i = 0; i < 150; i++) {
      arr.push({
        p: [(Math.random() - 0.5) * 60, 8 + Math.random() * 22, (Math.random() - 0.5) * 60],
        s: 0.02 + Math.random() * 0.04,
      });
    }
    return arr;
  }, []);

  return (
    <group>
      {data.map((s, i) => (
        <mesh key={i} position={s.p}>
          <boxGeometry args={[s.s, s.s, s.s]} />
          <meshBasicMaterial color="#FFFFFF" />
        </mesh>
      ))}
    </group>
  );
}

// 小浮岛
function MiniIsland({ p }: { p: [number,number,number] }) {
  return (
    <group position={p}>
      <R p={[0, 0, 0]} c={C.grass} s={[2, 0.4, 2]} />
      <R p={[0, -0.4, 0]} c={C.dirt} s={[1.8, 0.3, 1.8]} />
      <R p={[0, -0.7, 0]} c="#B8A880" s={[1.5, 0.2, 1.5]} />
    </group>
  );
}

/* ═══════════════════════════════════════════════════════
   主场景
   ═══════════════════════════════════════════════════════ */
export default function VoxelScene({ onHouseClick }: { onHouseClick: (key: string) => void }) {
  return (
    <>
      {/* 光照：月光夜景 */}
      <ambientLight intensity={0.25} color="#A0B8E0" />
      <directionalLight position={[12, 25, 10]} intensity={0.9} color="#D8E4F8" castShadow
        shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-far={50} shadow-camera-left={-18} shadow-camera-right={18}
        shadow-camera-top={18} shadow-camera-bottom={-18} />
      <directionalLight position={[-8, 12, -8]} intensity={0.15} color="#8098C8" />
      <hemisphereLight color="#6068A0" groundColor="#2A2840" intensity={0.25} />

      {/* AO 接触阴影 */}
      <ContactShadows position={[0, -2.8, 0]} opacity={0.45} scale={45} blur={2} far={5} color="#1A1830" />

      {/* 夜空雾 */}
      <fog attach="fog" args={["#1E1E3A", 28, 55]} />
      <color attach="background" args={["#1E1E3A"]} />

      {/* 星星 */}
      <Stars />

      {/* 主浮岛 */}
      <FloatingIsland />

      {/* 小浮岛 */}
      <MiniIsland p={[-12, -1, -9]} />
      <MiniIsland p={[12, -1.5, -8]} />
      <MiniIsland p={[-10, -2, 10]} />
      <MiniIsland p={[11, -1, 9]} />
      <MiniIsland p={[0, -2.5, -12]} />

      {/* 瀑布 */}
      <Waterfall p={[-8, 0, 6]} />

      {/* 道路 */}
      <Paths />

      {/* 风车（中心） */}
      <Windmill pos={[0, 0.3, 0]} onHouseClick={onHouseClick} />

      {/* 六座小房子（环绕，更展开） */}
      <ToyHouse pos={[-SCALE.spacing, 0, -3]} colors={C.blue} w={2.2} onHouseClick={onHouseClick} houseKey="upload" title="上传屋" desc="PDF、图片、文档上传" />
      <ToyHouse pos={[SCALE.spacing, 0, -3]} colors={C.green} w={2.2} onHouseClick={onHouseClick} houseKey="study" title="游戏屋" desc="文件变成互动卡片" />
      <ToyHouse pos={[0, 0, -SCALE.spacing]} colors={C.teal} w={2.3} onHouseClick={onHouseClick} houseKey="convert" title="转换坊" desc="摘要与格式转换" />
      <ToyHouse pos={[-SCALE.spacing, 0, 4]} colors={C.pink} w={2.1} onHouseClick={onHouseClick} houseKey="image-gen" title="花园" desc="图文卡片与长图" />
      <ToyHouse pos={[SCALE.spacing, 0, 4]} colors={C.purple} w={2.1} onHouseClick={onHouseClick} houseKey="image-edit" title="图库" desc="图片编辑与美化" />
      <ToyHouse pos={[0, 0, SCALE.spacing]} colors={C.orange} w={2.2} onHouseClick={onHouseClick} houseKey="tools" title="工具箱" desc="更多实用工具" />

      {/* 树木 */}
      <Trees />

      {/* 装饰 */}
      <Decorations />

      {/* 云 */}
      <Cloud p={[-9, 10, -5]} speed={0.08} />
      <Cloud p={[7, 11, -6]} speed={0.06} />
      <Cloud p={[0, 12, 8]} speed={0.09} />
      <Cloud p={[-12, 9, 7]} speed={0.07} />
      <Cloud p={[11, 10, 5]} speed={0.08} />
      <Cloud p={[5, 13, -9]} speed={0.05} />

      {/* 控制器 */}
      <OrbitControls enablePan enableZoom enableRotate
        minPolarAngle={Math.PI/6} maxPolarAngle={Math.PI/2.2}
        minDistance={10} maxDistance={50} target={[0, 2, 0]}
        autoRotate autoRotateSpeed={0.1} />
    </>
  );
}
