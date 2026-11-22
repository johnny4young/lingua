import type { LastAnswer } from '../../utils/lastAnswer';

type Picture = NonNullable<LastAnswer['picture']>;

const BAR_HEIGHT = 22;
const BAR_GAP = 2;
const BARS_WIDTH = 94;

function Bars({ values, height: barHeight = BAR_HEIGHT }: { values: number[]; height?: number }) {
  const width = (BARS_WIDTH - BAR_GAP * (values.length - 1)) / values.length;
  return (
    <svg width={BARS_WIDTH} height={barHeight} viewBox={`0 0 ${BARS_WIDTH} ${barHeight}`} className="shrink-0" aria-hidden>
      {values.map((value, index) => {
        const height = Math.max(1.5, (value / 100) * barHeight);
        return (
          <rect
            key={index}
            x={index * (width + BAR_GAP)}
            y={barHeight - height}
            width={width}
            height={height}
            rx={1}
            className="start-bar"
          />
        );
      })}
    </svg>
  );
}

// Phases run dns, connect, tls, waiting, download; start.css gives waiting the pulse.
function Phases({ values }: { values: number[] }) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  return (
    <span className="start-phases shrink-0" aria-hidden>
      {values.map((value, index) =>
        value > 0 ? (
          <i key={index} data-phase={index} style={{ width: `${(value / total) * 100}%` }} />
        ) : null
      )}
    </span>
  );
}

function Cells({ values }: { values: number[] }) {
  return (
    <span className="flex shrink-0 gap-[5px]" aria-hidden>
      {values.map((value, index) => (
        <i key={index} className="start-cell" data-code={value} />
      ))}
    </span>
  );
}

/** The answer's shape: bar heights, HTTP phases or test cells. Decorative; the row text carries the value. */
export function AnswerPicture({ picture, barHeight }: { picture: Picture; barHeight?: number }) {
  if (picture.values.length === 0) return null;
  if (picture.kind === 'bars') return <Bars values={picture.values} height={barHeight} />;
  if (picture.kind === 'phases') return <Phases values={picture.values} />;
  return <Cells values={picture.values} />;
}
