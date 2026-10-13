const DCP_A = 2.48;
const DCP_B = 1.057;
const ZERO_OPTIONS = [30, 40, 50, 60, 70, 80, 90];
const HIGH_ZERO_OPTIONS = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(values) {
  return values[randomInt(0, values.length - 1)];
}

function randomWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let pick = Math.random() * total;
  for (const item of items) {
    pick -= item.weight;
    if (pick <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function cbrToDcp(cbr) {
  return Math.log10(cbr);
}

function cbrToPenRate(cbr) {
  const dcp = cbrToDcp(cbr);
  return 10 ** ((DCP_A - dcp) / DCP_B);
}

function penRateToDcp(penRate) {
  return DCP_A - DCP_B * Math.log10(penRate);
}

function penRateToCbr(penRate) {
  return 10 ** penRateToDcp(penRate);
}

function chooseTargetCbr(min, max) {
  if (Math.abs(max - min) < 1e-12) return roundTo(min, 1);
  const minTenth = Math.ceil(min * 10 - 1e-9);
  const maxTenth = Math.floor(max * 10 + 1e-9);
  if (minTenth <= maxTenth) return randomInt(minTenth, maxTenth) / 10;
  return roundTo(min + Math.random() * (max - min), 1);
}

function chooseRowCount(forcedRows) {
  if (forcedRows != null) return forcedRows;
  return randomWeighted([
    { value: 9, weight: 2 },
    { value: 10, weight: 6 },
    { value: 11, weight: 22 },
    { value: 12, weight: 35 },
    { value: 13, weight: 27 },
    { value: 14, weight: 6 },
    { value: 15, weight: 2 }
  ]);
}

function chooseZeroReading(forcedZero) {
  return forcedZero == null
    ? randomChoice(Math.random() < 0.20 ? HIGH_ZERO_OPTIONS : ZERO_OPTIONS)
    : forcedZero;
}

function makePenetrationIncrements(rowCount, targetPenRate) {
  const intervalCount = rowCount - 1;
  const minimumCoverage = 600;

  // Start close to the field pattern: 50 mm is most common, with occasional
  // 60-90 mm intervals. Very soft target CBRs may include one larger jump.
  const basePool = [50, 50, 50, 50, 50, 60, 60, 60, 70, 70, 80, 90];
  const increments = Array.from({ length: intervalCount }, () => randomChoice(basePool));

  if (targetPenRate > 55 && intervalCount > 0 && Math.random() < 0.78) {
    const idx = randomInt(0, Math.min(2, intervalCount - 1));
    const softJump = clamp(Math.round(targetPenRate / 10) * 10, 80, 140);
    increments[idx] = Math.max(increments[idx], softJump);
  }

  let coverage = increments.reduce((sum, value) => sum + value, 0);

  // Bring short tables above 600 mm while keeping the changes distributed.
  let guard = 0;
  while (coverage < minimumCoverage && guard < 200) {
    const idx = randomInt(0, intervalCount - 1);
    const add = coverage <= minimumCoverage - 20 ? 10 : minimumCoverage - coverage;
    increments[idx] += add;
    coverage += add;
    guard += 1;
  }

  // Avoid needlessly long profiles; trim only amounts above the 50 mm floor.
  while (coverage > 720) {
    const candidates = increments
      .map((value, index) => ({ value, index }))
      .filter(item => item.value > 50);
    if (!candidates.length) break;
    const selected = randomChoice(candidates);
    selected.value = increments[selected.index];
    increments[selected.index] -= 10;
    coverage -= 10;
  }

  return increments;
}

function makeBlowIncrements(penetrationIncrements, targetPenRate) {
  const n = penetrationIncrements.length;
  const result = [];
  let localFactor = 0.90 + Math.random() * 0.20;

  for (let i = 0; i < n; i++) {
    // Smooth local variability so adjacent readings resemble one field profile,
    // rather than independent random values.
    localFactor += (Math.random() - 0.5) * 0.28;
    localFactor = clamp(localFactor, 0.55, 1.45);

    // A small chance of a locally harder lens, especially deeper in the profile.
    let hardLens = 1;
    if (i > n * 0.45 && Math.random() < 0.11) {
      hardLens = 0.42 + Math.random() * 0.25;
    }

    const localRate = Math.max(3, targetPenRate * localFactor * hardLens);
    const idealBlows = penetrationIncrements[i] / localRate;

    let blows = Math.max(1, Math.round(idealBlows));

    // Keep integer blows realistic without producing excessively wild jumps.
    if (blows > 1 && Math.random() < 0.18) blows += randomChoice([-1, 1]);
    blows = clamp(blows, 1, 30);
    result.push(blows);
  }

  return result;
}

function generateSyntheticDcp(options) {
  const {
    cbrMin,
    cbrMax,
    forcedZero = null,
    forcedRows = null
  } = options;

  const targetCbr = chooseTargetCbr(cbrMin, cbrMax);
  const dcp = cbrToDcp(targetCbr);
  const targetPenRate = cbrToPenRate(targetCbr);
  const zeroReading = chooseZeroReading(forcedZero);
  const rowCount = chooseRowCount(forcedRows);

  const penetrationIncrements = makePenetrationIncrements(rowCount, targetPenRate);
  const blowIncrements = makeBlowIncrements(penetrationIncrements, targetPenRate);

  const rows = [{ blows: 0, totalBlows: 0, penetration: zeroReading }];
  let totalBlows = 0;
  let penetration = zeroReading;

  for (let i = 0; i < penetrationIncrements.length; i++) {
    totalBlows += blowIncrements[i];
    penetration += penetrationIncrements[i];
    rows.push({ blows: blowIncrements[i], totalBlows, penetration });
  }

  return {
    targetCbr,
    penRate: targetPenRate,
    dcp,
    zeroReading,
    rowCount,
    coverage: penetration - zeroReading,
    rows
  };
}

function validateInputs(elements) {
  const cbrMin = Number(elements.cbrMin.value);
  const cbrMax = Number(elements.cbrMax.value);
  const zeroRaw = elements.zeroReading.value.trim();
  const rowsRaw = elements.rowCount.value.trim();
  let valid = true;

  elements.cbrMinError.textContent = "";
  elements.cbrMaxError.textContent = "";
  elements.zeroReadingError.textContent = "";
  elements.rowCountError.textContent = "";

  if (!Number.isFinite(cbrMin) || cbrMin < 0.5 || cbrMin > 100) {
    elements.cbrMinError.textContent = "Enter a CBR between 0.5% and 100%.";
    valid = false;
  }

  if (!Number.isFinite(cbrMax) || cbrMax < 0.5 || cbrMax > 100) {
    elements.cbrMaxError.textContent = "Enter a CBR between 0.5% and 100%.";
    valid = false;
  } else if (Number.isFinite(cbrMin) && cbrMax < cbrMin) {
    elements.cbrMaxError.textContent = "CBR max must be equal to or greater than CBR min.";
    valid = false;
  }

  let forcedZero = null;
  if (zeroRaw !== "") {
    forcedZero = Number(zeroRaw);
    if (!Number.isInteger(forcedZero) || forcedZero < 0 || forcedZero > 200) {
      elements.zeroReadingError.textContent = "Enter a whole number from 0 to 200 mm.";
      valid = false;
    }
  }

  let forcedRows = null;
  if (rowsRaw !== "") {
    forcedRows = Number(rowsRaw);
    if (!Number.isInteger(forcedRows) || forcedRows < 9 || forcedRows > 15) {
      elements.rowCountError.textContent = "Use an integer from 9 to 15.";
      valid = false;
    }
  }

  if (!valid) return null;
  return { cbrMin, cbrMax, forcedZero, forcedRows };
}

function renderResult(result, elements) {
  elements.zeroReadingResult.textContent = `${result.zeroReading} mm`;
  elements.penRateResult.textContent = `${result.penRate.toFixed(1)} mm/blow`;
  elements.dcpResult.textContent = result.dcp.toFixed(3);
  elements.cbrResult.textContent = `${result.targetCbr.toFixed(1)}%`;

  elements.dataBody.innerHTML = "";
  result.rows.forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${row.blows}</td><td>${row.totalBlows}</td><td>${row.penetration}</td>`;
    elements.dataBody.appendChild(tr);
  });

  const finalDepth = result.rows[result.rows.length - 1].penetration;
  elements.coverageNote.textContent = `${result.rowCount} readings · ${result.coverage} mm penetration below Zero Reading · final reading ${finalDepth} mm`;
  elements.resultSection.hidden = false;
}

function initialiseApp() {
  const elements = {
    cbrMin: document.getElementById("cbrMin"),
    cbrMax: document.getElementById("cbrMax"),
    zeroReading: document.getElementById("zeroReading"),
    rowCount: document.getElementById("rowCount"),
    cbrMinError: document.getElementById("cbrMinError"),
    cbrMaxError: document.getElementById("cbrMaxError"),
    zeroReadingError: document.getElementById("zeroReadingError"),
    rowCountError: document.getElementById("rowCountError"),
    generateBtn: document.getElementById("generateBtn"),
    resultSection: document.getElementById("resultSection"),
    zeroReadingResult: document.getElementById("zeroReadingResult"),
    penRateResult: document.getElementById("penRateResult"),
    dcpResult: document.getElementById("dcpResult"),
    cbrResult: document.getElementById("cbrResult"),
    dataBody: document.getElementById("dataBody"),
    coverageNote: document.getElementById("coverageNote")
  };

  elements.generateBtn.addEventListener("click", () => {
    const values = validateInputs(elements);
    if (!values) return;
    renderResult(generateSyntheticDcp(values), elements);
  });

  [elements.cbrMin, elements.cbrMax, elements.zeroReading, elements.rowCount]
    .forEach(input => input.addEventListener("input", () => validateInputs(elements)));

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));
  }
}

if (typeof document !== "undefined") initialiseApp();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cbrToDcp,
    cbrToPenRate,
    penRateToDcp,
    penRateToCbr,
    generateSyntheticDcp
  };
}
