// ═══════════════════════════════════════════════
//   FILE UPLOAD
// ═══════════════════════════════════════════════
let traceLines = [];

const fileDrop = document.getElementById('fileDrop');
const fileInput = document.getElementById('traceFile');

fileDrop.addEventListener('click', () => fileInput.click());
fileDrop.addEventListener('dragover', e => { e.preventDefault(); fileDrop.classList.add('drag-over'); });
fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('drag-over'));
fileDrop.addEventListener('drop', e => {
  e.preventDefault();
  fileDrop.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    traceLines = e.target.result.split('\n').filter(l => l.trim());
    fileDrop.classList.add('has-file');
    fileDrop.querySelector('.label').textContent = `✓ ${file.name} — ${traceLines.length} accesses`;
    fileDrop.querySelector('.sublabel').textContent = 'File loaded successfully';
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════════
//   SET-ASSOCIATIVE CACHE
// ═══════════════════════════════════════════════
class SetAssociativeCache {
  constructor(size, assoc, blockSize, nextLevel = null) {
    this.size      = size;
    this.assoc     = assoc;
    this.blockSize = blockSize;
    this.next      = nextLevel;
    this.numBlocks = size / blockSize;
    this.numSets   = this.numBlocks / assoc;
    this.offsetMask = blockSize - 1;
    this.indexMask  = (this.numSets - 1) * blockSize;
    this.tagMask    = (~0 >>> 0) ^ this.indexMask ^ this.offsetMask;

    // sets[i] = array of {valid, dirty, tag}
    this.sets = Array.from({length: this.numSets}, () =>
      Array.from({length: assoc}, () => ({valid:false, dirty:false, tag:0}))
    );
    this.lru = Array.from({length: this.numSets}, () =>
      Array.from({length: assoc}, (_, i) => i) // lru[set][way] = counter
    );

    this.reads = 0; this.readMisses = 0;
    this.writes = 0; this.writeMisses = 0;
    this.writeBacks = 0;
  }

  _lruGet(setIdx) {
    // return way with highest LRU counter (LRU victim)
    let max = -1, way = 0;
    for (let i = 0; i < this.assoc; i++) {
      if (this.lru[setIdx][i] > max) { max = this.lru[setIdx][i]; way = i; }
    }
    return way;
  }

  _lruUpdate(setIdx, usedWay) {
    const cur = this.lru[setIdx][usedWay];
    for (let i = 0; i < this.assoc; i++) {
      if (this.lru[setIdx][i] < cur) this.lru[setIdx][i]++;
    }
    this.lru[setIdx][usedWay] = 0;
  }

  access(blockAddr, isWrite) {
    const setIdx = (blockAddr & this.indexMask) / this.blockSize;
    const tag    = blockAddr & this.tagMask;
    const set    = this.sets[setIdx];

    // Search
    let hit = -1;
    for (let i = 0; i < this.assoc; i++) {
      if (set[i].valid && set[i].tag === tag) { hit = i; break; }
    }

    if (hit >= 0) {
      if (isWrite) { set[hit].dirty = true; this.writes++; }
      else { this.reads++; }
      this._lruUpdate(setIdx, hit);
    } else {
      if (isWrite) { this.writes++; this.writeMisses++; }
      else { this.reads++; this.readMisses++; }

      // Find free way
      let free = -1;
      for (let i = 0; i < this.assoc; i++) {
        if (!set[i].valid) { free = i; break; }
      }

      if (free < 0) {
        // Evict LRU
        free = this._lruGet(setIdx);
        if (set[free].dirty) {
          this.writeBacks++;
          if (this.next) {
            const evictAddr = set[free].tag | (setIdx * this.blockSize);
            this.next.access(evictAddr, true);
          }
        }
      }

      if (this.next) this.next.access(blockAddr, false);
      set[free] = {valid: true, dirty: isWrite, tag};
      this._lruUpdate(setIdx, free);
    }
  }

  getStats() {
    return [this.reads, this.readMisses, this.writes, this.writeMisses,
            this.writeBacks, 0, 0, 0];
  }
}

// ═══════════════════════════════════════════════
//   V-WAY CACHE
// ═══════════════════════════════════════════════
class VWayCache {
  constructor(size, blockSize, assoc, tdr, rcWidth = 2, nextLevel = null) {
    this.size      = size;
    this.blockSize = blockSize;
    this.assoc     = assoc;
    this.tdr       = tdr;
    this.next      = nextLevel;

    this.numBlocks   = size / blockSize;
    this.numTagSets  = size / (assoc * blockSize);
    this.tagSetSize  = assoc * tdr;
    this.maxCounter  = (1 << rcWidth) - 1;

    this.offsetMask = blockSize - 1;
    this.indexMask  = (this.numTagSets - 1) * blockSize;
    this.tagMask    = (~0 >>> 0) ^ this.indexMask ^ this.offsetMask;

    // Tag store: numTagSets × tagSetSize entries
    // Each: {valid, dirty, tag, fptr}
    this.tagStore = Array.from({length: this.numTagSets}, () =>
      Array.from({length: this.tagSetSize}, () =>
        ({valid:false, dirty:false, tag:0, fptr:0}))
    );
    // LRU per tag set: list (array) of way indices, front=MRU, back=LRU
    this.tagLru = Array.from({length: this.numTagSets}, () => []);

    // Data store: numBlocks entries
    // Each: {valid, rptr, counter, initialized}
    this.dataStore = Array.from({length: this.numBlocks}, () =>
      ({valid:false, rptr:0, counter:0, initialized:false}));
    this.ptr = 0;

    this.reads = 0; this.readMisses = 0;
    this.writes = 0; this.writeMisses = 0;
    this.writeBacks = 0;
    this.victimRequests = 0;
    this.totalVictimDist = 0;
    this.worstVictimDist = 0;
  }

  _searchTag(tsIdx, tag) {
    for (let i = 0; i < this.tagSetSize; i++) {
      const e = this.tagStore[tsIdx][i];
      if (e.valid && e.tag === tag) return i;
    }
    return this.tagSetSize;
  }

  _freeTag(tsIdx) {
    for (let i = 0; i < this.tagSetSize; i++) {
      if (!this.tagStore[tsIdx][i].valid) return i;
    }
    return this.tagSetSize;
  }

  _lruTag(tsIdx) {
    const L = this.tagLru[tsIdx];
    return L[L.length - 1];
  }

  _lruUpdate(tsIdx, wayOffset) {
    const L = this.tagLru[tsIdx];
    const idx = L.indexOf(wayOffset);
    if (idx >= 0) L.splice(idx, 1);
    L.unshift(wayOffset);
  }

  _lruRemove(tsIdx, wayOffset) {
    const L = this.tagLru[tsIdx];
    const idx = L.indexOf(wayOffset);
    if (idx >= 0) L.splice(idx, 1);
  }

  _dataReuse(dIdx) {
    const d = this.dataStore[dIdx];
    d.valid = true;
    if (d.initialized) {
      d.counter = Math.min(d.counter + 1, this.maxCounter);
    } else {
      d.initialized = true;
      d.counter = 0;
    }
  }

  _dataTest(dIdx) {
    const d = this.dataStore[dIdx];
    if (d.counter > 0) { d.counter--; return true; }
    else { d.initialized = false; d.valid = false; return false; }
  }

  _getDataVictim() {
    let dist = 0;
    while (this._dataTest(this.ptr)) {
      this.ptr = (this.ptr + 1) % this.numBlocks;
      dist++;
    }
    const d = this.dataStore[this.ptr];
    const info = {
      index: this.ptr,
      evictionNeeded: d.valid,
      tagEntryToBeEvicted: d.rptr,
      victimDistance: dist
    };
    this.ptr = (this.ptr + 1) % this.numBlocks;
    return info;
  }

  access(blockAddr, isWrite) {
    const tsIdx = (blockAddr & this.indexMask) / this.blockSize;
    const tag   = blockAddr & this.tagMask;

    const hitOffset = this._searchTag(tsIdx, tag);

    if (hitOffset < this.tagSetSize) {
      // HIT
      const te = this.tagStore[tsIdx][hitOffset];
      te.dirty = te.dirty || isWrite;
      this._lruUpdate(tsIdx, hitOffset);
      this._dataReuse(te.fptr);
      if (isWrite) this.writes++;
      else this.reads++;

    } else {
      // MISS
      if (isWrite) { this.writes++; this.writeMisses++; }
      else { this.reads++; this.readMisses++; }

      const freeOffset = this._freeTag(tsIdx);

      if (freeOffset < this.tagSetSize) {
        // Free tag entry
        const victim = this._getDataVictim();
        this.victimRequests++;
        this.totalVictimDist += victim.victimDistance;
        this.worstVictimDist = Math.max(this.worstVictimDist, victim.victimDistance);

        if (victim.evictionNeeded) {
          const vTagIdx = victim.tagEntryToBeEvicted;
          const vTsIdx  = Math.floor(vTagIdx / this.tagSetSize);
          const vOff    = vTagIdx % this.tagSetSize;
          const vte     = this.tagStore[vTsIdx][vOff];
          if (vte.dirty) {
            this.writeBacks++;
            if (this.next) {
              const vAddr = vte.tag | (vTsIdx * this.blockSize);
              this.next.access(vAddr, true);
            }
          }
          // clean data
          const vd = this.dataStore[victim.index];
          vd.valid = false; vd.rptr = 0; vd.counter = 0; vd.initialized = false;
          // evict tag
          vte.valid = false; vte.dirty = false; vte.tag = 0; vte.fptr = 0;
          this._lruRemove(vTsIdx, vOff);
        }

        if (this.next) this.next.access(blockAddr, false);

        const globalFreeIdx = tsIdx * this.tagSetSize + freeOffset;
        const te = this.tagStore[tsIdx][freeOffset];
        te.valid = true; te.dirty = isWrite; te.tag = tag; te.fptr = victim.index;
        this._lruUpdate(tsIdx, freeOffset);

        const d = this.dataStore[victim.index];
        d.valid = true; d.rptr = globalFreeIdx;
        this._dataReuse(victim.index);

      } else {
        // Tag set full: evict LRU tag
        const lruOff = this._lruTag(tsIdx);
        const lrute  = this.tagStore[tsIdx][lruOff];
        const vAddr  = lrute.tag | (tsIdx * this.blockSize);
        const vdIdx  = lrute.fptr;

        if (lrute.dirty) {
          this.writeBacks++;
          if (this.next) this.next.access(vAddr, true);
        }
        this._lruRemove(tsIdx, lruOff);
        const vd = this.dataStore[vdIdx];
        vd.valid = false; vd.rptr = 0; vd.counter = 0; vd.initialized = false;

        if (this.next) this.next.access(blockAddr, false);

        lrute.valid = true; lrute.dirty = isWrite; lrute.tag = tag; lrute.fptr = vdIdx;
        this._lruUpdate(tsIdx, lruOff);
        this._dataReuse(vdIdx);
        this.dataStore[vdIdx].rptr = tsIdx * this.tagSetSize + lruOff;
      }
    }
  }

  getStats() {
    return [this.reads, this.readMisses, this.writes, this.writeMisses,
            this.writeBacks, this.victimRequests, this.totalVictimDist, this.worstVictimDist];
  }
}

// ═══════════════════════════════════════════════
//   SIMULATION RUNNER
// ═══════════════════════════════════════════════
let charts = {};

function setProgress(pct, label) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressLabel').textContent = label;
}

async function runAll() {
  if (!traceLines.length) { alert('Please upload a trace file first.'); return; }

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  document.getElementById('progressWrap').classList.add('visible');
  document.getElementById('results').classList.remove('visible');
  document.getElementById('results').style.display = 'none';

  const L1_SIZE       = parseInt(document.getElementById('L1_SIZE').value);
  const L1_BLOCK_SIZE = parseInt(document.getElementById('L1_BLOCK_SIZE').value);
  const L1_ASSOC      = parseInt(document.getElementById('L1_ASSOC').value);
  const L2_SIZE       = parseInt(document.getElementById('L2_SIZE').value);
  const L2_BLOCK_SIZE = parseInt(document.getElementById('L2_BLOCK_SIZE').value);
  const L2_ASSOC      = parseInt(document.getElementById('L2_ASSOC').value);
  const L2_TDR        = parseInt(document.getElementById('L2_TDR').value);

  const configs = [
    { label: 'Set-Associative', tdr: 0 },
    { label: 'V-Way TDR=2',     tdr: 2 },
    { label: 'V-Way TDR=3',     tdr: 3 },
  ];

  const results = [];

  for (let ci = 0; ci < configs.length; ci++) {
    const cfg = configs[ci];
    setProgress((ci / configs.length) * 90, `Simulating ${cfg.label}...`);
    await new Promise(r => setTimeout(r, 0)); // let UI update

    // Build caches
    let L2 = null;
    if (L2_SIZE > 0) {
      if (L2_TDR === 0) L2 = new SetAssociativeCache(L2_SIZE, L2_ASSOC, L2_BLOCK_SIZE, null);
      else L2 = new VWayCache(L2_SIZE, L2_BLOCK_SIZE, L2_ASSOC, L2_TDR, 2, null);
    }

    let L1;
    if (cfg.tdr === 0) L1 = new SetAssociativeCache(L1_SIZE, L1_ASSOC, L1_BLOCK_SIZE, L2);
    else L1 = new VWayCache(L1_SIZE, L1_BLOCK_SIZE, L1_ASSOC, cfg.tdr, 2, L2);

    // Run trace
    for (const line of traceLines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const op   = parts[0];
      const addr = parseInt(parts[1], 16);
      if (isNaN(addr)) continue;
      const blockAddr = addr & ~(L1_BLOCK_SIZE - 1);
      L1.access(blockAddr, op === 'w');
    }

    const s = L1.getStats();
    const l2s = L2 ? L2.getStats() : new Array(8).fill(0);
    const avgVD = s[5] > 0 ? (s[6] / s[5]).toFixed(2) : '0.00';

    const raw = buildRaw(cfg, {L1_SIZE,L1_BLOCK_SIZE,L1_ASSOC,L2_SIZE,L2_BLOCK_SIZE,L2_ASSOC,L2_TDR}, s, l2s, avgVD);

    results.push({
      label: cfg.label, tdr: cfg.tdr,
      reads: s[0], readMisses: s[1],
      writes: s[2], writeMisses: s[3],
      writeBacks: s[4],
      avgVDst: parseFloat(avgVD),
      worstDst: s[7],
      readMissRate: s[0] > 0 ? (s[1]/s[0]*100).toFixed(2) : '0.00',
      writeMissRate: s[2] > 0 ? (s[3]/s[2]*100).toFixed(2) : '0.00',
      raw
    });
  }

  setProgress(100, 'Complete!');
  await new Promise(r => setTimeout(r, 400));

  document.getElementById('progressWrap').classList.remove('visible');
  btn.disabled = false;

  renderResults(results);
  document.getElementById('results').style.display = 'block';
  document.getElementById('results').classList.add('visible');
}

function buildRaw(cfg, params, s, l2s, avgVD) {
  const W1 = 16, W2 = 10;
  const pad = (s, w) => String(s).padEnd(w);
  const l2AvgVD = l2s[5] > 0 ? (l2s[6]/l2s[5]).toFixed(2) : '0';
  return [
    '===== SIMULATOR CONFIGURATION =====',
    pad('CACHE',W1) + pad('L1',W2) + 'L2',
    pad('SIZE',W1) + pad(params.L1_SIZE,W2) + params.L2_SIZE,
    pad('BLOCK_SIZE',W1) + pad(params.L1_BLOCK_SIZE,W2) + params.L2_BLOCK_SIZE,
    pad('ASSOC',W1) + pad(params.L1_ASSOC,W2) + params.L2_ASSOC,
    pad('TDR',W1) + pad(cfg.tdr,W2) + params.L2_TDR,
    '',
    '======= SIMULATION RESULTS ========',
    pad('CACHE',W1) + pad('L1',W2) + 'L2',
    pad('READS',W1) + pad(s[0],W2) + l2s[0],
    pad('READ MISSES',W1) + pad(s[1],W2) + l2s[1],
    pad('WRITES',W1) + pad(s[2],W2) + l2s[2],
    pad('WRITE MISSES',W1) + pad(s[3],W2) + l2s[3],
    pad('WRITEBACKS',W1) + pad(s[4],W2) + l2s[4],
    pad('AVG. V. DST.',W1) + pad(avgVD,W2) + l2AvgVD,
    pad('WORST. DST.',W1) + pad(s[7],W2) + l2s[7],
  ].join('\n');
}

// ═══════════════════════════════════════════════
//   RENDER
// ═══════════════════════════════════════════════
function renderResults(results) {
  renderStatCards(results);
  renderTable(results);
  renderCharts(results);
  renderRaw(results);
}

function renderStatCards(results) {
  const rates = results.map(r => parseFloat(r.readMissRate));
  const minRate = Math.min(...rates);
  document.getElementById('statCards').innerHTML = results.map(r => {
    const isWinner = parseFloat(r.readMissRate) === minRate;
    return `<div class="stat-card ${isWinner ? 'winner' : ''} fade-up">
      ${isWinner ? '<div class="winner-badge">★ Best</div>' : ''}
      <div class="model-name">${r.label}</div>
      <div class="miss-rate">${r.readMissRate}%</div>
      <div class="miss-label">Read Miss Rate</div>
      <div class="sub-stat">Writebacks: ${r.writeBacks.toLocaleString()}</div>
    </div>`;
  }).join('');
}

function renderTable(results) {
  const rows = [
    { key:'reads',         label:'Reads',               lb:false },
    { key:'readMisses',    label:'Read Misses',          lb:true  },
    { key:'readMissRate',  label:'Read Miss Rate',       lb:true, fmt: v => v+'%' },
    { key:'writes',        label:'Writes',               lb:false },
    { key:'writeMisses',   label:'Write Misses',         lb:true  },
    { key:'writeMissRate', label:'Write Miss Rate',      lb:true, fmt: v => v+'%' },
    { key:'writeBacks',    label:'Writebacks',           lb:true  },
    { key:'avgVDst',       label:'Avg. Victim Distance', lb:false, fmt: v => v > 0 ? parseFloat(v).toFixed(2) : 'N/A' },
    { key:'worstDst',      label:'Worst Victim Dist.',   lb:false, fmt: v => v > 0 ? v : 'N/A' },
  ];

  const hdr = `<tr><th>Metric</th>${results.map(r=>`<th>${r.label}</th>`).join('')}</tr>`;
  const body = rows.map(row => {
    const vals = results.map(r => parseFloat(r[row.key]));
    const best  = row.lb ? Math.min(...vals) : null;
    const worst = row.lb ? Math.max(...vals) : null;
    const cells = results.map(r => {
      const v = r[row.key];
      const n = parseFloat(v);
      const fmt = row.fmt ? row.fmt(v) : (typeof v === 'number' ? v.toLocaleString() : v);
      let cls = '';
      if (row.lb && n === best && best !== worst) cls = 'best';
      if (row.lb && n === worst && best !== worst) cls = 'worst';
      return `<td class="${cls}">${fmt}</td>`;
    }).join('');
    return `<tr><td>${row.label}</td>${cells}</tr>`;
  }).join('');

  document.getElementById('compTable').innerHTML = hdr + body;
}

function renderCharts(results) {
  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  const labels = results.map(r => r.label);
  const colors = ['rgba(0,212,255,0.8)', 'rgba(0,255,157,0.8)', 'rgba(255,214,10,0.8)'];
  const colorsLight = ['rgba(0,212,255,0.3)', 'rgba(0,255,157,0.3)', 'rgba(255,214,10,0.3)'];

  const opts = yLabel => ({
    responsive: true,
    plugins: {
      legend: { labels: { color: '#6b8099', font: { family: 'JetBrains Mono', size: 10 } } }
    },
    scales: {
      x: { ticks: { color: '#6b8099', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: '#1e2d40' } },
      y: { beginAtZero: true, ticks: { color: '#6b8099', font: { family: 'JetBrains Mono', size: 10 } },
           grid: { color: '#1e2d40' },
           title: { display: true, text: yLabel, color: '#3d5266', font: { family: 'JetBrains Mono', size: 10 } } }
    }
  });

  charts.miss = new Chart(document.getElementById('chartMiss'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Read Miss %',  data: results.map(r => r.readMissRate),  backgroundColor: colors },
      { label: 'Write Miss %', data: results.map(r => r.writeMissRate), backgroundColor: colorsLight },
    ]},
    options: opts('Miss Rate (%)')
  });

  charts.wb = new Chart(document.getElementById('chartWB'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Writebacks', data: results.map(r => r.writeBacks), backgroundColor: colors }] },
    options: opts('Count')
  });

  charts.abs = new Chart(document.getElementById('chartMissAbs'), {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Read Misses',  data: results.map(r => r.readMisses),  backgroundColor: colors },
      { label: 'Write Misses', data: results.map(r => r.writeMisses), backgroundColor: colorsLight },
    ]},
    options: opts('Count')
  });

  charts.vd = new Chart(document.getElementById('chartVDist'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Avg Victim Distance', data: results.map(r => r.avgVDst), backgroundColor: colors }] },
    options: opts('Distance')
  });
}

function renderRaw(results) {
  const tabs = document.getElementById('tabs');
  const panels = document.getElementById('rawPanels');
  tabs.innerHTML = ''; panels.innerHTML = '';

  results.forEach((r, i) => {
    const tab = document.createElement('button');
    tab.className = 'tab' + (i === 0 ? ' active' : '');
    tab.textContent = r.label;
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.raw-output').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('raw'+i).classList.add('active');
    };
    tabs.appendChild(tab);

    const pre = document.createElement('pre');
    pre.className = 'raw-output' + (i === 0 ? ' active' : '');
    pre.id = 'raw' + i;
    pre.textContent = r.raw;
    panels.appendChild(pre);
  });
}
