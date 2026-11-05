const DATA = {
  world: "data/countries-all-50m.json",
  us: "data/us-states-10m.geojson",
};

const SKIP_ADM = new Set([
  "IOA", "HMD", "NFK", "ATC",
  "MAC", "HKG",
  "FRO", "ALD",
  "SPM", "WLF", "MAF", "BLM", "PYF", "NCL", "ATF",
  "ABW", "CUW", "SXM",
  "NIU", "COK",
  "SGS", "IOT", "SHN", "PCN", "AIA", "FLK", "CYM", "BMU", "VGB", "TCA", "MSR", "JEY", "GGY", "IMN",
  "MNP", "VIR", "GUM", "ASM", "PRI",
  "ATA", "KAS", "SOL", "CYN",
  "RUS", "KOS",
]);

const RENAME = { CHN: "Chine" };

const MIN_AREA_KM2 = 20000;
const MIN_WORLD_POINTS = 40;
const MIN_PART_RATIO = 0.008;
const MAX_LINK_DEG = 13;
const MAX_FROM_MAIN_DEG = 13.2;
const EARTH_RADIUS_KM = 6371.0088;

// Both countries start fitted in the largest square the shelves can hold.
// On a wide screen that square is capped so country 2 still has room to grow.
// Country 2 can still be grown past that square; the floor only keeps a shrink from vanishing.
const MIN_SCALE = 0.02;
const DESKTOP_SQUARE_CAP = 460;

const PACES = {
  20000: "20 secondes par manche. Le plus petit score gagne.",
  10000: "10 secondes par manche. Le plus petit score gagne.",
  5000: "5 secondes par manche. Le plus petit score gagne.",
};

const $ = (id) => document.getElementById(id);

const ui = {
  load: $("load-overlay"),
  loadText: $("load-text"),
  loadFill: $("load-bar-fill"),
  intro: $("intro-modal"),
  lead: $("intro-lead"),
  rules: $("rules-note"),
  start: $("btn-start"),
  timerBlock: $("timer-block"),
  timerBar: $("timer-bar"),
  timerFill: $("timer-fill"),
  timerValue: $("timer-value"),
  play: $("play"),
  kicker: $("round-kicker"),
  dockRound: $("dock-round"),
  history: $("history"),
  stage: $("stage"),
  shelfRef: $("shelf-ref"),
  shelfTarget: $("shelf-target"),
  slotTarget: $("slot-target"),
  pathRef: $("path-ref"),
  pathGuess: $("path-guess"),
  pathTruth: $("path-truth"),
  pathTruthHalo: $("path-truth-halo"),
  truthScaler: $("truth-scaler"),
  truthTip: $("truth-tip"),
  resizeTip: $("resize-tip"),
  guessScaler: $("guess-scaler"),
  nameRef: $("name-ref"),
  nameTarget: $("name-target"),
  dock: document.querySelector(".dock-card"),
  dockTimeout: $("dock-timeout"),
  dockKicker: $("dock-kicker"),
  dockHelp: $("dock-help"),
  dockScore: $("dock-score"),
  dockRemark: $("dock-remark"),
  dockDetail: $("dock-detail"),
  dockAreas: $("dock-areas"),
  validate: $("btn-validate"),
  finish: $("finish-modal"),
  finalScore: $("final-score"),
  recap: $("finish-recap"),
  replay: $("btn-replay"),
  handles: [...document.querySelectorAll(".handle")],
};

const settings = { territory: "world", length: 5, roundMs: 20000 };
const LEADS = {
  world: "Saurez-vous remettre le pays à la bonne taille ?",
  us: "Saurez-vous remettre l’État à sa bonne taille ?",
};
let catalogs = null;
let limits = { square: 220, minScale: MIN_SCALE, maxScale: 1.65 };
let rounds = [];
let plan = [];
let index = 0;
let round = null;
let scale = 1;
let locked = false;
let timerFrame = 0;
let roundEndsAt = 0;
let drag = null;
let pinch = null;
const pointers = new Map();

function normName(value) {
  return String(value || "")
    .replace(/^État de /, "")
    .replace(/^Etat de /, "");
}

// Masculine names that end in -e, so the usual "ends with e → feminine" rule does not apply.
const MASCULINE_E = new Set([
  "Belize", "Cambodge", "Mexique", "Mozambique", "Suriname", "Zimbabwe",
  "Maine", "Nouveau-Mexique", "New Hampshire", "Tennessee",
]);

// Feminine names that do not end in -e.
const FEMININE_OTHER = new Set([
  "Afrique du Sud",
  "Corée du Sud",
  "Corée du Nord",
  "Macédoine du Nord",
  "Guinée-Bissau",
  "République démocratique du Congo",
  "République du Congo",
  "Caroline du Nord",
  "Caroline du Sud",
]);

// Names French uses with no article: "Redimensionnez Cuba", "Cuba est plus grand".
const NO_ARTICLE = new Set([
  "Antigua-et-Barbuda",
  "Bahreïn",
  "Chypre",
  "Cuba",
  "Djibouti",
  "Haïti",
  "Israël",
  "Madagascar",
  "Malte",
  "Maurice",
  "Monaco",
  "Oman",
  "Saint-Christophe-et-Niévès",
  "Saint-Marin",
  "Saint-Vincent-et-les-Grenadines",
  "Sainte-Hélène",
  "Sainte-Lucie",
  "Sao Tomé-et-Principe",
  "Singapour",
  "Trinité-et-Tobago",
]);

const PLURAL = new Map([
  ["Bahamas", "f"],
  ["Bermudes", "f"],
  ["Comores", "f"],
  ["Émirats arabes unis", "m"],
  ["États fédérés de Micronésie", "m"],
  ["États-Unis", "m"],
  ["Fidji", "m"],
  ["Maldives", "f"],
  ["Palaos", "m"],
  ["Pays-Bas", "m"],
  ["Philippines", "f"],
  ["Samoa", "m"],
  ["Samoa américaines", "f"],
  ["Seychelles", "f"],
  ["Tonga", "m"],
]);

const MUTE_H = new Set(["Hawaï"]);

function grammarOf(name) {
  if (/^[iî]les\b/i.test(name)) return { gender: "f", number: 2, article: "les" };
  if (PLURAL.has(name)) return { gender: PLURAL.get(name), number: 2, article: "les" };
  const feminine = FEMININE_OTHER.has(name) || (/e$/i.test(name) && !MASCULINE_E.has(name));
  const gender = feminine ? "f" : "m";
  if (NO_ARTICLE.has(name)) return { gender, number: 1, article: "" };
  const elide = MUTE_H.has(name) || /^[AEIOUÉÈÊËÀÂÎÏÔÛÙÜŒÆ]/.test(name);
  return { gender, number: 1, article: elide ? "l’" : (gender === "f" ? "la" : "le") };
}

function withArticle(name, cap) {
  const { article } = grammarOf(name);
  if (!article) return name;
  if (article === "l’") return `${cap ? "L’" : "l’"}${name}`;
  const shown = cap ? article.charAt(0).toUpperCase() + article.slice(1) : article;
  return `${shown} ${name}`;
}

function sizeWord(gender, number, bigger) {
  if (number === 2) {
    if (gender === "f") return bigger ? "grandes" : "petites";
    return bigger ? "grands" : "petits";
  }
  if (gender === "f") return bigger ? "grande" : "petite";
  return bigger ? "grand" : "petit";
}

function possessive(name) {
  const { gender, number } = grammarOf(name);
  if (number === 2) return `Tes ${name}`;
  const vowel = MUTE_H.has(name) || /^[AEIOUÉÈÊËÀÂÎÏÔÛÙÜŒÆ]/.test(name);
  if (gender === "f" && !vowel) return `Ta ${name}`;
  return `Ton ${name}`;
}

function realLabel(name) {
  const { gender, number } = grammarOf(name);
  if (number === 2) return `Les ${gender === "f" ? "vraies" : "vrais"} ${name}`;
  if (gender === "f") return `La vraie ${name}`;
  return `Le vrai ${name}`;
}

function formatKm(km2) {
  return `${Math.round(km2).toLocaleString("fr-FR")}\u00A0km²`;
}

function areaLines(name, guessKm, trueKm) {
  return [`${possessive(name)} : ${formatKm(guessKm)}`, `${realLabel(name)} : ${formatKm(trueKm)}`];
}

function comparedWith(name) {
  const { article } = grammarOf(name);
  if (article === "le") return `au ${name}`;
  if (article === "les") return `aux ${name}`;
  if (article === "l’") return `à l’${name}`;
  if (article === "la") return `à la ${name}`;
  return `à ${name}`;
}

function resizeSentence(target, ref) {
  const plural = grammarOf(target).number === 2;
  const pronoun = plural ? "leur" : "lui";
  const size = plural ? "leur vraie taille" : "sa vraie taille";
  return `Redimensionnez ${withArticle(target, false)} pour ${pronoun} donner ${size} par rapport ${comparedWith(ref)}.`;
}

function verdictSentence(name, pct) {
  const grammar = grammarOf(name);
  const subject = withArticle(name, true);
  const verb = grammar.number === 2 ? "sont" : "est";
  if (pct === 0) return `${subject} ${verb} à la bonne taille.`;
  // A positive error means the drawing is too big, so the real country is smaller than that.
  const bigger = pct < 0;
  const abs = Math.abs(pct);
  const hedge = abs <= 50 ? " quand même" : abs > 100 ? " bien" : "";
  return `${subject} ${verb}${hedge} plus ${sizeWord(grammar.gender, grammar.number, bigger)} que ça.`;
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fixRing(ring) {
  if (!ring.length) return [];
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i += 1) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (prev - lon > 180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  return out;
}

function ringStats(ring) {
  let crossSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0];
    const y1 = ring[i][1];
    const x2 = ring[i + 1][0];
    const y2 = ring[i + 1][1];
    const cross = x1 * y2 - x2 * y1;
    crossSum += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const area = Math.abs(crossSum) / 2;
  if (area < 1e-12) {
    let sx = 0;
    let sy = 0;
    ring.forEach((point) => {
      sx += point[0];
      sy += point[1];
    });
    return { cx: sx / ring.length, cy: sy / ring.length, area: 0 };
  }
  return { cx: cx / (3 * crossSum), cy: cy / (3 * crossSum), area };
}

function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function degreeDistance(a, b) {
  const midLat = ((a.cy + b.cy) / 2) * Math.PI / 180;
  const dx = (a.cx - b.cx) * Math.cos(midLat);
  const dy = a.cy - b.cy;
  return Math.hypot(dx, dy);
}

function cluster(geometry) {
  const items = polygonsOf(geometry).map((polygon) => {
    const rings = polygon.map(fixRing).filter((ring) => ring.length >= 4);
    if (!rings.length) return null;
    const stats = ringStats(rings[0]);
    return { rings, cx: stats.cx, cy: stats.cy, area: stats.area };
  }).filter((item) => item && item.area > 0);

  if (!items.length) return [];
  items.sort((a, b) => b.area - a.area);
  const ref = items[0].cx;
  items.forEach((item) => {
    while (item.cx - ref > 180) {
      item.cx -= 360;
      item.rings = item.rings.map((ring) => ring.map(([lon, lat]) => [lon - 360, lat]));
    }
    while (ref - item.cx > 180) {
      item.cx += 360;
      item.rings = item.rings.map((ring) => ring.map(([lon, lat]) => [lon + 360, lat]));
    }
  });

  const kept = [items[0]];
  const rest = items.slice(1);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = rest.length - 1; i >= 0; i -= 1) {
      const item = rest[i];
      if (item.area < items[0].area * MIN_PART_RATIO) continue;
      if (degreeDistance(item, items[0]) > MAX_FROM_MAIN_DEG) continue;
      const near = kept.some((other) => degreeDistance(item, other) <= MAX_LINK_DEG);
      if (near) {
        kept.push(item);
        rest.splice(i, 1);
        changed = true;
      }
    }
  }
  return kept;
}

function ringSteradians(ring) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring;
  if (pts.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const lon1 = pts[i][0] * Math.PI / 180;
    const lat1 = pts[i][1] * Math.PI / 180;
    const next = pts[(i + 1) % pts.length];
    const lon2 = next[0] * Math.PI / 180;
    const lat2 = next[1] * Math.PI / 180;
    let dlon = lon2 - lon1;
    if (dlon > Math.PI) dlon -= Math.PI * 2;
    if (dlon < -Math.PI) dlon += Math.PI * 2;
    total += dlon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(total) * 0.5;
}

function sphericalKm2(rings) {
  let ster = ringSteradians(rings[0]);
  for (let i = 1; i < rings.length; i += 1) ster -= ringSteradians(rings[i]);
  return Math.max(0, ster) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

function shiftLon(lon, ref) {
  let next = lon;
  while (next - ref > 180) next -= 360;
  while (ref - next > 180) next += 360;
  return next;
}

function boundsOf(rings) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  rings.forEach((ring) => {
    ring.forEach(([lon, lat]) => {
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    });
  });
  return { minLon, minLat, maxLon, maxLat };
}

function toSphere(lon, lat, lon0, lat0) {
  const lambda = (lon - lon0) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const phi0 = lat0 * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return [
    cosPhi * Math.sin(lambda),
    Math.cos(phi0) * sinPhi - Math.sin(phi0) * cosPhi * Math.cos(lambda),
    Math.sin(phi0) * sinPhi + Math.cos(phi0) * cosPhi * Math.cos(lambda),
  ];
}

function inverseOrtho(x, y, lon0, lat0) {
  const rho2 = x * x + y * y;
  if (rho2 > 1) return null;
  const rho = Math.sqrt(rho2);
  if (rho < 1e-12) return [lon0, lat0];
  const c = Math.asin(Math.min(1, rho));
  const phi0 = lat0 * Math.PI / 180;
  const lambda0 = lon0 * Math.PI / 180;
  const phi = Math.asin(Math.cos(c) * Math.sin(phi0) + (y * Math.sin(c) * Math.cos(phi0)) / rho);
  const lambda = lambda0 + Math.atan2(
    x * Math.sin(c),
    rho * Math.cos(c) * Math.cos(phi0) - y * Math.sin(c) * Math.sin(phi0),
  );
  return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
}

function territoryCenter(polygons) {
  const box = boundsOf(polygons.flat());
  let lon0 = (box.minLon + box.maxLon) / 2;
  let lat0 = (box.minLat + box.maxLat) / 2;
  for (let pass = 0; pass < 2; pass += 1) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    polygons.forEach((rings) => {
      if (!rings.length || !rings[0].length) return;
      const delta = shiftLon(rings[0][0][0], lon0) - rings[0][0][0];
      rings.forEach((ring) => ring.forEach(([lon, lat]) => {
        const point = toSphere(lon + delta, lat, lon0, lat0);
        if (point[2] <= 0) return;
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
      }));
    });
    if (!Number.isFinite(minX)) break;
    const next = inverseOrtho((minX + maxX) / 2, (minY + maxY) / 2, lon0, lat0);
    if (!next) break;
    lon0 = next[0];
    lat0 = next[1];
  }
  return [lon0, lat0];
}

function horizonPoint(a, b) {
  const dz = a[2] - b[2];
  const t = Math.abs(dz) < 1e-12 ? 0 : a[2] / dz;
  const x = a[0] + (b[0] - a[0]) * t;
  const y = a[1] + (b[1] - a[1]) * t;
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len, 0];
}

function horizonArc(a, b) {
  const start = Math.atan2(a[1], a[0]);
  let delta = Math.atan2(b[1], b[0]) - start;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const steps = Math.ceil(Math.abs(delta) / (Math.PI / 30));
  if (steps <= 1) return [];
  const arc = [];
  for (let step = 1; step < steps; step += 1) {
    const angle = start + (delta * step) / steps;
    arc.push([Math.cos(angle), Math.sin(angle)]);
  }
  return arc;
}

function clipFront(sphere) {
  if (sphere.length < 2) return [];
  const visible = (point) => point[2] >= -1e-8;
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const pieces = [];
  let current = null;
  const closePiece = () => {
    if (current && current.length) pieces.push(current);
    current = null;
  };
  for (let i = 1; i < sphere.length; i += 1) {
    const a = sphere[i - 1];
    const b = sphere[i];
    const frontA = visible(a);
    const frontB = visible(b);
    if (frontA && frontB) {
      if (!current) current = [a];
      current.push(b);
    } else if (frontA) {
      if (!current) current = [a];
      current.push(horizonPoint(a, b));
      closePiece();
    } else if (frontB) {
      current = [horizonPoint(a, b), b];
    }
  }
  if (current && pieces.length && same(current[current.length - 1], pieces[0][0])) {
    pieces[0] = current.concat(pieces[0].slice(1));
    current = null;
  }
  if (current) pieces.push(current);
  if (!pieces.length) return [];
  if (pieces.length === 1 && same(pieces[0][0], pieces[0][pieces[0].length - 1])) {
    return [pieces[0].map((point) => [point[0], point[1]])];
  }
  const ring = [];
  pieces.forEach((piece, index) => {
    piece.forEach((point) => ring.push([point[0], point[1]]));
    const next = pieces[(index + 1) % pieces.length];
    horizonArc(piece[piece.length - 1], next[0]).forEach((point) => ring.push(point));
  });
  if (ring.length >= 3) ring.push(ring[0]);
  return ring.length >= 4 ? [ring] : [];
}

function projectPolygons(polygons, lon0, lat0) {
  const projected = [];
  polygons.forEach((rings) => {
    if (!rings.length || !rings[0].length) return;
    const delta = shiftLon(rings[0][0][0], lon0) - rings[0][0][0];
    const visible = [];
    rings.forEach((ring) => {
      const sphere = ring.map(([lon, lat]) => toSphere(lon + delta, lat, lon0, lat0));
      clipFront(sphere).forEach((part) => visible.push(part));
    });
    if (visible.length) projected.push(visible);
  });
  return projected;
}

function facesCamera(polygons, lon0, lat0) {
  let seen = 0;
  let behind = 0;
  for (let i = 0; i < polygons.length; i += 1) {
    const rings = polygons[i];
    if (!rings.length || !rings[0].length) continue;
    const delta = shiftLon(rings[0][0][0], lon0) - rings[0][0][0];
    for (let r = 0; r < rings.length; r += 1) {
      const ring = rings[r];
      for (let p = 0; p < ring.length; p += 1) {
        const point = toSphere(ring[p][0] + delta, ring[p][1], lon0, lat0);
        seen += 1;
        if (point[2] < -0.002) behind += 1;
      }
    }
  }
  return seen > 0 && behind / seen < 0.005;
}

function shapeFrom(polygons) {
  const [lon0, lat0] = territoryCenter(polygons);
  if (!facesCamera(polygons, lon0, lat0)) return null;
  const projected = projectPolygons(polygons, lon0, lat0)
    .map((rings) => rings.map((ring) => ring.map(([x, y]) => [x, -y])));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let planar = 0;
  projected.forEach((polygon) => polygon.forEach((ring) => {
    planar += Math.abs(ringStats(ring).area);
    ring.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
  }));
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1e-6 || height < 1e-6 || planar < 1e-12) return null;
  const padX = 2;
  const padTop = 2;
  const availW = 100 - padX * 2;
  const availH = 100 - padTop;
  const k = Math.min(availW / width, availH / height);
  const offsetX = padX + (availW - width * k) / 2;
  const offsetY = padTop + (availH - height * k);
  const commands = [];
  projected.forEach((polygon) => polygon.forEach((ring) => {
    ring.forEach((point, i) => {
      const x = offsetX + (point[0] - minX) * k;
      const y = offsetY + (point[1] - minY) * k;
      commands.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
    });
    commands.push("Z");
  }));
  return { d: commands.join(" "), k, p: planar };
}

function entityFrom(id, name, geometry, kind) {
  const kept = cluster(geometry);
  if (!kept.length) return null;
  const polygons = kept.map((item) => item.rings);
  const points = kept.reduce((sum, item) => sum + item.rings[0].length, 0);
  const geoArea = kept.reduce((sum, item) => sum + item.area, 0);
  if (kind === "world" && (points < MIN_WORLD_POINTS || geoArea < 0.05)) return null;
  if (kind === "us" && points < 12) return null;
  const area = kept.reduce((sum, item) => sum + sphericalKm2(item.rings), 0);
  if (kind === "world" && area < MIN_AREA_KM2) return null;
  if (area <= 0) return null;
  const shape = shapeFrom(polygons);
  if (!shape) return null;
  return { id, name, area, d: shape.d, k: shape.k, p: shape.p };
}

function worldEntities(collection) {
  const list = [];
  collection.features.forEach((feature) => {
    const props = feature.properties || {};
    const id = props.ADM0_A3;
    if (!id || SKIP_ADM.has(id)) return;
    const name = RENAME[id] || props.NAME_FR || props.NAME;
    const item = entityFrom(id, name, feature.geometry, "world");
    if (item) list.push(item);
  });
  return list;
}

function usEntities(collection) {
  const list = [];
  collection.features.forEach((feature) => {
    const props = feature.properties || {};
    if (props.type === "Federal District" || props.iso_3166_2 === "US-DC") return;
    const id = props.iso_3166_2 || props.name;
    if (!id) return;
    const name = normName(props.name_fr || props.name);
    const item = entityFrom(id, name, feature.geometry, "us");
    if (item) list.push(item);
  });
  return list;
}

function trueScale(ref, target) {
  return (ref.k / target.k) * Math.sqrt((target.area / ref.area) * (ref.p / target.p));
}

function areaRatio(a, b) {
  return Math.max(a.area, b.area) / Math.min(a.area, b.area);
}

function bandOf(ratio) {
  if (ratio < 2.2) return "close";
  if (ratio < 6) return "mid";
  return "far";
}

function buildPairs(pool) {
  const pairs = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const a = pool[i];
      const b = pool[j];
      const ratio = areaRatio(a, b);
      pairs.push({
        a,
        b,
        ratio,
        band: bandOf(ratio),
        sAB: trueScale(a, b),
        sBA: trueScale(b, a),
      });
    }
  }
  return pairs;
}

function setProgress(ratio) {
  const value = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  ui.loadFill.style.width = `${value}%`;
  ui.loadFill.parentElement.setAttribute("aria-valuenow", String(value));
}

async function loadJson(url, from, to) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body && response.body.getReader();
  if (!reader) {
    setProgress(to);
    return response.json();
  }
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const intra = total ? received / total : 1;
    setProgress(from + (to - from) * intra);
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });
  return JSON.parse(new TextDecoder().decode(buffer));
}

function setPressed(selector, attr, value) {
  document.querySelectorAll(selector).forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset[attr] === String(value) ? "true" : "false");
  });
}

function bindSettings() {
  document.querySelectorAll("[data-territory]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.territory = button.dataset.territory;
      setPressed("[data-territory]", "territory", settings.territory);
      ui.lead.textContent = LEADS[settings.territory];
    });
  });
  document.querySelectorAll("[data-length]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.length = Number(button.dataset.length);
      setPressed("[data-length]", "length", settings.length);
    });
  });
  document.querySelectorAll("[data-ms]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.roundMs = Number(button.dataset.ms);
      setPressed("[data-ms]", "ms", settings.roundMs);
      ui.rules.textContent = PACES[settings.roundMs];
    });
  });
}

function remarkFor(pct) {
  const abs = Math.abs(pct);
  if (abs <= 5) return "Incroyable !! C'est très fort.";
  if (abs <= 10) return "Magnifique.";
  if (abs <= 20) return "Pas mal du tout.";
  if (abs <= 40) return "Plutôt pas mal.";
  if (abs <= 50) return "Allez, ça passe.";
  if (abs <= 100) return "Oula.";
  if (abs <= 200) return "Argh !";
  return "La cata.";
}

function formatSigned(pct) {
  const rounded = Math.round(pct);
  if (rounded === 0) return "0 %";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toLocaleString("fr-FR")} %`;
}

function formatRemarkPct(pct) {
  const rounded = Math.round(pct);
  if (rounded === 0) return "0%";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign} ${Math.abs(rounded).toLocaleString("fr-FR")}%`;
}

function paintRemark(pct) {
  const remark = remarkFor(pct);
  const mobile = window.matchMedia("(max-width: 720px)").matches;
  const shown = mobile && remark === "Incroyable !! C'est très fort." ? "Incroyable !!" : remark;
  ui.dockRemark.textContent = mobile
    ? `${shown.replace(/\.$/, "")} (${formatRemarkPct(pct)})`
    : remark;
  ui.dockScore.hidden = false;
  ui.dockScore.textContent = formatSigned(pct);
}

function scoreTotal() {
  const done = rounds.filter((item) => item && item.pct !== null);
  if (!done.length) return null;
  return done.reduce((total, item) => total + Math.abs(item.pct), 0);
}

function formatScore(value) {
  return Math.round(value).toLocaleString("fr-FR");
}

function renderHistory() {
  const items = rounds.filter((item) => item && item.pct !== null);
  ui.history.replaceChildren();
  items.forEach((item) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "pair-name";
    name.textContent = item.target.name;
    const score = document.createElement("span");
    score.className = `score-num${Math.abs(item.pct) >= 20 ? " is-miss" : ""}`;
    score.textContent = formatSigned(item.pct);
    li.append(name, score);
    ui.history.append(li);
  });
  const totalScore = scoreTotal();
  if (totalScore !== null) {
    const total = document.createElement("li");
    total.className = "score-history-total";
    const label = document.createElement("span");
    label.textContent = "Score";
    const value = document.createElement("span");
    value.className = "score-num";
    value.textContent = formatScore(totalScore);
    total.append(label, value);
    ui.history.append(total);
  }
}

function measure() {
  const ref = ui.shelfRef.getBoundingClientRect();
  const target = ui.shelfTarget.getBoundingClientRect();
  const refRoom = Math.min(ref.width - 8, ref.height - 2);
  const targetRoom = Math.min(target.width - 8, target.height - 2);
  if (refRoom < 40 || targetRoom < 40) return;
  let square = Math.max(88, Math.min(refRoom, targetRoom));
  if (window.innerWidth > 720) square = Math.min(square, DESKTOP_SQUARE_CAP);
  const maxScale = Math.max(1, targetRoom / square);
  limits = {
    square,
    minScale: MIN_SCALE,
    maxScale: Math.max(maxScale, 1),
  };
  document.documentElement.style.setProperty("--square", `${square}px`);
  void ui.slotTarget.offsetWidth;
}

function orientations(pair) {
  const options = [];
  if (pair.sAB >= limits.minScale && pair.sAB <= limits.maxScale) {
    options.push({ ref: pair.a, target: pair.b, sTrue: pair.sAB });
  }
  if (pair.sBA >= limits.minScale && pair.sBA <= limits.maxScale) {
    options.push({ ref: pair.b, target: pair.a, sTrue: pair.sBA });
  }
  return options;
}

function pickPair(list, band) {
  if (band === "far" && list.length > 4) {
    const sorted = list.slice().sort((a, b) => a.ratio - b.ratio);
    const upper = sorted.slice(Math.floor(sorted.length / 2));
    return upper[Math.floor(Math.random() * upper.length)];
  }
  return list[Math.floor(Math.random() * list.length)];
}

function deal(band) {
  const pool = catalogs[settings.territory].pairs;
  const used = new Set();
  rounds.forEach((item) => {
    if (!item.ref) return;
    used.add(item.ref.id);
    used.add(item.target.id);
  });
  const passes = [
    (pair) => !used.has(pair.a.id) && !used.has(pair.b.id),
    (pair) => !used.has(pair.a.id) || !used.has(pair.b.id),
    () => true,
  ];
  const bands = band ? [band, "far", "mid", "close", null] : [null];
  for (let p = 0; p < passes.length; p += 1) {
    for (let b = 0; b < bands.length; b += 1) {
      const want = bands[b];
      const found = [];
      for (let i = 0; i < pool.length; i += 1) {
        const pair = pool[i];
        if (want && pair.band !== want) continue;
        if (!passes[p](pair)) continue;
        if (!orientations(pair).length) continue;
        found.push(pair);
      }
      if (found.length) {
        const picked = pickPair(found, want);
        const options = orientations(picked);
        return options[Math.floor(Math.random() * options.length)];
      }
    }
  }
  return null;
}

function schedule(length) {
  const bands = length === 10
    ? ["far", "far", "far", "far", "mid", "mid", "mid", "close", "close", "mid"]
    : ["far", "far", "mid", "close", "mid"];
  return shuffle(bands);
}

function strokeWidth(cssScale, pixels) {
  const pxPerUnit = (limits.square / 100) * cssScale;
  return pxPerUnit > 0 ? pixels / pxPerUnit : pixels;
}

function paintScale() {
  ui.guessScaler.style.transform = `scale(${scale})`;
  const size = limits.square;
  const left = size * (1 - scale) / 2;
  const top = size * (1 - scale);
  const right = left + size * scale;
  const bottom = size;
  const points = {
    nw: [left, top],
    ne: [right, top],
    sw: [left, bottom],
    se: [right, bottom],
  };
  ui.handles.forEach((handle) => {
    const point = points[handle.dataset.corner];
    handle.style.left = `${point[0]}px`;
    handle.style.top = `${point[1]}px`;
  });
}

function paintTruth() {
  ui.truthScaler.hidden = false;
  ui.truthScaler.style.transform = `scale(${round.sTrue})`;
  ui.pathTruthHalo.style.strokeWidth = strokeWidth(round.sTrue, 6);
  ui.pathTruth.style.strokeWidth = strokeWidth(round.sTrue, 2.6);
  ui.truthTip.hidden = false;
  placeTip(ui.truthTip, ui.pathTruth, round.sTrue);
}

function placeTip(tip, path, cssScale) {
  const box = path.getBBox();
  const size = limits.square;
  const yPx = ((box.y || 0) / 100) * size;
  const xPx = ((box.x + box.width / 2) / 100) * size;
  const visualTop = size - (size - yPx) * cssScale;
  const visualCenter = size / 2 + (xPx - size / 2) * cssScale;
  tip.style.left = `${visualCenter}px`;
  tip.style.top = `${visualTop}px`;
}

function paintResizeTip() {
  if (ui.resizeTip.hidden) return;
  placeTip(ui.resizeTip, ui.pathGuess, scale);
}

function dismissResizeTip() {
  ui.resizeTip.hidden = true;
}

function setScale(next) {
  dismissResizeTip();
  scale = Math.max(limits.minScale, next);
  paintScale();
}

function anchorPoint() {
  const rect = ui.slotTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom };
}

function pointerSpan() {
  const pts = [...pointers.values()];
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function onPointerDown(event) {
  if (locked || ui.play.hidden) return;
  if (event.target.closest && event.target.closest("button") && !event.target.classList.contains("handle")) return;
  dismissResizeTip();
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try { ui.shelfTarget.setPointerCapture(event.pointerId); } catch (error) { /* synthetic pointers */ }
  if (pointers.size >= 2) {
    drag = null;
    pinch = { dist: Math.max(8, pointerSpan()), scale };
    return;
  }
  const anchor = anchorPoint();
  drag = {
    dist: Math.max(16, Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y)),
    scale,
  };
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2 && pinch) {
    const dist = Math.max(8, pointerSpan());
    setScale(pinch.scale * (dist / pinch.dist));
    return;
  }
  if (!drag) return;
  const anchor = anchorPoint();
  const dist = Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y);
  setScale(drag.scale * (dist / drag.dist));
}

function onPointerEnd(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) drag = null;
}

function onWheel(event) {
  if (locked || ui.play.hidden) return;
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0014);
  setScale(scale * factor);
}

function stopTimer() {
  cancelAnimationFrame(timerFrame);
  timerFrame = 0;
}

function paintTimer(left) {
  const ratio = Math.max(0, Math.min(1, left / settings.roundMs));
  const shown = left <= 0 ? 0 : Math.ceil(left / 1000);
  ui.timerFill.style.width = `${ratio * 100}%`;
  ui.timerBar.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  ui.timerValue.textContent = `${shown} s`;
}

function tickTimer() {
  const left = roundEndsAt - performance.now();
  if (left <= 0) {
    paintTimer(0);
    settle(true);
    return;
  }
  paintTimer(left);
  timerFrame = requestAnimationFrame(tickTimer);
}

function startTimer() {
  stopTimer();
  roundEndsAt = performance.now() + settings.roundMs;
  ui.timerBlock.hidden = false;
  paintTimer(settings.roundMs);
  timerFrame = requestAnimationFrame(tickTimer);
}

function showAsk() {
  ui.dock.classList.remove("is-over", "is-under", "is-exact");
  ui.dockTimeout.hidden = true;
  ui.dockKicker.hidden = false;
  ui.dockKicker.textContent = `${round.ref.name} vs. ${round.target.name}`;
  ui.dockHelp.hidden = false;
  ui.dockHelp.textContent = resizeSentence(round.target.name, round.ref.name);
  ui.dockScore.hidden = true;
  ui.dockRemark.hidden = true;
  ui.dockDetail.hidden = true;
  ui.dockAreas.hidden = true;
  ui.dockAreas.replaceChildren();
  ui.validate.textContent = "Valider";
  ui.shelfTarget.classList.remove("is-locked");
  ui.truthScaler.hidden = true;
  ui.truthTip.hidden = true;
  ui.resizeTip.hidden = false;
  ui.resizeTip.textContent = `Redimensionnez ${withArticle(round.target.name, false)}`;
}

function settle(timedOut) {
  if (locked || !round) return;
  locked = true;
  stopTimer();
  ui.timerBlock.hidden = true;
  pointers.clear();
  drag = null;
  pinch = null;
  const pct = Math.round(((scale / round.sTrue) ** 2 - 1) * 100);
  round.pct = pct;
  round.scale = scale;
  paintTruth();
  ui.shelfTarget.classList.add("is-locked");
  dismissResizeTip();
  ui.dock.classList.remove("is-over", "is-under", "is-exact");
  ui.dock.classList.add(pct > 0 ? "is-over" : pct < 0 ? "is-under" : "is-exact");
  ui.dockTimeout.hidden = !timedOut;
  ui.dockHelp.hidden = true;
  ui.dockKicker.hidden = true;
  ui.dockRemark.hidden = false;
  paintRemark(pct);
  ui.dockDetail.hidden = false;
  ui.dockDetail.textContent = verdictSentence(round.target.name, pct);
  const guessKm = round.target.area * (scale / round.sTrue) ** 2;
  ui.dockAreas.hidden = false;
  ui.dockAreas.replaceChildren();
  areaLines(round.target.name, guessKm, round.target.area).forEach((line) => {
    const row = document.createElement("span");
    row.textContent = line;
    ui.dockAreas.append(row);
  });
  ui.validate.textContent = index + 1 >= settings.length ? "Voir le score" : "Manche suivante";
  renderHistory();
}

function present() {
  measure();
  const dealt = deal(plan[index]);
  if (!dealt) {
    ui.loadText.textContent = "Pas assez de duels pour cette taille d’écran.";
    ui.load.hidden = false;
    ui.load.classList.remove("is-done");
    return;
  }
  round = { ...dealt, pct: null, scale: 1 };
  rounds[index] = round;
  locked = false;
  scale = 1;
  ui.kicker.textContent = `Manche ${index + 1} / ${settings.length}`;
  ui.dockRound.textContent = ui.kicker.textContent;
  ui.nameRef.textContent = round.ref.name;
  ui.nameTarget.textContent = round.target.name;
  ui.pathRef.setAttribute("d", round.ref.d);
  ui.pathGuess.setAttribute("d", round.target.d);
  ui.pathTruth.setAttribute("d", round.target.d);
  ui.pathTruthHalo.setAttribute("d", round.target.d);
  showAsk();
  paintScale();
  paintResizeTip();
  renderHistory();
  startTimer();
}

function showFinish() {
  stopTimer();
  ui.timerBlock.hidden = true;
  ui.play.hidden = true;
  const totalScore = scoreTotal();
  ui.finalScore.textContent = totalScore === null ? "—" : formatScore(totalScore);
  ui.recap.replaceChildren();
  rounds.filter((item) => item && item.pct !== null).forEach((item) => {
    const li = document.createElement("li");
    const name = document.createElement("p");
    name.className = "finish-recap-name";
    name.textContent = `${item.ref.name} → ${item.target.name}`;
    const score = document.createElement("p");
    score.className = `finish-recap-score${Math.abs(item.pct) >= 20 ? " is-miss" : ""}`;
    score.textContent = formatSigned(item.pct);
    li.append(name, score);
    ui.recap.append(li);
  });
  ui.finish.hidden = false;
}

function advance() {
  if (!locked) {
    settle(false);
    return;
  }
  if (index + 1 >= settings.length) {
    showFinish();
    return;
  }
  index += 1;
  present();
}

function startGame() {
  rounds = [];
  index = 0;
  round = null;
  plan = schedule(settings.length);
  ui.intro.hidden = true;
  ui.finish.hidden = true;
  ui.play.hidden = false;
  ui.history.innerHTML = "";
  requestAnimationFrame(() => present());
}

async function boot() {
  bindSettings();
  try {
    const world = await loadJson(DATA.world, 0, 0.62);
    const us = await loadJson(DATA.us, 0.62, 0.94);
    setProgress(0.96);
    const worldList = worldEntities(world);
    const usList = usEntities(us);
    catalogs = {
      world: { list: worldList, pairs: buildPairs(worldList) },
      us: { list: usList, pairs: buildPairs(usList) },
    };
    setProgress(1);
    if (worldList.length < 80 || usList.length < 45) throw new Error("catalogue incomplet");
    ui.load.classList.add("is-done");
    ui.load.setAttribute("aria-busy", "false");
    ui.intro.hidden = false;
    window.setTimeout(() => { ui.load.hidden = true; }, 500);
  } catch (error) {
    ui.loadText.textContent = "Le chargement des cartes a échoué.";
    console.error(error);
  }
}

ui.start.addEventListener("click", startGame);
ui.validate.addEventListener("click", advance);
ui.replay.addEventListener("click", () => {
  ui.finish.hidden = true;
  ui.play.hidden = true;
  ui.intro.hidden = false;
});
ui.shelfTarget.addEventListener("pointerdown", onPointerDown);
ui.shelfTarget.addEventListener("pointermove", onPointerMove);
ui.shelfTarget.addEventListener("pointerup", onPointerEnd);
ui.shelfTarget.addEventListener("pointercancel", onPointerEnd);
ui.shelfTarget.addEventListener("wheel", onWheel, { passive: false });
ui.handles.forEach((handle) => {
  handle.addEventListener("keydown", (event) => {
    if (locked) return;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      setScale(scale * 1.04);
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      setScale(scale / 1.04);
    }
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || ui.play.hidden) return;
  if (event.target && event.target.closest && event.target.closest("button, input, textarea")) return;
  advance();
});
window.addEventListener("resize", () => {
  if (ui.play.hidden) return;
  measure();
  if (!round) return;
  scale = Math.max(limits.minScale, scale);
  paintScale();
  paintResizeTip();
  if (locked) {
    paintTruth();
    if (round.pct !== null) paintRemark(round.pct);
  }
});

boot();
