import type { Sex } from "../model/simulate";

export interface BodyDelta {
  offset: number;
  joints: number[][];
}

export interface BodyMeta {
  vertexCount: number;
  indexCount: number;
  quant: number;
  joints: { name: string; parent: string | null }[];
  skinIndex: number;
  skinWeight: number;
  index: number;
  opening: number;
  sexes: Record<Sex, { base: number; joints: number[][]; deltas: Record<BodyDeltaName, BodyDelta> }>;
}

export type BodyDeltaName = "weight_up" | "weight_down" | "height_up" | "height_down" | "age_up";

export interface OrganMeshMeta {
  pos: number;
  vertexCount: number;
  index: number;
  indexCount: number;
  center: number[];
  min: number[];
  max: number[];
  along?: number; // a tube's distance along itself at each vertex
}

export interface OrganMeta {
  quant: number;
  organs: Record<string, OrganMeshMeta>;
  landmarks: Record<string, number[]>;
  centerlines: Record<string, number[][]>;
  vesselRadius: Record<string, number>;
}

export interface BodyAsset {
  meta: BodyMeta;
  bin: ArrayBuffer;
}

export interface OrganAsset {
  meta: OrganMeta;
  bin: ArrayBuffer;
}

async function loadPair<T>(name: string): Promise<{ meta: T; bin: ArrayBuffer }> {
  const [metaResponse, binResponse] = await Promise.all([fetch(`assets/${name}.json`), fetch(`assets/${name}.bin`)]);
  if (!metaResponse.ok || !binResponse.ok) throw new Error(`Could not load ${name}: ${metaResponse.status}/${binResponse.status}`);
  const [meta, bin] = await Promise.all([metaResponse.json() as Promise<T>, binResponse.arrayBuffer()]);
  return { meta, bin };
}

export const loadBody = () => loadPair<BodyMeta>("body");
export const loadOrgans = (sex: Sex) => loadPair<OrganMeta>(`organs-${sex}`);
