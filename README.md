# Design and Evaluation of a Trace-Driven Cache Simulator Supporting Set-Associative and V-Way Cache Architectures

## Overview

This project presents a lightweight, trace-driven cache simulator designed to evaluate and compare traditional **Set-Associative Cache** architectures with the advanced **V-Way Cache** architecture.

The simulator enables deterministic and reproducible analysis of cache placement, replacement behavior, conflict misses, writebacks, and victim selection strategies using memory-access traces. It serves as both a research platform and an educational tool for studying modern cache architectures.



---

## Features

### Set-Associative Cache Support

* Configurable cache size
* Configurable associativity
* LRU replacement policy
* Write-back and write-allocate support

### V-Way Cache Support

* Decoupled tag and data storage
* Configurable Tag Duplication Ratio (TDR)
* Reuse-based global victim selection
* Reuse counters with decay mechanism
* Victim distance analysis
* Enhanced placement flexibility

### Statistics Collection

* Total reads and writes
* Read miss count
* Write miss count
* Overall miss rate
* Writeback count
* Victim count
* Average victim distance
* Worst-case victim distance

---

## Simulator Architecture

```text
cache_sim.cpp
      │
      ▼
 BaseCache Interface
      │
 ┌────┴─────┐
 │          │
 ▼          ▼
SetAssoc   V-Way
 Cache     Cache
```

### Core Components

#### BaseCache

```cpp
access(address, isWrite);
getStats();
```

#### SetAssociativeCache

* Fixed set mapping
* LRU replacement
* Traditional cache organization

#### VWayCache

* Separate tag store and data store
* Global victim selection
* Reuse-aware replacement policy

---

## V-Way Cache Operation

### Cache Access Algorithm

```text
1. Decode address
2. Determine set index and tag
3. Search tag entries
4. On Hit:
      Update reuse counter
      Update recency metadata
5. On Miss:
      Select victim using global victim selection
      Write back dirty victim block
      Insert new block
      Initialize reuse counter
6. Update cache statistics
```

---

## Cache Configurations Evaluated

| Configuration | Description                |
| ------------- | -------------------------- |
| SA-4way       | 32KB Set-Associative Cache |
| VWay-2TDR     | V-Way Cache with TDR = 2   |
| VWay-4TDR     | V-Way Cache with TDR = 4   |

### Common Parameters

```text
Cache Size : 32 KB
Block Size : 64 Bytes
Policy     : Write-Back
Allocation : Write-Allocate
```

---

## Input Trace Format

The simulator accepts memory-access traces in the following format:

```text
<operation> <memory_address>
```

Example:

```text
r 0x1000
w 0x2000
r 0x3000
```

Where:

* `r` = Read Operation
* `w` = Write Operation

---

## Performance Metrics

### Core Metrics

* Total Read Accesses
* Total Write Accesses
* Read Misses
* Write Misses
* Overall Miss Rate
* Writebacks

### V-Way Specific Metrics

#### Victim Count

Total number of eviction events.

#### Average Victim Distance

```text
Average Victim Distance =
Total Victim Distance / Victim Count
```

#### Worst-Case Victim Distance

```text
Worst Victim Distance =
Maximum Victim Scan Distance
```

---

## Experimental Results

### Miss Rate Comparison

| Configuration | Read Miss (%) | Write Miss (%) |
| ------------- | ------------- | -------------- |
| SA-4way       | 0.703         | 3.054          |
| VWay-2TDR     | 0.609         | 2.951          |
| VWay-4TDR     | 0.605         | 2.934          |

### Writeback Comparison

| Configuration | Writebacks |
| ------------- | ---------- |
| SA-4way       | 815        |
| VWay-2TDR     | 109        |
| VWay-4TDR     | 0          |

### Victim Distance Metrics

| Configuration | Avg Victim Distance | Worst Distance |
| ------------- | ------------------- | -------------- |
| VWay-2TDR     | 2.80392             | 319            |
| VWay-4TDR     | 2.16828             | 358            |

---

## Key Findings

### Reduced Conflict Misses

Increasing the Tag Duplication Ratio (TDR) improves placement flexibility and reduces conflict misses.

### Lower Replacement Pressure

The V-Way architecture uses global victim selection and reuse-based eviction, resulting in more efficient replacement decisions.

### Reduced Writebacks

The V-Way cache significantly reduces dirty block evictions compared to traditional Set-Associative caches.

### Better Cache Utilization

Decoupled tag-data storage enables improved block placement without increasing physical cache size.

---

## Streamlit Dashboard

The simulator integrates with a Python Streamlit web interface for interactive visualization.

### Dashboard Features

* Hit vs Miss Rate Comparison
* Average Memory Access Time (AMAT) Analysis
* Execution Time Analysis
* Interactive Configuration Selection
* Real-Time Performance Visualization

Run the dashboard:

```bash
streamlit run app.py
```

---

## Project Structure

```text
Cache-Simulator/
│
├── cache_sim.cpp
├── BaseCache.h
├── SetAssociativeCache.h
├── VWayCache.h
├── traces/
│   └── sample.trace
│
├── results/
│   ├── miss_rates.csv
│   └── writebacks.csv
│
├── app.py
├── README.md
└── LICENSE
```

---

## Build and Run

### Compile

```bash
g++ cache_sim.cpp -o cache_sim
```

### Run

Linux/macOS:

```bash
./cache_sim trace.txt
```

Windows:

```cmd
cache_sim.exe trace.txt
```

---

## Applications

* Computer Architecture Research
* Cache Replacement Policy Evaluation
* Educational Demonstrations
* Memory Hierarchy Studies
* Performance Analysis

---

## Future Enhancements

* Multi-Level Cache Hierarchies
* Energy Consumption Modeling
* Cycle-Accurate Simulation
* Adaptive Replacement Policies
* Benchmark Integration
* Parallel Simulation Support

---

## Citation

```bibtex
@inproceedings{dhanush2026cache,
  title={Design and Evaluation of a Trace-Driven Cache Simulator Supporting Set-Associative and V-Way Cache Architectures},
  author={Chowdary, Myndhala Dhanush and Vamsi, Posa Venkata Durga and Matheswaran, Saravanan and Allimuthu, Udayakumar and Singh, C. Edwin},
  booktitle={International Conference on Intelligent Sustainable Systems (ICISS)},
  year={2026},
  publisher={IEEE}
}
```

---

## License

This project is intended for academic and research purposes. Please cite the original paper when using this work in publications or derivative projects.
