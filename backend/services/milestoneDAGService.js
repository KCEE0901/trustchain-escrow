/**
 * Milestone DAG Service
 *
 * Models milestone dependencies inside an escrow as a Directed Acyclic Graph
 * (DAG), where each node is a milestone and each directed edge A → B means
 * "milestone A must be Approved before milestone B may be submitted".
 *
 * Key operations:
 *   - Build an in-memory adjacency list from a flat milestone array
 *   - Detect cycles before persisting a new dependency edge
 *   - Compute a topological execution order
 *   - Derive which milestones are currently unblocked (ready to submit)
 *   - Validate that the full dependency graph is acyclic and internally consistent
 *
 * No database writes occur here — callers are responsible for persisting
 * dependency metadata alongside their milestone records.
 */

import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('milestoneDAGService');

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build an adjacency list (edges: predecessor → Set<successor>) from a flat
 * array of milestone objects that each carry their own `dependencies` list.
 *
 * @param {MilestoneNode[]} milestones - Array of milestone descriptors.
 * @returns {Map<number, Set<number>>} Adjacency map keyed by milestoneIndex.
 */
function buildAdjacencyList(milestones) {
  /** @type {Map<number, Set<number>>} */
  const adj = new Map();

  for (const m of milestones) {
    if (!adj.has(m.milestoneIndex)) {
      adj.set(m.milestoneIndex, new Set());
    }
    for (const dep of m.dependencies ?? []) {
      if (!adj.has(dep)) {
        adj.set(dep, new Set());
      }
      // dep must finish before m — so dep → m
      adj.get(dep).add(m.milestoneIndex);
    }
  }

  return adj;
}

/**
 * DFS-based cycle detector.
 * Returns `true` when the graph rooted at `start` contains a cycle.
 *
 * @param {Map<number, Set<number>>} adj  - Adjacency list.
 * @param {number}                   start - Node to begin from.
 * @param {Set<number>}             [visited]  - Already fully explored nodes.
 * @param {Set<number>}             [inStack]  - Nodes currently on the DFS stack.
 * @returns {boolean} Whether a cycle was detected.
 */
function hasCycleDFS(adj, start, visited = new Set(), inStack = new Set()) {
  if (inStack.has(start)) return true;
  if (visited.has(start)) return false;

  visited.add(start);
  inStack.add(start);

  for (const neighbour of adj.get(start) ?? []) {
    if (hasCycleDFS(adj, neighbour, visited, inStack)) {
      return true;
    }
  }

  inStack.delete(start);
  return false;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build an adjacency list representation of a milestone dependency graph.
 *
 * Each entry `adj.get(i)` is the set of milestone indices that are
 * direct successors of milestone `i` (i.e. milestones that are unblocked
 * once milestone `i` reaches `Approved`).
 *
 * @param {MilestoneNode[]} milestones - Flat array of milestone nodes.  Every
 *   node must have a unique `milestoneIndex` and an optional `dependencies`
 *   array of predecessor indices.
 * @returns {Map<number, Set<number>>} Adjacency map `{ predecessorIndex →
 *   Set<successorIndex> }`.
 * @throws {Error} If `milestones` is not an array.
 *
 * @example
 * const adj = buildGraph([
 *   { milestoneIndex: 0, dependencies: [] },
 *   { milestoneIndex: 1, dependencies: [0] },
 * ]);
 * // adj.get(0) → Set { 1 }
 */
export function buildGraph(milestones) {
  if (!Array.isArray(milestones)) {
    throw new TypeError('milestones must be an array');
  }
  return buildAdjacencyList(milestones);
}

/**
 * Validate that a milestone dependency graph is acyclic and that every
 * declared dependency index exists within the provided milestone set.
 *
 * @param {MilestoneNode[]} milestones - Flat array of milestone nodes to validate.
 * @returns {{ valid: boolean, errors: string[] }} Validation result.  `valid`
 *   is `true` when no errors were found; `errors` is a human-readable list of
 *   all detected problems.
 *
 * @example
 * const { valid, errors } = validateDAG([
 *   { milestoneIndex: 0, dependencies: [] },
 *   { milestoneIndex: 1, dependencies: [0] },
 * ]);
 * // { valid: true, errors: [] }
 */
export function validateDAG(milestones) {
  /** @type {string[]} */
  const errors = [];

  if (!Array.isArray(milestones)) {
    return { valid: false, errors: ['milestones must be an array'] };
  }

  const indices = new Set(milestones.map((m) => m.milestoneIndex));

  // Check for duplicate indices
  if (indices.size !== milestones.length) {
    errors.push('Duplicate milestoneIndex values detected');
  }

  // Check every dependency reference points to an existing milestone
  for (const m of milestones) {
    for (const dep of m.dependencies ?? []) {
      if (!indices.has(dep)) {
        errors.push(`Milestone ${m.milestoneIndex} declares unknown dependency: ${dep}`);
      }
      if (dep === m.milestoneIndex) {
        errors.push(`Milestone ${m.milestoneIndex} depends on itself`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Cycle detection — run DFS from every node
  const adj = buildAdjacencyList(milestones);
  const visited = new Set();

  for (const node of indices) {
    if (hasCycleDFS(adj, node, visited, new Set())) {
      errors.push('Dependency graph contains a cycle');
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Determine whether adding a directed edge from `fromIndex` to `toIndex`
 * (meaning milestone `fromIndex` must complete before `toIndex`) would
 * introduce a cycle into the existing dependency graph.
 *
 * Use this before persisting a new dependency to enforce the DAG invariant.
 *
 * @param {MilestoneNode[]} milestones - Current milestone set (without the
 *   proposed new dependency).
 * @param {number} fromIndex - Predecessor milestone index (the one that must
 *   finish first).
 * @param {number} toIndex   - Successor milestone index (the one that depends
 *   on `fromIndex`).
 * @returns {boolean} `true` when adding this edge would create a cycle.
 *
 * @example
 * // Milestones 0→1→2 are already in sequence.
 * // Would closing the loop (2 depends on 0) create a cycle? Yes.
 * wouldCreateCycle(milestones, 2, 0); // true
 */
export function wouldCreateCycle(milestones, fromIndex, toIndex) {
  const adj = buildAdjacencyList(milestones);

  // Temporarily add the proposed edge
  if (!adj.has(fromIndex)) adj.set(fromIndex, new Set());
  adj.get(fromIndex).add(toIndex);
  if (!adj.has(toIndex)) adj.set(toIndex, new Set());

  // If we can reach fromIndex starting from toIndex, adding fromIndex→toIndex
  // creates a cycle.
  return hasCycleDFS(adj, toIndex, new Set(), new Set());
}

/**
 * Compute a topological ordering of milestones respecting their dependencies.
 *
 * Returns milestone indices in an order where every predecessor appears
 * before its successors.  Uses Kahn's algorithm (BFS-based).
 *
 * @param {MilestoneNode[]} milestones - Flat array of milestone nodes.  The
 *   graph must be acyclic; use {@link validateDAG} first if unsure.
 * @returns {number[]} Milestone indices in a valid execution order.
 * @throws {Error} If the graph contains a cycle (not a DAG).
 *
 * @example
 * topologicalSort([
 *   { milestoneIndex: 2, dependencies: [1] },
 *   { milestoneIndex: 0, dependencies: [] },
 *   { milestoneIndex: 1, dependencies: [0] },
 * ]);
 * // [0, 1, 2]
 */
export function topologicalSort(milestones) {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return [];
  }

  const adj = buildAdjacencyList(milestones);

  // Compute in-degree for every node
  /** @type {Map<number, number>} */
  const inDegree = new Map();
  for (const m of milestones) {
    if (!inDegree.has(m.milestoneIndex)) {
      inDegree.set(m.milestoneIndex, 0);
    }
  }

  for (const [, successors] of adj) {
    for (const s of successors) {
      inDegree.set(s, (inDegree.get(s) ?? 0) + 1);
    }
  }

  // Enqueue nodes with in-degree 0
  const queue = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }

  // Sort queue for deterministic output when multiple nodes have in-degree 0
  queue.sort((a, b) => a - b);

  const order = [];
  while (queue.length > 0) {
    // Shift smallest index (queue is kept sorted)
    const node = queue.shift();
    order.push(node);

    const toAdd = [];
    for (const successor of adj.get(node) ?? []) {
      const newDegree = inDegree.get(successor) - 1;
      inDegree.set(successor, newDegree);
      if (newDegree === 0) toAdd.push(successor);
    }
    toAdd.sort((a, b) => a - b);
    queue.push(...toAdd);
    // Keep sorted for stable output
    queue.sort((a, b) => a - b);
  }

  if (order.length !== milestones.length) {
    throw new Error('milestoneDAGService.topologicalSort: cycle detected — graph is not a DAG');
  }

  return order;
}

/**
 * Derive the set of milestones that are currently unblocked and eligible
 * to be submitted.
 *
 * A milestone is "ready" when:
 *   1. Its current status is `Pending` or `Rejected` (not yet submitted or
 *      previously rejected and awaiting resubmission), AND
 *   2. Every milestone it depends on has status `Approved`.
 *
 * @param {MilestoneNode[]} milestones - Full milestone set for a single escrow,
 *   each carrying its current `status` and `dependencies`.
 * @returns {MilestoneNode[]} Subset of milestone objects that are ready to submit.
 *
 * @example
 * const ready = getReadyMilestones([
 *   { milestoneIndex: 0, status: 'Approved',  dependencies: [] },
 *   { milestoneIndex: 1, status: 'Pending',   dependencies: [0] },
 *   { milestoneIndex: 2, status: 'Pending',   dependencies: [1] },
 * ]);
 * // ready → [{ milestoneIndex: 1, ... }]   (milestone 2 is still blocked by 1)
 */
export function getReadyMilestones(milestones) {
  if (!Array.isArray(milestones)) return [];

  /** @type {Map<number, string>} */
  const statusMap = new Map(milestones.map((m) => [m.milestoneIndex, m.status]));

  return milestones.filter((m) => {
    const isActionable = m.status === 'Pending' || m.status === 'Rejected';
    if (!isActionable) return false;

    const allDepsApproved = (m.dependencies ?? []).every(
      (dep) => statusMap.get(dep) === 'Approved',
    );
    return allDepsApproved;
  });
}

/**
 * Compute the critical path through the milestone DAG — the longest chain of
 * dependent milestones from any source to any sink.
 *
 * Each milestone contributes a weight of 1 to the path length.  The critical
 * path determines the minimum number of sequential approval rounds required
 * to complete all milestones.
 *
 * @param {MilestoneNode[]} milestones - Flat array of milestone nodes.  The
 *   graph must be acyclic.
 * @returns {CriticalPathResult} Object describing the length and ordered list
 *   of milestone indices on the critical path.
 *
 * @example
 * criticalPath([
 *   { milestoneIndex: 0, dependencies: [] },
 *   { milestoneIndex: 1, dependencies: [0] },
 *   { milestoneIndex: 2, dependencies: [0] },
 *   { milestoneIndex: 3, dependencies: [1, 2] },
 * ]);
 * // { length: 3, path: [0, 1, 3] }  — or [0, 2, 3]; both have length 3
 */
export function criticalPath(milestones) {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { length: 0, path: [] };
  }

  const sorted = topologicalSort(milestones);
  const adj = buildAdjacencyList(milestones);

  // dist[node] = length of longest path ending at node (counting nodes, not edges)
  /** @type {Map<number, number>} */
  const dist = new Map(sorted.map((n) => [n, 1]));

  // predecessor tracking for path reconstruction
  /** @type {Map<number, number|null>} */
  const prev = new Map(sorted.map((n) => [n, null]));

  for (const node of sorted) {
    for (const successor of adj.get(node) ?? []) {
      const candidate = dist.get(node) + 1;
      if (candidate > dist.get(successor)) {
        dist.set(successor, candidate);
        prev.set(successor, node);
      }
    }
  }

  // Find the node with maximum distance
  let maxDist = 0;
  let tail = sorted[0];
  for (const [node, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      tail = node;
    }
  }

  // Reconstruct the path
  const path = [];
  let cursor = tail;
  while (cursor !== null && cursor !== undefined) {
    path.unshift(cursor);
    cursor = prev.get(cursor);
  }

  log.debug({ message: 'critical_path_computed', length: maxDist, path });

  return { length: maxDist, path };
}

/**
 * Return all direct predecessor milestones (immediate dependencies) for a
 * given milestone index.
 *
 * @param {MilestoneNode[]} milestones - Full milestone set.
 * @param {number}           index     - The milestone index to query.
 * @returns {MilestoneNode[]} Array of milestone objects that `index` directly
 *   depends on.  Returns an empty array if `index` has no dependencies.
 *
 * @example
 * getPredecessors(milestones, 2);
 * // → [{ milestoneIndex: 1, ... }]  assuming milestone 2 depends on 1
 */
export function getPredecessors(milestones, index) {
  const target = milestones.find((m) => m.milestoneIndex === index);
  if (!target) return [];

  const depIndices = new Set(target.dependencies ?? []);
  return milestones.filter((m) => depIndices.has(m.milestoneIndex));
}

/**
 * Return all direct successor milestones (milestones that directly depend on
 * the given index).
 *
 * @param {MilestoneNode[]} milestones - Full milestone set.
 * @param {number}           index     - The milestone index to query.
 * @returns {MilestoneNode[]} Array of milestone objects that list `index` as a
 *   direct dependency.  Returns an empty array if no successors exist.
 *
 * @example
 * getSuccessors(milestones, 0);
 * // → [{ milestoneIndex: 1, ... }, { milestoneIndex: 2, ... }]
 */
export function getSuccessors(milestones, index) {
  return milestones.filter((m) => (m.dependencies ?? []).includes(index));
}

/**
 * Collect all transitive predecessors (ancestors) of a given milestone index
 * using a BFS traversal.
 *
 * This is useful for determining which milestones are transitively required
 * to complete before a specific milestone can be submitted.
 *
 * @param {MilestoneNode[]} milestones - Full milestone set.
 * @param {number}           index     - The milestone index to query.
 * @returns {Set<number>} Set of milestone indices that are ancestors of
 *   `index` (excludes `index` itself).
 *
 * @example
 * // 0 → 1 → 3, 2 → 3
 * getAllPredecessors(milestones, 3); // Set { 0, 1, 2 }
 */
export function getAllPredecessors(milestones, index) {
  const ancestors = new Set();
  const queue = [index];

  // Build a reverse adjacency map: successor → Set<predecessor>
  /** @type {Map<number, Set<number>>} */
  const reverseAdj = new Map();
  for (const m of milestones) {
    for (const dep of m.dependencies ?? []) {
      if (!reverseAdj.has(m.milestoneIndex)) {
        reverseAdj.set(m.milestoneIndex, new Set());
      }
      reverseAdj.get(m.milestoneIndex).add(dep);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    for (const pred of reverseAdj.get(current) ?? []) {
      if (!ancestors.has(pred)) {
        ancestors.add(pred);
        queue.push(pred);
      }
    }
  }

  return ancestors;
}

/**
 * Collect all transitive successors (descendants) of a given milestone index
 * using a BFS traversal.
 *
 * Useful for understanding which future milestones would be affected if the
 * given milestone is rejected or disputed.
 *
 * @param {MilestoneNode[]} milestones - Full milestone set.
 * @param {number}           index     - The milestone index to query.
 * @returns {Set<number>} Set of milestone indices that are descendants of
 *   `index` (excludes `index` itself).
 *
 * @example
 * // 0 → 1 → 3, 0 → 2 → 3
 * getAllSuccessors(milestones, 0); // Set { 1, 2, 3 }
 */
export function getAllSuccessors(milestones, index) {
  const adj = buildAdjacencyList(milestones);
  const descendants = new Set();
  const queue = [index];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const succ of adj.get(current) ?? []) {
      if (!descendants.has(succ)) {
        descendants.add(succ);
        queue.push(succ);
      }
    }
  }

  return descendants;
}

/**
 * Summarise the completion progress of a milestone set as a ratio and
 * percentage.
 *
 * @param {MilestoneNode[]} milestones - Full milestone set.
 * @returns {ProgressSummary} Summary containing approved count, total count,
 *   and completion percentage (0–100, rounded to one decimal place).
 *
 * @example
 * milestoneProgress([
 *   { milestoneIndex: 0, status: 'Approved' },
 *   { milestoneIndex: 1, status: 'Submitted' },
 *   { milestoneIndex: 2, status: 'Pending' },
 * ]);
 * // { approved: 1, total: 3, percentage: 33.3 }
 */
export function milestoneProgress(milestones) {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    return { approved: 0, total: 0, percentage: 0 };
  }

  const approved = milestones.filter((m) => m.status === 'Approved').length;
  const total = milestones.length;
  const percentage = Math.round((approved / total) * 1000) / 10;

  return { approved, total, percentage };
}

// ─── JSDoc type definitions ───────────────────────────────────────────────────

/**
 * @typedef {object} MilestoneNode
 * @property {number}   milestoneIndex - Unique 0-based index within the escrow.
 * @property {string}   [status]       - Current MilestoneStatus value:
 *   `'Pending'` | `'Submitted'` | `'Approved'` | `'Rejected'` | `'Disputed'`.
 * @property {number[]} [dependencies] - Indices of milestones that must be
 *   `Approved` before this one can be submitted.
 */

/**
 * @typedef {object} CriticalPathResult
 * @property {number}   length - Number of milestones on the critical path.
 * @property {number[]} path   - Ordered list of milestone indices forming the
 *   critical path (from source to sink).
 */

/**
 * @typedef {object} ProgressSummary
 * @property {number} approved   - Count of milestones with status `Approved`.
 * @property {number} total      - Total number of milestones.
 * @property {number} percentage - Completion percentage (0–100).
 */

export default {
  buildGraph,
  validateDAG,
  wouldCreateCycle,
  topologicalSort,
  getReadyMilestones,
  criticalPath,
  getPredecessors,
  getSuccessors,
  getAllPredecessors,
  getAllSuccessors,
  milestoneProgress,
};
