import { describe, expect, it } from 'vitest';
import { d, tgpu } from 'typegpu';
import {
  sdCappedTorus,
  sdCone,
  sdEllipsoid,
  sdgHexagon2d,
  sdHexagon2d,
  sdOctahedron,
  sdRoundCone,
  sdTorus,
} from '../src/index.ts';

const SQRT3 = Math.sqrt(3);

describe('sdTorus', () => {
  it('is zero on the surface, negative inside the tube and positive outside', () => {
    expect(sdTorus(d.vec3f(1.25, 0, 0), 1, 0.25)).toBeCloseTo(0);
    expect(sdTorus(d.vec3f(0, 0.25, -1), 1, 0.25)).toBeCloseTo(0);
    expect(sdTorus(d.vec3f(1, 0, 0), 1, 0.25)).toBeCloseTo(-0.25);
    expect(sdTorus(d.vec3f(0, 0, 0), 1, 0.25)).toBeCloseTo(0.75);
    expect(sdTorus(d.vec3f(0, 0, 2), 1, 0.25)).toBeCloseTo(0.75);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdTorus])).toMatchInlineSnapshot(`
      "fn sdTorus(point: vec3f, majorRadius: f32, minorRadius: f32) -> f32 {
        let q = vec2f((length(point.xz) - majorRadius), point.y);
        return (length(q) - minorRadius);
      }"
    `);
  });
});

describe('sdCappedTorus', () => {
  // a half torus: the arc spans 90 degrees to each side of (0, majorRadius)
  const sc = d.vec2f(1, 0);

  it('matches a full torus section inside the arc', () => {
    expect(sdCappedTorus(d.vec3f(0, 1.25, 0), sc, 1, 0.25)).toBeCloseTo(0);
    expect(sdCappedTorus(d.vec3f(0, 1, 0), sc, 1, 0.25)).toBeCloseTo(-0.25);
    expect(sdCappedTorus(d.vec3f(1, 0, 0.25), sc, 1, 0.25)).toBeCloseTo(0);
  });

  it('measures from the cap end when outside the arc', () => {
    const quarter = d.vec2f(Math.SQRT1_2, Math.SQRT1_2);
    // the cap end of a 45 degree half-angle arc sits at (r * sin, r * cos)
    const end = d.vec3f(Math.SQRT1_2, Math.SQRT1_2, 0);
    expect(sdCappedTorus(end, quarter, 1, 0.25)).toBeCloseTo(-0.25);
    expect(sdCappedTorus(d.vec3f(1, -1, 0), quarter, 1, 0.25)).toBeCloseTo(
      Math.hypot(1 - Math.SQRT1_2, -1 - Math.SQRT1_2) - 0.25,
    );
  });

  it('is symmetric in x', () => {
    const p = d.vec3f(0.6, 0.4, 0.1);
    expect(sdCappedTorus(p, sc, 1, 0.25)).toBeCloseTo(
      sdCappedTorus(d.vec3f(-0.6, 0.4, 0.1), sc, 1, 0.25),
    );
  });

  it('stays accurate for a tube much thinner than the torus', () => {
    // a large ratio makes the cancellation of an expanded |p|^2 + ra^2 - 2 * ra * k form show
    // up even in the f64 math these CPU tests run with
    expect(sdCappedTorus(d.vec3f(0, 1e8, 1e-4), sc, 1e8, 1e-4)).toBeCloseTo(0, 7);
    expect(sdCappedTorus(d.vec3f(0, 1e8, 3e-4), sc, 1e8, 1e-4)).toBeCloseTo(2e-4, 7);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdCappedTorus])).toMatchInlineSnapshot(`
      "fn sdCappedTorus(point: vec3f, sc: vec2f, majorRadius: f32, minorRadius: f32) -> f32 {
        let p = vec3f(abs(point.x), point.yz);
        let dist = select(length(vec2f((length(p.xy) - majorRadius), p.z)), length(vec3f((p.xy - (sc * majorRadius)), p.z)), ((sc.y * p.x) > (sc.x * p.y)));
        return (dist - minorRadius);
      }"
    `);
  });
});

describe('sdHexagon2d', () => {
  it('is zero on edge midpoints and corners, negative inside, positive outside', () => {
    expect(sdHexagon2d(d.vec2f(0, 1), 1)).toBeCloseTo(0);
    expect(sdHexagon2d(d.vec2f(0, -1), 1)).toBeCloseTo(0);
    // slanted edge midpoint, 60 degrees from the top one
    expect(sdHexagon2d(d.vec2f(SQRT3 / 2, 0.5), 1)).toBeCloseTo(0);
    // corner: circumradius = inradius * 2 / sqrt(3)
    expect(sdHexagon2d(d.vec2f(2 / SQRT3, 0), 1)).toBeCloseTo(0);
    expect(sdHexagon2d(d.vec2f(0, 0), 1)).toBeCloseTo(-1);
    expect(sdHexagon2d(d.vec2f(0, 3), 1)).toBeCloseTo(2);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdHexagon2d])).toMatchInlineSnapshot(`
      "fn sdHexagon2d(point: vec2f, radius: f32) -> f32 {
        let k = vec3f(-0.8660253882408142, 0.5, 0.5773502588272095);
        var p = abs(point);
        p -= (k.xy * (2f * min(dot(k.xy, p), 0f)));
        p -= vec2f(clamp(p.x, (-(k.z) * radius), (k.z * radius)), radius);
        return (length(p) * sign(p.y));
      }"
    `);
  });
});

describe('sdgHexagon2d', () => {
  // wrapped in objects, since `it.each` would spread a bare vector into its components
  const points = [
    { x: 0.1, y: 1.7 },
    { x: 1.6, y: 0.3 },
    { x: -1.2, y: -1.1 },
    { x: 0.3, y: 0.2 },
    { x: -0.5, y: 0.6 },
    { x: 0.9, y: -0.2 },
  ].map(({ x, y }) => ({ x, y, p: d.vec2f(x, y) }));

  it.each(points)('matches sdHexagon2d at ($x, $y)', ({ p }) => {
    expect(sdgHexagon2d(p, 1).x).toBeCloseTo(sdHexagon2d(p, 1), 5);
  });

  it.each(points)('returns the finite-difference gradient at ($x, $y)', ({ p }) => {
    const h = 1e-3;
    const gx =
      (sdHexagon2d(d.vec2f(p.x + h, p.y), 1) - sdHexagon2d(d.vec2f(p.x - h, p.y), 1)) / (2 * h);
    const gy =
      (sdHexagon2d(d.vec2f(p.x, p.y + h), 1) - sdHexagon2d(d.vec2f(p.x, p.y - h), 1)) / (2 * h);
    const result = sdgHexagon2d(p, 1);
    expect(result.y).toBeCloseTo(gx, 2);
    expect(result.z).toBeCloseTo(gy, 2);
    expect(Math.hypot(result.y, result.z)).toBeCloseTo(1, 4);
  });

  it('keeps a unit gradient for tiny hexagons', () => {
    const result = sdgHexagon2d(d.vec2f(0, 2e-9), 1e-9);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(1);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdgHexagon2d])).toMatchInlineSnapshot(`
      "fn sdgHexagon2d(point: vec2f, radius: f32) -> vec3f {
        let k = vec3f(-0.8660253882408142, 0.5, 0.5773502588272095);
        let s = sign(point);
        var p = abs(point);
        let w = dot(k.xy, p);
        p -= (k.xy * (2f * min(w, 0f)));
        p -= vec2f(clamp(p.x, (-(k.z) * radius), (k.z * radius)), radius);
        let d = (length(p) * sign(p.y));
        let g = select(p, vec2f(((-(k.y) * p.x) - (k.x * p.y)), ((-(k.x) * p.x) + (k.y * p.y))), (w < 0f));
        return vec3f(d, ((s * g) / d));
      }"
    `);
  });
});

describe('sdCone', () => {
  // a 90 degree cone: base radius equals the height
  const sc = d.vec2f(Math.SQRT1_2, Math.SQRT1_2);

  it('is zero at the tip, on the base rim and on the base, negative inside, positive outside', () => {
    expect(sdCone(d.vec3f(0, 0, 0), sc, 1)).toBeCloseTo(0);
    expect(sdCone(d.vec3f(1, -1, 0), sc, 1)).toBeCloseTo(0);
    expect(sdCone(d.vec3f(0, -1, 0), sc, 1)).toBeCloseTo(0);
    // closer to the slanted side (0.5 / sqrt(2)) than to the base (0.5)
    expect(sdCone(d.vec3f(0, -0.5, 0), sc, 1)).toBeCloseTo(-0.5 * Math.SQRT1_2);
    expect(sdCone(d.vec3f(0, 1, 0), sc, 1)).toBeCloseTo(1);
    expect(sdCone(d.vec3f(0, -2, 0), sc, 1)).toBeCloseTo(1);
    expect(sdCone(d.vec3f(2, -1, 0), sc, 1)).toBeCloseTo(1);
  });

  it('is rotationally symmetric around Y', () => {
    expect(sdCone(d.vec3f(0.3, -0.4, 0.4), sc, 1)).toBeCloseTo(
      sdCone(d.vec3f(0.5, -0.4, 0), sc, 1),
    );
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdCone])).toMatchInlineSnapshot(`
      "fn sdCone(point: vec3f, sc: vec2f, height: f32) -> f32 {
        let q = (vec2f((sc.x / sc.y), -1f) * height);
        let w = vec2f(length(point.xz), point.y);
        let a = (w - (q * clamp((dot(w, q) / dot(q, q)), 0f, 1f)));
        let b = (w - (q * vec2f(clamp((w.x / q.x), 0f, 1f), 1f)));
        let s = max(((w.y * q.x) - (w.x * q.y)), (q.y - w.y));
        return (sqrt(min(dot(a, a), dot(b, b))) * sign(s));
      }"
    `);
  });
});

describe('sdRoundCone', () => {
  it('is zero at the extreme points, negative inside, positive outside', () => {
    expect(sdRoundCone(d.vec3f(0, -0.5, 0), 0.5, 0.25, 1)).toBeCloseTo(0);
    expect(sdRoundCone(d.vec3f(0, 1.25, 0), 0.5, 0.25, 1)).toBeCloseTo(0);
    expect(sdRoundCone(d.vec3f(0, 0, 0), 0.5, 0.25, 1)).toBeCloseTo(-0.5);
    expect(sdRoundCone(d.vec3f(0, 2, 0), 0.5, 0.25, 1)).toBeCloseTo(0.75);
    expect(sdRoundCone(d.vec3f(0, -1.5, 0), 0.5, 0.25, 1)).toBeCloseTo(1);
  });

  it('becomes a capsule when both radii are equal', () => {
    expect(sdRoundCone(d.vec3f(0.3, 0.5, 0), 0.3, 0.3, 1)).toBeCloseTo(0);
    expect(sdRoundCone(d.vec3f(1, 0.5, 0), 0.3, 0.3, 1)).toBeCloseTo(0.7);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdRoundCone])).toMatchInlineSnapshot(`
      "fn sdRoundCone(point: vec3f, bottomRadius: f32, topRadius: f32, height: f32) -> f32 {
        let b = ((bottomRadius - topRadius) / height);
        let a = sqrt((1f - (b * b)));
        let q = vec2f(length(point.xz), point.y);
        let k = dot(q, vec2f(-(b), a));
        return select(select((dot(q, vec2f(a, b)) - bottomRadius), (length((q - vec2f(0f, height))) - topRadius), (k > (a * height))), (length(q) - bottomRadius), (k < 0f));
      }"
    `);
  });
});

describe('sdOctahedron', () => {
  it('is zero on vertices and face centers, negative inside, positive outside', () => {
    expect(sdOctahedron(d.vec3f(1, 0, 0), 1)).toBeCloseTo(0);
    expect(sdOctahedron(d.vec3f(0, 0, -1), 1)).toBeCloseTo(0);
    expect(sdOctahedron(d.vec3f(1 / 3, 1 / 3, 1 / 3), 1)).toBeCloseTo(0);
    expect(sdOctahedron(d.vec3f(0, 0, 0), 1)).toBeCloseTo(-1 / SQRT3);
  });

  it('measures to the nearest vertex, edge or face outside', () => {
    expect(sdOctahedron(d.vec3f(2, 0, 0), 1)).toBeCloseTo(1);
    // nearest point is the middle of the edge between (1, 0, 0) and (0, 1, 0)
    expect(sdOctahedron(d.vec3f(1, 1, 0), 1)).toBeCloseTo(Math.SQRT1_2);
    expect(sdOctahedron(d.vec3f(1, 1, 1), 1)).toBeCloseTo(2 / SQRT3);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdOctahedron])).toMatchInlineSnapshot(`
      "fn sdOctahedron(point: vec3f, size: f32) -> f32 {
        let p = abs(point);
        let m = (((p.x + p.y) + p.z) - size);
        if (((((3f * p.x) >= m) && ((3f * p.y) >= m)) && ((3f * p.z) >= m))) {
          return (m * 0.57735027f);
        }
        let q = select(select(p.zxy, p.yzx, ((3f * p.y) < m)), p, ((3f * p.x) < m));
        let k = clamp((0.5f * ((q.z - q.y) + size)), 0f, size);
        return length(vec3f(q.x, ((q.y - size) + k), (q.z - k)));
      }"
    `);
  });
});

describe('sdEllipsoid', () => {
  const radii = d.vec3f(2, 1, 0.5);

  it('is zero on the surface, negative inside, positive outside', () => {
    expect(sdEllipsoid(d.vec3f(2, 0, 0), radii)).toBeCloseTo(0);
    expect(sdEllipsoid(d.vec3f(0, -1, 0), radii)).toBeCloseTo(0);
    expect(sdEllipsoid(d.vec3f(0, 0, 0.5), radii)).toBeCloseTo(0);
    expect(sdEllipsoid(d.vec3f(1, 0, 0), radii)).toBeLessThan(0);
    expect(sdEllipsoid(d.vec3f(0, 0, 1), radii)).toBeGreaterThan(0);
  });

  it('is exact for a sphere', () => {
    expect(sdEllipsoid(d.vec3f(0, 2, 0), d.vec3f(1))).toBeCloseTo(1);
    expect(sdEllipsoid(d.vec3f(0, 0.5, 0), d.vec3f(1))).toBeCloseTo(-0.5);
  });

  it('resolves to WGSL', () => {
    expect(tgpu.resolve([sdEllipsoid])).toMatchInlineSnapshot(`
      "fn sdEllipsoid(point: vec3f, radii: vec3f) -> f32 {
        let k0 = length((point / radii));
        let k1 = length((point / (radii * radii)));
        return ((k0 * (k0 - 1f)) / k1);
      }"
    `);
  });
});
