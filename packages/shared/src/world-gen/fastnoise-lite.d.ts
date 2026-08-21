declare module "fastnoise-lite" {
  class FastNoiseLite {
    static NoiseType: {
      readonly OpenSimplex2: "OpenSimplex2";
      readonly OpenSimplex2S: "OpenSimplex2S";
      readonly Cellular: "Cellular";
      readonly Perlin: "Perlin";
      readonly ValueCubic: "ValueCubic";
      readonly Value: "Value";
    };

    static FractalType: {
      readonly None: "None";
      readonly FBm: "FBm";
      readonly Ridged: "Ridged";
      readonly PingPong: "PingPong";
      readonly DomainWarpIndependent: "DomainWarpIndependent";
      readonly DomainWarpProgressive: "DomainWarpProgressive";
    };

    constructor(seed?: number);

    SetSeed(seed: number): void;
    SetFrequency(frequency: number): void;
    SetNoiseType(noiseType: string): void;
    SetFractalType(fractalType: string): void;
    SetFractalOctaves(octaves: number): void;
    SetFractalLacunarity(lacunarity: number): void;
    SetFractalGain(gain: number): void;
    GetNoise(x: number, y: number): number;
    GetNoise(x: number, y: number, z: number): number;
  }

  export default FastNoiseLite;
}
