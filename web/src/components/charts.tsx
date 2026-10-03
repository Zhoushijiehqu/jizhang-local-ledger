import { useMemo, useState } from 'react';
import { money, pct, type Cents } from '../core/money';

/* SVG 图表：为 1:1 复刻截图的形态手写，避免引入图表库带来的样式偏差 */

/** 轴标签：≥1 万显示 x.xxw，否则显示整数/两位小数 */
export function axisLabel(cents: number): string {
  const yuan = cents / 100;
  if (Math.abs(yuan) >= 10000) return (yuan / 10000).toFixed(2) + 'w';
  if (Math.abs(yuan) >= 1000) return (yuan / 1000).toFixed(1) + 'k';
  return yuan.toFixed(0);
}

export function BarChart({
  data, average, color = 'var(--expense)', height = 168, width = 720, unit = '¥'
}: {
  data: Array<{ label: string; value: Cents; tip?: string }>;
  average: Cents;
  color?: string;
  height?: number;
  width?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const padX = 6;
  const padTop = 26;
  const padBottom = 20;
  const max = Math.max(1, average, ...data.map((d) => d.value));
  const min = Math.min(0, average, ...data.map((d) => d.value));
  const scale = (value: number) => padTop + (max - value) / (max - min) * (height - padTop - padBottom);
  const zero = scale(0);
  const barW = (width - padX * 2) / Math.max(data.length, 1);
  const avgY = scale(average);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* 平均值虚线 */}
      {average !== 0 && (
        <>
          <line x1={padX} x2={width - padX} y1={avgY} y2={avgY}
            stroke={color} strokeWidth="1" strokeDasharray="3 4" opacity="0.75" />
        </>
      )}
      <line x1={padX} x2={width-padX} y1={zero} y2={zero} stroke="var(--text-tertiary)" strokeWidth="0.7" />
      {data.map((d, i) => {
        const h = Math.abs(scale(d.value) - zero);
        const x = padX + i * barW + barW * 0.18;
        const w = barW * 0.64;
        const y = Math.min(zero, scale(d.value));
        const on = hover === i;
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={padX + i * barW} y={0} width={barW} height={height} fill="transparent" />
            <rect x={x} y={y} width={w} height={h} rx={Math.min(2.5, w / 2)}
              fill={color} opacity={on ? 1 : 0.82} />
          </g>
        );
      })}
      {hover != null && data[hover] && (
        <g transform={`translate(${Math.min(Math.max(padX + hover * barW + barW / 2, 54), width - 54)}, 12)`}>
          <rect x={-52} y={-11} width={104} height={20} rx={10} fill="var(--text-primary)" opacity="0.9" />
          <text x={0} y={3} textAnchor="middle" fontSize="12.5" fill="#fff">
            {data[hover].tip ?? `${data[hover].label} ${unit}${(data[hover].value / 100).toFixed(2)}`}
          </text>
        </g>
      )}
      {/* Y 轴刻度：用 2.80w 这类「万」缩写 */}
      {[0, 0.5, 1].map((t) => {
        const v = max - t * (max - min);
        const y = padTop + t * (height - padTop - padBottom);
        return (
          <g key={t}>
            <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="var(--border-hair)" strokeWidth="0.5" />
            <text x={padX} y={y - 3} fontSize="11" fill="var(--text-tertiary)">{axisLabel(v)}</text>
          </g>
        );
      })}
      {data.length >= 5 && (
        <>
          <text x={padX} y={height - 5} fontSize="11.5" fill="var(--text-tertiary)">{data[0].label}</text>
          <text x={width / 2} y={height - 5} fontSize="11.5" fill="var(--text-tertiary)" textAnchor="middle">
            {data[Math.floor(data.length / 2)]?.label}
          </text>
          <text x={width - padX} y={height - 5} fontSize="11.5" fill="var(--text-tertiary)" textAnchor="end">
            {data[data.length - 1]?.label}
          </text>
        </>
      )}
      {data.length > 0 && data.length < 5 && (
        <text x={width - padX} y={height - 5} fontSize="11.5" fill="var(--text-tertiary)" textAnchor="end">
          {data[data.length - 1]?.label}
        </text>
      )}
    </svg>
  );
}

export function Donut({
  slices, total, size = 200, thickness = 24, centerTitle = '总支出'
}: {
  slices: Array<{ name: string; amount: Cents; color: string }>;
  total: Cents;
  size?: number;
  thickness?: number;
  centerTitle?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const r = (size - thickness) / 2 - 6;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const ratio = total > 0 ? s.amount / total : 0;
    const len = Math.max(c * ratio, 0);
    const el = {
      i, s, ratio,
      dash: `${len} ${c - len}`,
      offset: -acc
    };
    acc += len;
    return el;
  });
  const active = hover != null ? slices[hover] : null;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {arcs.map((a) => (
          <circle key={a.i} cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={a.s.color} strokeWidth={hover === a.i ? thickness + 5 : thickness}
            strokeDasharray={a.dash} strokeDashoffset={a.offset}
            onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)}
            style={{ transition: 'stroke-width .15s' }} />
        ))}
      </g>
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" fontSize="12.5" fill="var(--text-secondary)">
        {active ? active.name : centerTitle}
      </text>
      <text x={size / 2} y={size / 2 + 12} textAnchor="middle" fontSize="16.5" fontWeight="600" fill="var(--text-primary)">
        {money(active ? active.amount : total)}
      </text>
      {active && (
        <text x={size / 2} y={size / 2 + 28} textAnchor="middle" fontSize="11.5" fill="var(--text-secondary)">
          {pct(total > 0 ? active.amount / total : 0)}
        </text>
      )}
    </svg>
  );
}

/**
 * 带引线标签的环形图：标签环绕在环外。
 * 只标注占比最大的前 maxLabels 个切片，避免窄扇区互相压字。
 */
export function DonutWithLabels({
  slices, total, size = 240, thickness = 22, centerTitle = '总支出', maxLabels = 6
}: {
  slices: Array<{ name: string; amount: Cents; color: string }>;
  total: Cents;
  size?: number;
  thickness?: number;
  centerTitle?: string;
  maxLabels?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const r = (size - thickness) / 2 - 30;
  const c = 2 * Math.PI * r;
  const ranked = [...slices].sort((a, b) => b.amount - a.amount);
  const labelSet = new Set(ranked.slice(0, maxLabels).map((s) => s.name));

  let acc = 0;
  const arcs = slices.map((s) => {
    const ratio = total > 0 ? s.amount / total : 0;
    const len = Math.max(c * ratio, 0);
    const mid = acc + len / 2;
    const a = (mid / c) * 2 * Math.PI;
    acc += len;
    return { s, ratio, dash: `${len} ${c - len}`, offset: -(mid - len / 2), a };
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: size, height: 'auto' }}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {arcs.map((x, i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={x.s.color}
            strokeWidth={thickness} strokeDasharray={x.dash} strokeDashoffset={x.offset} />
        ))}
      </g>
      {arcs.filter((x) => labelSet.has(x.s.name)).map((x, i) => {
        const r1 = r + thickness / 2 + 3;
        const r2 = r + thickness / 2 + 12;
        const x1 = cx + Math.cos(x.a) * r1, y1 = cy + Math.sin(x.a) * r1;
        const x2 = cx + Math.cos(x.a) * r2, y2 = cy + Math.sin(x.a) * r2;
        const right = Math.cos(x.a) >= 0;
        const x3 = x2 + (right ? 14 : -14);
        return (
          <g key={`l${i}`}>
            <path d={`M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3ify(y2)}`} fill="none"
              stroke="var(--border-tertiary, rgba(127,127,127,.35))" strokeWidth="0.6" />
            <text x={x3 + (right ? 3 : -3)} y={y2 - 3} fontSize="11.5" textAnchor={right ? 'start' : 'end'}
              fill="var(--text-secondary)">{x.s.name}</text>
            <text x={x3 + (right ? 3 : -3)} y={y2 + 7} fontSize="11.5" textAnchor={right ? 'start' : 'end'}
              fill="var(--text-tertiary)">{pct(x.ratio)}</text>
          </g>
        );
      })}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize="11.5" fill="var(--text-secondary)">{centerTitle}</text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize="16.5" fontWeight="600" fill="var(--text-primary)">
        {money(total)}
      </text>
    </svg>
  );
}

function y3ify(y: number): number { return y; }

export function AreaTrend({
  points, color = 'var(--warn)', height = 150, width = 720, labels
}: {
  points: Cents[];
  color?: string;
  height?: number;
  width?: number;
  labels: [string, string, string];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const padY = 16;
    const h = height - padY - 20;
    const xs = points.map((_, i) => (i / (points.length - 1)) * (width - 12) + 6);
    const ys = points.map((v) => padY + (1 - (v - min) / span) * h);
    let d = `M ${xs[0]} ${ys[0]}`;
    for (let i = 1; i < points.length; i++) {
      const cx1 = xs[i - 1] + (xs[i] - xs[i - 1]) / 2;
      d += ` C ${cx1} ${ys[i - 1]}, ${cx1} ${ys[i]}, ${xs[i]} ${ys[i]}`;
    }
    const area = `${d} L ${xs[xs.length - 1]} ${height - 20} L ${xs[0]} ${height - 20} Z`;
    return { xs, ys, d, area, min, max };
  }, [points, height, width]);

  if (!geom) return <div className="empty">数据不足</div>;
  const gid = `g-${Math.abs(points[0])}-${points.length}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={geom.area} fill={`url(#${gid})`} />
      <path d={geom.d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      {points.map((v, i) => (
        <rect key={i} x={geom.xs[i] - 6} y={0} width={12} height={height} fill="transparent"
          onMouseEnter={() => setHover(i)} />
      ))}
      {hover != null && (
        <>
          <line x1={geom.xs[hover]} x2={geom.xs[hover]} y1={8} y2={height - 20}
            stroke="var(--text-tertiary)" strokeWidth="1" strokeDasharray="2 3" />
          <circle cx={geom.xs[hover]} cy={geom.ys[hover]} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
          <g transform={`translate(${Math.min(Math.max(geom.xs[hover], 56), width - 56)}, 8)`}>
            <rect x={-52} y={-4} width={104} height={19} rx={9.5} fill="var(--text-primary)" opacity="0.9" />
            <text x={0} y={9} textAnchor="middle" fontSize="12.5" fill="#fff">{money(points[hover])}</text>
          </g>
        </>
      )}
      {/* Y 轴刻度：最高 / 中间 / 最低 */}
      {[0, 0.5, 1].map((t) => {
        const y = 16 + t * (height - 36);
        const v = geom.max - t * (geom.max - geom.min);
        return (
          <g key={t}>
            <line x1={6} x2={width - 6} y1={y} y2={y} stroke="var(--border-hair)" strokeWidth="0.5" />
            <text x={8} y={y - 3} fontSize="11" fill="var(--text-tertiary)">{axisLabel(v)}</text>
          </g>
        );
      })}
      <text x={6} y={height - 4} fontSize="11.5" fill="var(--text-tertiary)">{labels[0]}</text>
      <text x={width / 2} y={height - 4} fontSize="11.5" fill="var(--text-tertiary)" textAnchor="middle">{labels[1]}</text>
      <text x={width - 6} y={height - 4} fontSize="11.5" fill="var(--text-tertiary)" textAnchor="end">{labels[2]}</text>
    </svg>
  );
}

export function ProgressRing({
  ratio, size = 66, stroke = 7, color = 'var(--accent)', center
}: {
  ratio: number;
  size?: number;
  stroke?: number;
  color?: string;
  center?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const len = Math.max(0, Math.min(1, ratio)) * c;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-chip)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={`${len} ${c - len}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      {center && (
        <text x={size / 2} y={size / 2 + 3} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text-primary)">
          {center}
        </text>
      )}
    </svg>
  );
}
