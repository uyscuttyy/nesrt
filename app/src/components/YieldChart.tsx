"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { t: number; v: number };

const KEY = "tslax-yield-history-v1";
const MAX_POINTS = 200;

/** Yield trajectory from live position snapshots, persisted locally. */
export default function YieldChart({ value }: { value: number | null }) {
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPoints(JSON.parse(raw) as Point[]);
    } catch {
      setPoints([]);
    }
  }, []);

  useEffect(() => {
    if (value === null) return;
    setPoints((prev) => {
      const next = [...prev, { t: Date.now(), v: value }];
      const trimmed = next.slice(-MAX_POINTS);
      try {
        localStorage.setItem(KEY, JSON.stringify(trimmed));
      } catch {
        /* storage full or unavailable, chart still works in memory */
      }
      return trimmed;
    });
  }, [value]);

  if (points.length < 2) {
    return (
      <div className="card">
        <span className="label">Yield trajectory</span>
        <p className="muted">
          Your position chart starts building after your first deposits.
        </p>
      </div>
    );
  }

  const first = points[0].v;
  const last = points[points.length - 1].v;
  const delta = last - first;
  const data = points.map((p) => ({
    ...p,
    time: new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  }));

  return (
    <div className="card">
      <span className="label">Yield trajectory</span>
      <strong>
        {last.toFixed(6)} TSLAx{" "}
        <span className={delta >= 0 ? "up" : "down"}>
          ({delta >= 0 ? "+" : ""}{delta.toFixed(6)})
        </span>
      </strong>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="time" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={48} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
              domain={["auto", "auto"]}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <Tooltip formatter={(v) => [`${Number(v).toFixed(6)} TSLAx`, "Position"]} />
            <Area type="monotone" dataKey="v" strokeWidth={2} fillOpacity={0.18} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
