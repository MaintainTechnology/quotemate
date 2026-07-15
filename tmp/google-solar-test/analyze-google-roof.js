const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = __dirname;
const PIXEL_METRES = 0.25;
const QUERY_LAT = -27.5028758;
const QUERY_LNG = 153.162234;
const METRES_PER_DEG_LAT = 111320;
const METRES_PER_DEG_LNG = METRES_PER_DEG_LAT * Math.cos((QUERY_LAT * Math.PI) / 180);

function localMetres(lat, lng) {
  return {
    east: (lng - QUERY_LNG) * METRES_PER_DEG_LNG,
    north: (lat - QUERY_LAT) * METRES_PER_DEG_LAT,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.floor((sorted.length - 1) * p)];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function loadRaw(file, depth, colourspace = 'b-w') {
  let image = sharp(file).toColourspace(colourspace);
  const result = await image.raw(depth ? { depth } : undefined).toBuffer({ resolveWithObject: true });
  return result;
}

async function main() {
  const insights = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'building-insights.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  const segments = insights.solarPotential.roofSegmentStats;

  const dsmRaw = await loadRaw(path.join(ROOT, 'dsm.tif'), 'float');
  const maskRaw = await loadRaw(path.join(ROOT, 'mask.tif'));
  const { width, height } = dsmRaw.info;
  const pixelCount = width * height;
  const dsm = new Float32Array(
    dsmRaw.data.buffer,
    dsmRaw.data.byteOffset,
    dsmRaw.data.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const mask = maskRaw.data;
  const centerX = width / 2;
  const centerY = height / 2;

  const toPixel = (lat, lng) => {
    const local = localMetres(lat, lng);
    return {
      x: centerX + local.east / PIXEL_METRES,
      y: centerY - local.north / PIXEL_METRES,
    };
  };

  const planes = segments.map((segment, index) => {
    const pitchRadians = (segment.pitchDegrees * Math.PI) / 180;
    const azimuthRadians = (segment.azimuthDegrees * Math.PI) / 180;
    const tangent = Math.tan(pitchRadians);
    const center = localMetres(segment.center.latitude, segment.center.longitude);
    const pixelCenter = toPixel(segment.center.latitude, segment.center.longitude);
    const corners = [segment.boundingBox.sw, segment.boundingBox.ne].map((point) =>
      toPixel(point.latitude, point.longitude),
    );
    const gx = -tangent * Math.sin(azimuthRadians);
    const gy = -tangent * Math.cos(azimuthRadians);
    return {
      index,
      pitchDegrees: segment.pitchDegrees,
      azimuthDegrees: segment.azimuthDegrees,
      areaM2: segment.stats.areaMeters2,
      z0: segment.planeHeightAtCenterMeters,
      east0: center.east,
      north0: center.north,
      pixelCenter,
      bbox: {
        minX: Math.min(corners[0].x, corners[1].x) - 5,
        maxX: Math.max(corners[0].x, corners[1].x) + 5,
        minY: Math.min(corners[0].y, corners[1].y) - 5,
        maxY: Math.max(corners[0].y, corners[1].y) + 5,
      },
      gx,
      gy,
      normal: [-gx, -gy, 1],
    };
  });

  const indexOf = (x, y) => y * width + x;
  let seedX = Math.round(centerX);
  let seedY = Math.round(centerY);
  if (mask[indexOf(seedX, seedY)] === 0) {
    let found = false;
    for (let radius = 1; radius < 80 && !found; radius += 1) {
      for (let y = Math.max(0, seedY - radius); y <= Math.min(height - 1, seedY + radius); y += 1) {
        for (let x = Math.max(0, seedX - radius); x <= Math.min(width - 1, seedX + radius); x += 1) {
          if (mask[indexOf(x, y)] > 0) {
            seedX = x;
            seedY = y;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }

  const component = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let queueStart = 0;
  let queueEnd = 0;
  queue[queueEnd++] = indexOf(seedX, seedY);
  component[indexOf(seedX, seedY)] = 1;
  const neighbours4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queueStart < queueEnd) {
    const index = queue[queueStart++];
    const x = index % width;
    const y = Math.floor(index / width);
    for (const [dx, dy] of neighbours4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const neighbourIndex = indexOf(nx, ny);
      if (!component[neighbourIndex] && mask[neighbourIndex] > 0) {
        component[neighbourIndex] = 1;
        queue[queueEnd++] = neighbourIndex;
      }
    }
  }

  const labels = new Int16Array(pixelCount);
  labels.fill(-1);
  const residuals = new Float32Array(pixelCount);
  residuals.fill(Number.POSITIVE_INFINITY);
  const predictHeight = (plane, x, y) => {
    const east = (x - centerX) * PIXEL_METRES;
    const north = (centerY - y) * PIXEL_METRES;
    return plane.z0 + plane.gx * (east - plane.east0) + plane.gy * (north - plane.north0);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y);
      if (!component[index]) continue;
      const z = dsm[index];
      let candidates = planes.filter(
        (plane) =>
          x >= plane.bbox.minX &&
          x <= plane.bbox.maxX &&
          y >= plane.bbox.minY &&
          y <= plane.bbox.maxY,
      );
      if (!candidates.length) candidates = planes;
      for (const plane of candidates) {
        const residual = Math.abs(z - predictHeight(plane, x, y));
        if (residual < residuals[index]) {
          residuals[index] = residual;
          labels[index] = plane.index;
        }
      }
    }
  }

  const neighbours8 = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx || dy) neighbours8.push([dx, dy]);
    }
  }
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const next = new Int16Array(labels);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = indexOf(x, y);
        if (!component[index]) continue;
        const counts = new Map();
        for (const [dx, dy] of neighbours8) {
          const label = labels[indexOf(x + dx, y + dy)];
          if (label >= 0) counts.set(label, (counts.get(label) || 0) + 1);
        }
        let majorityLabel = labels[index];
        let majorityCount = 0;
        for (const [label, count] of counts.entries()) {
          if (count > majorityCount) {
            majorityLabel = label;
            majorityCount = count;
          }
        }
        if (majorityLabel !== labels[index] && majorityCount >= 5) {
          const proposedResidual = Math.abs(dsm[index] - predictHeight(planes[majorityLabel], x, y));
          if (proposedResidual <= residuals[index] + 0.35) {
            next[index] = majorityLabel;
            residuals[index] = proposedResidual;
          }
        }
      }
    }
    labels.set(next);
  }

  const labelStats = planes.map((plane) => ({
    index: plane.index,
    pixels: 0,
    sumX: 0,
    sumY: 0,
    residuals: [],
  }));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y);
      const label = labels[index];
      if (label < 0) continue;
      const stat = labelStats[label];
      stat.pixels += 1;
      stat.sumX += x;
      stat.sumY += y;
      stat.residuals.push(residuals[index]);
    }
  }
  for (const stat of labelStats) {
    stat.centroidX = stat.pixels ? stat.sumX / stat.pixels : null;
    stat.centroidY = stat.pixels ? stat.sumY / stat.pixels : null;
    stat.residuals.sort((a, b) => a - b);
    stat.medianResidualM = percentile(stat.residuals, 0.5);
    stat.p90ResidualM = percentile(stat.residuals, 0.9);
    delete stat.sumX;
    delete stat.sumY;
    delete stat.residuals;
  }

  const adjacency = new Map();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y);
      const label = labels[index];
      if (label < 0) continue;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const other = labels[indexOf(nx, ny)];
        if (other < 0 || other === label) continue;
        const first = Math.min(label, other);
        const second = Math.max(label, other);
        const key = `${first}:${second}`;
        const item = adjacency.get(key) || {
          first,
          second,
          contacts: 0,
          sumX: 0,
          sumY: 0,
        };
        item.contacts += 1;
        item.sumX += x + dx / 2;
        item.sumY += y + dy / 2;
        adjacency.set(key, item);
      }
    }
  }

  const internalEdges = [];
  for (const item of adjacency.values()) {
    const lengthM = item.contacts * PIXEL_METRES;
    if (lengthM < 1.5) continue;
    const a = planes[item.first];
    const b = planes[item.second];
    const statA = labelStats[item.first];
    const statB = labelStats[item.second];
    if (!statA.pixels || !statB.pixels) continue;
    const boundaryX = item.sumX / item.contacts;
    const boundaryY = item.sumY / item.contacts;
    const sideA = {
      east: (statA.centroidX - boundaryX) * PIXEL_METRES,
      north: -(statA.centroidY - boundaryY) * PIXEL_METRES,
    };
    const sideB = {
      east: (statB.centroidX - boundaryX) * PIXEL_METRES,
      north: -(statB.centroidY - boundaryY) * PIXEL_METRES,
    };
    const sideNormA = Math.hypot(sideA.east, sideA.north) || 1;
    const sideNormB = Math.hypot(sideB.east, sideB.north) || 1;
    const deltaA = a.gx * (sideA.east / sideNormA) + a.gy * (sideA.north / sideNormA);
    const deltaB = b.gx * (sideB.east / sideNormB) + b.gy * (sideB.north / sideNormB);
    const intersection = cross(a.normal, b.normal);
    const horizontal = Math.hypot(intersection[0], intersection[1]);
    const slopeDegrees = (Math.atan2(Math.abs(intersection[2]), horizontal || 1e-9) * 180) / Math.PI;
    let type = 'unknown';
    if (deltaA < -0.03 && deltaB < -0.03) {
      type = slopeDegrees < 8 ? 'ridge' : 'hip';
    } else if (deltaA > 0.03 && deltaB > 0.03) {
      type = 'valley';
    }
    internalEdges.push({
      planes: [item.first, item.second],
      type,
      rasterContactLengthM: Number(lengthM.toFixed(2)),
      intersectionSlopeDegrees: Number(slopeDegrees.toFixed(1)),
      inwardHeightChangePerM: [Number(deltaA.toFixed(3)), Number(deltaB.toFixed(3))],
      boundaryPixel: [Number(boundaryX.toFixed(1)), Number(boundaryY.toFixed(1))],
    });
  }
  internalEdges.sort((a, b) => b.rasterContactLengthM - a.rasterContactLengthM);

  const boundaryByLabel = planes.map(() => new Uint8Array(pixelCount));
  const outwardByPixel = new Map();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = indexOf(x, y);
      const label = labels[index];
      if (label < 0) continue;
      let outEast = 0;
      let outNorth = 0;
      let isBoundary = false;
      for (const [dx, dy] of neighbours4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || !component[indexOf(nx, ny)]) {
          isBoundary = true;
          outEast += dx;
          outNorth -= dy;
        }
      }
      if (isBoundary) {
        boundaryByLabel[label][index] = 1;
        outwardByPixel.set(index, [outEast, outNorth]);
      }
    }
  }

  const perimeterRuns = [];
  for (const plane of planes) {
    const boundary = boundaryByLabel[plane.index];
    const visited = new Uint8Array(pixelCount);
    for (let start = 0; start < pixelCount; start += 1) {
      if (!boundary[start] || visited[start]) continue;
      const runQueue = [start];
      visited[start] = 1;
      const run = [];
      while (runQueue.length) {
        const index = runQueue.pop();
        run.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of neighbours8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nextIndex = indexOf(nx, ny);
          if (boundary[nextIndex] && !visited[nextIndex]) {
            visited[nextIndex] = 1;
            runQueue.push(nextIndex);
          }
        }
      }
      if (run.length < 5) continue;
      let outEast = 0;
      let outNorth = 0;
      let sumX = 0;
      let sumY = 0;
      for (const index of run) {
        const outward = outwardByPixel.get(index) || [0, 0];
        outEast += outward[0];
        outNorth += outward[1];
        sumX += index % width;
        sumY += Math.floor(index / width);
      }
      const outwardNorm = Math.hypot(outEast, outNorth) || 1;
      const heightChange =
        plane.gx * (outEast / outwardNorm) + plane.gy * (outNorth / outwardNorm);
      let type = 'step_or_unknown';
      if (heightChange < -0.05) type = 'eave_candidate';
      else if (Math.abs(heightChange) <= 0.05) type = 'rake_candidate';
      perimeterRuns.push({
        plane: plane.index,
        type,
        rasterBoundaryPixels: run.length,
        approximateLengthM: Number((run.length * PIXEL_METRES).toFixed(2)),
        outwardHeightChangePerM: Number(heightChange.toFixed(3)),
        centroidPixel: [Number((sumX / run.length).toFixed(1)), Number((sumY / run.length).toFixed(1))],
      });
    }
  }
  perimeterRuns.sort((a, b) => b.approximateLengthM - a.approximateLengthM);

  const palette = [
    [255, 55, 95],
    [255, 159, 10],
    [10, 132, 255],
    [48, 209, 88],
    [191, 90, 242],
    [100, 210, 255],
    [255, 214, 10],
    [255, 69, 58],
    [94, 92, 230],
    [102, 212, 207],
  ];
  const overlay = Buffer.alloc(pixelCount * 4, 0);
  for (let index = 0; index < pixelCount; index += 1) {
    const label = labels[index];
    if (label < 0) continue;
    const color = palette[label % palette.length];
    overlay[index * 4] = color[0];
    overlay[index * 4 + 1] = color[1];
    overlay[index * 4 + 2] = color[2];
    overlay[index * 4 + 3] = 82;
  }

  const markerSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g font-family="Arial, sans-serif" font-size="7" font-weight="700" text-anchor="middle">
        ${planes
          .map((plane) => {
            const { x, y } = plane.pixelCenter;
            const azimuth = (plane.azimuthDegrees * Math.PI) / 180;
            const arrowX = x + Math.sin(azimuth) * 10;
            const arrowY = y - Math.cos(azimuth) * 10;
            return `<line x1="${x}" y1="${y}" x2="${arrowX}" y2="${arrowY}" stroke="#ffffff" stroke-width="1" opacity="0.9"/>
              <circle cx="${x}" cy="${y}" r="5" fill="#07101c" stroke="#ffffff" stroke-width="1"/>
              <text x="${x}" y="${y + 2.5}" fill="#ffffff">${xmlEscape(plane.index)}</text>`;
          })
          .join('')}
      </g>
    </svg>`;

  await sharp(path.join(ROOT, 'rgb.tif'))
    .composite([
      { input: overlay, raw: { width, height, channels: 4 } },
      { input: Buffer.from(markerSvg) },
    ])
    .png()
    .toFile(path.join(ROOT, 'segment-assignment.png'));

  const classifiedCounts = internalEdges.reduce(
    (counts, edge) => {
      counts[edge.type] = (counts[edge.type] || 0) + 1;
      return counts;
    },
    {},
  );
  const perimeterCounts = perimeterRuns.reduce(
    (counts, run) => {
      counts[run.type] = (counts[run.type] || 0) + 1;
      return counts;
    },
    {},
  );
  const allResiduals = [];
  for (let index = 0; index < pixelCount; index += 1) {
    if (labels[index] >= 0 && Number.isFinite(residuals[index])) allResiduals.push(residuals[index]);
  }
  allResiduals.sort((a, b) => a - b);

  const report = {
    warning:
      'Experimental raster-plane assignment only. Google does not return typed roof edges; these counts are not production measurements.',
    raster: {
      width,
      height,
      pixelMetres: PIXEL_METRES,
      imageryDate: insights.imageryDate,
      imageryQuality: insights.imageryQuality,
    },
    googleRoofSegmentCount: segments.length,
    mainBuildingMaskPixels: queueEnd,
    mainBuildingMaskAreaM2: Number((queueEnd * PIXEL_METRES * PIXEL_METRES).toFixed(2)),
    assignedPlaneCount: labelStats.filter((stat) => stat.pixels >= 5).length,
    fitResidualM: {
      median: Number(percentile(allResiduals, 0.5).toFixed(3)),
      p90: Number(percentile(allResiduals, 0.9).toFixed(3)),
      p99: Number(percentile(allResiduals, 0.99).toFixed(3)),
    },
    experimentalInternalEdgeCounts: classifiedCounts,
    experimentalPerimeterRunCounts: perimeterCounts,
    planeAssignments: labelStats,
    internalEdges,
    perimeterRuns,
  };
  fs.writeFileSync(path.join(ROOT, 'experimental-analysis.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        googleRoofSegmentCount: report.googleRoofSegmentCount,
        mainBuildingMaskAreaM2: report.mainBuildingMaskAreaM2,
        assignedPlaneCount: report.assignedPlaneCount,
        fitResidualM: report.fitResidualM,
        experimentalInternalEdgeCounts: report.experimentalInternalEdgeCounts,
        experimentalPerimeterRunCounts: report.experimentalPerimeterRunCounts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
