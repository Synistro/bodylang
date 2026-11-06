import { ComponentType, memo, useMemo } from "react";
import { ComposedSpec, compositionOf, layoutComposed, PlacedActor, PlacedLayer } from "../../closeup/composed";
import { sourced } from "../sources";
import "./closeup.css";
import { easeToward, lerp, part, parts, smoothstep, tenth } from "./draw";
import { Frame, Painter, useInsetPainter } from "./loop";
import { nerve } from "./parts/nerve";
import { Part, setLit, setShown } from "./parts/part";
import { TEAR, TEAR_HEIGHT } from "./parts/tear";
import { vessel } from "./parts/vessel";
import { ART_WIDTH, Plate } from "./Plate";
import { createStream, Placer } from "./stream";

const EASE_PER_SECOND = 2.4;
const BLEED = 10;
const FROM_X = -BLEED;
const TO_X = ART_WIDTH + BLEED;
const MIDDLE = ART_WIDTH / 2;
const CELLS_IN_A_ROW = 7;
const MIDDLE_CELL = (CELLS_IN_A_ROW - 1) / 2;
const TEARS = [1, 4, 2, 5, 0, 3]; // which cells tear first, spread along the row
const FLOWING_UNTIL = 0.5; // how far along a blocked vessel its red cells get
const ACTOR = {
  cell: { pool: 10, r: 4.4, seconds: 6, most: 1.6, spread: 34 },
  molecule: { pool: 16, r: 2.3, seconds: 3.6, most: 3.6, spread: 26 },
  dot: { pool: 18, r: 1.4, seconds: 3.2, most: 5, spread: 30 },
  pulse: { pool: 10, r: 2, seconds: 2.6, most: 3.2, spread: 0 },
} as const;
const SETTLES_BY = 0.55;

const wave = (y: number): [number, number][] => [
  [FROM_X, y],
  [70, y - 1.6],
  [150, y + 1.4],
  [TO_X, y - 0.8],
];

interface TubeInput {
  signal: number;
  until: number;
}

// The two kinds of layer that are parts of their own, painted the same way from here.
function tubeFor({ layer, center, height }: PlacedLayer): Part<TubeInput> | null {
  if (layer.kind === "blood" || layer.kind === "lymph") {
    const tube = vessel({ id: `${layer.id}-tube`, radius: height / 2, points: wave(center), tone: layer.kind });
    return {
      Art: tube.Art,
      attach: (art) => {
        const paint = tube.attach(art);
        return (frame, { until }) => paint(frame, { lit: 1, until });
      },
    };
  }
  if (layer.kind === "nerve") {
    const tube = nerve({ id: `${layer.id}-line`, points: wave(center), endings: [] });
    return {
      Art: tube.Art,
      attach: (art) => {
        const paint = tube.attach(art);
        return (frame, { signal }) => paint(frame, { signal });
      },
    };
  }
  return null;
}

function LayerArt({ placed, Tube }: { placed: PlacedLayer; Tube: ComponentType | null }) {
  const { layer, top, height, center, word } = placed;
  const cellWidth = ART_WIDTH / CELLS_IN_A_ROW;
  return (
    <>
      <text className="composed-word" x={word.x} y={word.y} dominantBaseline="central">
        {layer.label}
      </text>
      <g data-part="layer" data-id={layer.id}>
        {Tube ? <Tube /> : null}
        {layer.kind === "air" ? (
          <rect className="composed-air" x={FROM_X} y={tenth(top)} width={TO_X - FROM_X} height={tenth(height)} />
        ) : null}
        {layer.kind === "wall" ? (
          <path
            className="composed-wall"
            d={`M${FROM_X} ${tenth(center - height / 2)}H${TO_X}M${FROM_X} ${tenth(center + height / 2)}H${TO_X}`}
          />
        ) : null}
        {layer.kind === "tissue"
          ? Array.from({ length: CELLS_IN_A_ROW }, (_, i) => (
              <g key={i}>
                <rect
                  className="composed-cell"
                  x={tenth(i * cellWidth + 1)}
                  y={tenth(top)}
                  width={tenth(cellWidth - 2)}
                  height={tenth(height)}
                  rx="5"
                />
                <circle className="composed-nucleus" cx={tenth((i + 0.5) * cellWidth)} cy={tenth(center)} r="2" />
              </g>
            ))
          : null}
        <rect
          data-part="inflamed"
          className="composed-inflamed"
          x={FROM_X}
          y={tenth(top)}
          width={TO_X - FROM_X}
          height={tenth(height)}
        />
        {(layer.kind === "tissue" ? TEARS : [MIDDLE_CELL]).map((cell) => (
          <path
            key={cell}
            data-part="tear"
            className="composed-gap"
            transform={`translate(${tenth((cell + 0.5) * cellWidth + (layer.kind === "tissue" ? cellWidth * 0.28 : 0))} ${tenth(center)}) scale(${tenth(Math.max(0.8, (height + 3) / TEAR_HEIGHT))})`}
            d={TEAR}
          />
        ))}
        {layer.kind === "blood" ? (
          <>
            <g data-part="blocked">
              <rect
                className="composed-beyond"
                x={MIDDLE}
                y={tenth(top)}
                width={TO_X - MIDDLE}
                height={tenth(height)}
              />
              <rect
                className="composed-plug"
                x={MIDDLE - 8}
                y={tenth(top - 0.5)}
                width="16"
                height={tenth(height + 1)}
                rx="4"
              />
            </g>
            <g data-part="narrowed">
              <path
                className="composed-plaque"
                d={`M${MIDDLE - 22} ${tenth(top)}Q${MIDDLE} ${tenth(top + height * 0.9)} ${MIDDLE + 22} ${tenth(top)}Z`}
              />
              <path
                className="composed-plaque"
                d={`M${MIDDLE - 22} ${tenth(top + height)}Q${MIDDLE} ${tenth(top + height * 0.1)} ${MIDDLE + 22} ${tenth(top + height)}Z`}
              />
            </g>
          </>
        ) : null}
      </g>
    </>
  );
}

function ActorArt({ placed }: { placed: PlacedActor }) {
  const { actor, word } = placed;
  const look = ACTOR[actor.look];
  return (
    <g data-part="actor" data-id={actor.id}>
      <g data-part="movers">
        {Array.from({ length: look.pool }, (_, k) => (
          <circle
            key={k}
            data-part="mover"
            className="composed-actor"
            data-look={actor.look}
            data-tone={actor.tone}
            r={look.r}
          />
        ))}
      </g>
      <text
        data-part="actor-word"
        className="composed-actor-word"
        x={word.x}
        y={word.y}
        textAnchor={word.anchor}
        dominantBaseline="central"
      >
        {actor.label}
      </text>
    </g>
  );
}

const placerFor = ({ actor, column, fromY, toY }: PlacedActor): Placer => {
  const { spread } = ACTOR[actor.look];
  if (actor.from === actor.to)
    return (progress, seat) => ({ x: lerp(FROM_X, TO_X, progress), y: fromY + (seat - 0.5) * 5 });
  return (progress, seat) => {
    const x = column + (seat - 0.5) * spread;
    if (!actor.settles)
      return { x, y: lerp(fromY, toY, smoothstep(0, 1, progress)), opacity: 1 - smoothstep(0.9, 1, progress) };
    if (progress < SETTLES_BY) return { x, y: lerp(fromY, toY, smoothstep(0, 1, progress / SETTLES_BY)) };
    return {
      x: x + Math.sin(progress * 8 + seat * 20),
      y: toY + Math.cos(progress * 6 + seat * 30),
      opacity: 1 - smoothstep(0.93, 1, progress),
    };
  };
};

function createPainter(placedLayers: PlacedLayer[], placedActors: PlacedActor[], tubes: Map<string, Part<TubeInput>>) {
  return (art: SVGSVGElement): Painter<ComposedSpec> => {
    const amounts = new Map<string, number>();
    const lit = new Map<string, number>();
    const eased = (store: Map<string, number>, key: string, target: number, frame: Frame) => {
      const before = store.get(key);
      const next = frame.still || before === undefined ? target : easeToward(before, target, frame.dt, EASE_PER_SECOND);
      store.set(key, next);
      return next;
    };
    const layerGroups = new Map(parts<SVGGElement>(art, "layer").map((group) => [group.dataset.id!, group]));
    const actorGroups = new Map(parts<SVGGElement>(art, "actor").map((group) => [group.dataset.id!, group]));
    const painters = placedLayers.map(({ layer }) => {
      const group = layerGroups.get(layer.id)!;
      const tube = tubes.get(layer.id);
      return {
        id: layer.id,
        kind: layer.kind,
        group,
        tube: tube?.attach(art) ?? null,
        tears: parts<SVGPathElement>(group, "tear"),
        inflamed: part<SVGRectElement>(group, "inflamed"),
        blocked: group.querySelector<SVGGElement>('[data-part="blocked"]'),
        narrowed: group.querySelector<SVGGElement>('[data-part="narrowed"]'),
      };
    });
    const actors = placedActors.map((placed) => {
      const group = actorGroups.get(placed.actor.id)!;
      const movers = parts<SVGCircleElement>(group, "mover");
      return {
        placed,
        movers: part<SVGGElement>(group, "movers"),
        word: part<SVGTextElement>(group, "actor-word"),
        stream: createStream(movers, ACTOR[placed.actor.look].seconds, 7),
        place: placerFor(placed),
      };
    });
    return (frame, spec) => {
      const litOf = (id: string) => (!spec.light.length || spec.light.includes(id) ? 1 : 0);
      for (const painter of painters) {
        const layer = spec.layers.find((l) => l.id === painter.id);
        if (!layer) continue;
        const amount = (state: string) =>
          eased(amounts, `${painter.id}/${state}`, layer.state === state ? layer.amount : 0, frame);
        const shining = eased(lit, painter.id, litOf(painter.id), frame);
        setLit(painter.group, shining);
        const torn = amount("torn");
        painter.tears.forEach((tear, i) =>
          setShown(tear, painter.tears.length === 1 ? torn * 3 : torn * painter.tears.length - i),
        );
        setShown(painter.inflamed, amount("inflamed") * 0.7);
        const blocked = amount("blocked");
        if (painter.blocked) setShown(painter.blocked, blocked * 3);
        if (painter.narrowed) setShown(painter.narrowed, amount("narrowed") * 2);
        painter.tube?.(frame, {
          signal: eased(amounts, `${painter.id}/signal`, layer.kind === "nerve" ? layer.amount : 0, frame),
          until: lerp(1, FLOWING_UNTIL, Math.min(1, blocked * 3)),
        });
      }
      for (const { placed, movers, word, stream, place } of actors) {
        const actor = spec.actors.find((a) => a.id === placed.actor.id);
        if (!actor) continue;
        const shining = eased(lit, actor.id, litOf(actor.id), frame);
        const amount = eased(amounts, actor.id, actor.amount, frame);
        setLit(movers, shining);
        setShown(word, amount * 4, shining);
        stream(frame, amount * ACTOR[actor.look].most, place);
      }
    };
  };
}

function ComposedPlate({ spec }: { spec: ComposedSpec }) {
  // The parent keys this on the composition, so what is built here holds for as long as the picture does.
  const { create, Art } = useMemo(() => {
    const { layers, actors } = layoutComposed(spec);
    const tubes = new Map(
      layers.flatMap((placed) => {
        const tube = tubeFor(placed);
        return tube ? [[placed.layer.id, tube] as const] : [];
      }),
    );
    return {
      create: createPainter(layers, actors, tubes),
      Art: memo(function Art() {
        return (
          <>
            {layers.map((placed) => (
              <LayerArt key={placed.layer.id} placed={placed} Tube={tubes.get(placed.layer.id)?.Art ?? null} />
            ))}
            {actors.map((placed) => (
              <ActorArt key={placed.actor.id} placed={placed} />
            ))}
          </>
        );
      }),
    };
  }, []);
  const art = useInsetPainter(create, spec);
  return (
    <Plate
      caption={spec.caption}
      describe={`${spec.caption}. ${spec.layers.map((layer) => layer.label).join(", ")}.`}
      artRef={art}
    >
      <Art />
    </Plate>
  );
}

// A drawing Claude composed for this step, in the place the organ's own drawing would be.
export function ComposedInset({ spec }: { spec: ComposedSpec }) {
  return (
    <div
      {...sourced({
        kind: "claude-input",
        detail: `Claude composed this drawing and the app laid it out. It isn't to scale, and how much of each thing it shows is Claude's illustration. Its basis: ${spec.basis}`,
      })}
    >
      <ComposedPlate key={compositionOf(spec)} spec={spec} />
    </div>
  );
}
