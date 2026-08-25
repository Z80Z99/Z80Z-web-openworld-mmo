/**
 * texture-loader — Load shore/water PNGs as HTMLImageElement via Canvas 2D.
 *
 * Pure browser API, no PixiJS dependency. Designed for the shore-debug
 * preview renderer which draws directly to a Canvas 2D context.
 */

export interface ShoreTextures {
  concave: Map<number, HTMLImageElement>; // key: 1-8 → shore1-8.png
  convex: Map<number, HTMLImageElement>; // key: 1-4 → convex-shore1-4.png
  water: HTMLImageElement; // water1.png
}

export interface LoadResult {
  textures: ShoreTextures;
  missing: string[]; // file names that failed to load
}

const CONCAVE_COUNT = 8;
const CONVEX_COUNT = 4;

const DEFAULT_BASE_DIR = "/assets/game-assets/";

/**
 * Load a single image via `new Image()`. Returns null if the image fails
 * to load (file missing, CORS, etc.) — never throws.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Load all 13 shore/water textures from the game-assets directory.
 *
 * Returns the loaded textures plus a list of any files that were missing
 * or failed to load. The caller can still operate with partial textures.
 *
 * @param baseDir - Base URL for the asset directory. Defaults to `/assets/game-assets/`.
 */
export async function loadShoreTextures(
  baseDir = DEFAULT_BASE_DIR,
): Promise<LoadResult> {
  const concave = new Map<number, HTMLImageElement>();
  const convex = new Map<number, HTMLImageElement>();
  const missing: string[] = [];
  let water: HTMLImageElement | null = null;

  const promises: Array<Promise<void>> = [];

  // Concave shores: shore1.png – shore8.png
  for (let i = 1; i <= CONCAVE_COUNT; i++) {
    const fileName = `shore${i}.png`;
    const url = `${baseDir}${fileName}`;
    const p = loadImage(url).then((img) => {
      if (img) {
        concave.set(i, img);
      } else {
        missing.push(fileName);
      }
    });
    promises.push(p);
  }

  // Convex shores: convex-shore1.png – convex-shore4.png
  for (let i = 1; i <= CONVEX_COUNT; i++) {
    const fileName = `convex-shore${i}.png`;
    const url = `${baseDir}${fileName}`;
    const p = loadImage(url).then((img) => {
      if (img) {
        convex.set(i, img);
      } else {
        missing.push(fileName);
      }
    });
    promises.push(p);
  }

  // Water: water1.png
  {
    const fileName = "water1.png";
    const url = `${baseDir}${fileName}`;
    const p = loadImage(url).then((img) => {
      if (img) {
        water = img;
      } else {
        missing.push(fileName);
      }
    });
    promises.push(p);
  }

  await Promise.all(promises);

  if (!water) {
    // Water is the only non-optional texture — create a 1x1 transparent fallback
    // so callers don't null-check on every frame.
    const fallback = new Image();
    fallback.width = 16;
    fallback.height = 16;
    water = fallback;
  }

  return {
    textures: { concave, convex, water },
    missing,
  };
}
