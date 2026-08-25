/**
 * Auto-generate all important shore test cases.
 * Pure data generation — no UI, no rendering.
 */
import { getShoreTiles } from '@mmo/shared';

export interface TestCase {
  name: string;
  description: string;
  neighbors: boolean[];         // 8 booleans: [NW, N, NE, W, E, SW, S, SE]
  mask: number;
  expectedConcave: number[];    // shore indices 1-8
  expectedConvex: number[];     // convex-shore indices 1-4
}

interface TestCaseInput {
  name: string;
  description: string;
  mask: number;
}

// Convert mask to neighbor boolean array
function maskToNeighbors(mask: number): boolean[] {
  return [
    !!(mask & 1),   // NW
    !!(mask & 2),   // N
    !!(mask & 4),   // NE
    !!(mask & 8),   // W
    !!(mask & 16),  // E
    !!(mask & 32),  // SW
    !!(mask & 64),  // S
    !!(mask & 128), // SE
  ];
}

// Compute expected tiles from getShoreTiles()
function computeExpected(mask: number): { concave: number[]; convex: number[] } {
  const tiles = getShoreTiles(mask);
  const concave: number[] = [];
  const convex: number[] = [];
  for (const tile of tiles) {
    if (tile.type === 'concave') concave.push(tile.index);
    else if (tile.type === 'convex') convex.push(tile.index);
  }
  return { concave, convex };
}

// Build a TestCase from an input definition
function buildCase(input: TestCaseInput): TestCase {
  const { concave, convex } = computeExpected(input.mask);
  return {
    name: input.name,
    description: input.description,
    neighbors: maskToNeighbors(input.mask),
    mask: input.mask,
    expectedConcave: concave,
    expectedConvex: convex,
  };
}

// All test case definitions organized by category
const DEFINITIONS: TestCaseInput[] = [
  // 1. Single direction (8 cases)
  { name: 'Single NW', description: 'Only NW land neighbor', mask: 1 },
  { name: 'Single N', description: 'Only N land neighbor', mask: 2 },
  { name: 'Single NE', description: 'Only NE land neighbor', mask: 4 },
  { name: 'Single W', description: 'Only W land neighbor', mask: 8 },
  { name: 'Single E', description: 'Only E land neighbor', mask: 16 },
  { name: 'Single SW', description: 'Only SW land neighbor', mask: 32 },
  { name: 'Single S', description: 'Only S land neighbor', mask: 64 },
  { name: 'Single SE', description: 'Only SE land neighbor', mask: 128 },

  // 2. Adjacent pairs (8 cases)
  { name: 'NW + N', description: 'Adjacent pair NW and N', mask: 3 },
  { name: 'N + NE', description: 'Adjacent pair N and NE', mask: 6 },
  { name: 'NE + E', description: 'Adjacent pair NE and E', mask: 20 },
  { name: 'E + SE', description: 'Adjacent pair E and SE', mask: 144 },
  { name: 'SE + S', description: 'Adjacent pair SE and S', mask: 192 },
  { name: 'S + SW', description: 'Adjacent pair S and SW', mask: 96 },
  { name: 'SW + W', description: 'Adjacent pair SW and W', mask: 40 },
  { name: 'W + NW', description: 'Adjacent pair W and NW', mask: 9 },

  // 3. Diagonal pairs (4 cases)
  { name: 'NW + NE', description: 'Diagonal pair across north', mask: 5 },
  { name: 'NE + SE', description: 'Diagonal pair across east', mask: 132 },
  { name: 'SE + SW', description: 'Diagonal pair across south', mask: 160 },
  { name: 'SW + NW', description: 'Diagonal pair across west', mask: 33 },

  // 4. Opposite pairs (4 cases)
  { name: 'NW + SE', description: 'Opposite corners NW and SE', mask: 129 },
  { name: 'N + S', description: 'Opposite cardinal N and S', mask: 66 },
  { name: 'NE + SW', description: 'Opposite corners NE and SW', mask: 36 },
  { name: 'W + E', description: 'Opposite cardinal W and E', mask: 24 },

  // 5. Three-way combinations (8 cases)
  { name: 'NW + N + NE', description: 'Three adjacent across north', mask: 7 },
  { name: 'N + NE + E', description: 'Three adjacent across northeast', mask: 22 },
  { name: 'NE + E + SE', description: 'Three adjacent across east', mask: 148 },
  { name: 'E + SE + S', description: 'Three adjacent across southeast', mask: 208 },
  { name: 'SE + S + SW', description: 'Three adjacent across south', mask: 224 },
  { name: 'S + SW + W', description: 'Three adjacent across southwest', mask: 104 },
  { name: 'SW + W + NW', description: 'Three adjacent across west', mask: 41 },
  { name: 'W + NW + N', description: 'Three adjacent across northwest', mask: 11 },

  // 6. Four cardinal (1 case)
  { name: 'Four Cardinal', description: 'All four cardinal directions N+E+S+W', mask: 90 },

  // 7. Four diagonal (1 case)
  { name: 'Four Diagonal', description: 'All four diagonal corners', mask: 165 },

  // 8. Full ring (1 case)
  { name: 'Full Ring', description: 'All 8 neighbors land', mask: 255 },

  // 9. No land (1 case)
  { name: 'No Land', description: 'All water, no land neighbors', mask: 0 },

  // 10. Complex coast (4 cases)
  { name: 'L-Shaped Coast', description: 'L-shaped coast: NW+N+W', mask: 11 },
  { name: 'T-Shaped Coast', description: 'T-shaped coast: NW+N+NE+W', mask: 15 },
  { name: 'U-Shaped Coast', description: 'U-shaped coast: NW+N+NE+W+E', mask: 31 },
  { name: 'Full Surround', description: 'All except SE', mask: 127 },
];

// Generate all test cases from definitions
const ALL_TEST_CASES: TestCase[] = DEFINITIONS.map(buildCase);

/** Generate all test cases */
export function generateAllTestCases(): TestCase[] {
  return ALL_TEST_CASES;
}

/** Get test case by index */
export function getTestCase(index: number): TestCase {
  return ALL_TEST_CASES[index];
}

/** Get total number of test cases */
export function getTestCaseCount(): number {
  return ALL_TEST_CASES.length;
}
