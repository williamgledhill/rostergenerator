import React, { useEffect, useMemo, useRef, useState } from "react";

// Portable React roster app — easy to host on Vercel/Netlify/Amplify/S3
// No external deps. All UI and logic are self-contained.

// ---- Types ----
type TaskType =
  | "front"
  | "gallery"
  | "break"
  | "prep"
  | "tour"
  | "tidy"
  | "school-pre"
  | "school-program"; // program is treated as a "tour" for locking

type Task = {
  id: string;
  empId: string;
  type: TaskType;
  label: string; // rendered text
  start: number; // row index (0..25), inclusive
  end: number; // row index (1..26), exclusive
};

type Employee = {
  id: string;
  name: string;
  shiftStart: number; // row index inclusive
  shiftEnd: number; // row index exclusive
};

// ---- Time helpers ----
const DAY_START_MIN = 9 * 60 + 30; // 09:30
const TOTAL_ROWS = 26; // 09:30..16:00 in 15m slots
const toRow = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const mins = h * 60 + m;
  return Math.max(
    0,
    Math.min(TOTAL_ROWS, Math.floor((mins - DAY_START_MIN) / 15))
  );
};
const rowToTime = (row: number) => {
  const mins = DAY_START_MIN + row * 15;
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
};
const rowRangeLabel = (start: number, end: number) =>
  `${rowToTime(start)}-${rowToTime(end)}`;

// ---- Styling helpers ----
const COLORS: Record<TaskType | "school-program", string> = {
  front: "#FFEB3B",
  gallery: "#A5D6A7",
  break: "#E1BEE7",
  prep: "#90CAF9",
  tour: "#90CAF9",
  tidy: "#FFCC80",
  "school-pre": "#90CAF9",
  "school-program": "#90CAF9",
};

const TYPE_LABEL: Record<TaskType, string> = {
  front: "Front Desk",
  gallery: "Gallery",
  break: "Break",
  prep: "Prep",
  tour: "Public Tour",
  tidy: "Finish",
  "school-pre": "School Pre",
  "school-program": "School Program",
};

const isTourLike = (t: TaskType) => t === "tour" || t === "school-program";

// ---- ID helper ----
let seq = 0;
const uid = () => `t_${++seq}`;

// ---- Component ----
export default function RosterApp() {
  const [employees, setEmployees] = useState<Employee[]>(() => [
    { id: "e_john", name: "John", shiftStart: toRow("09:30"), shiftEnd: toRow("16:00") },
    { id: "e_robert", name: "Robert", shiftStart: toRow("09:45"), shiftEnd: toRow("16:00") },
    { id: "e_mary", name: "Mary", shiftStart: toRow("10:00"), shiftEnd: toRow("16:00") },
  ]);

  const [tasks, setTasks] = useState<Task[]>(() => [
    // Seed with a few example blocks similar to the HTML preview
    { id: uid(), empId: "e_john", type: "front", label: TYPE_LABEL.front, start: 0, end: 1 },
    { id: uid(), empId: "e_john", type: "gallery", label: TYPE_LABEL.gallery, start: 1, end: 3 },
  ]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState(44);
  const [showTypePicker, setShowTypePicker] = useState<{
    open: boolean;
    empId?: string;
    row?: number;
  }>({ open: false });
  const [showManage, setShowManage] = useState(false);
  const [modal, setModal] = useState<{kind:'add'|'rename'|'hours'|'delete', empId?: string} | null>(null);
  const [modalName, setModalName] = useState('');
  const [modalHours, setModalHours] = useState('');

  // measure row height from a rendered time cell
  useEffect(() => {
    const el = gridRef.current?.querySelector(
      '[data-kind="time-cell"][data-row="0"]'
    ) as HTMLElement | null;
    if (el) setRowH(el.getBoundingClientRect().height || 44);
  }, [employees.length]);

  // Keyboard delete/backspace to remove selected
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          setTasks((prev) => prev.filter((t) => t.id !== selectedId));
          setSelectedId(null);
        }
      }
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // Shortcuts while a modal is open
  useEffect(() => {
    if (!modal) return;
    const onK = (e: KeyboardEvent) => {
      if (e.key === 'Enter') commitModal();
      if (e.key === 'Escape') cancelModal();
    };
    window.addEventListener('keydown', onK);
    return () => window.removeEventListener('keydown', onK);
  }, [modal, modalName, modalHours]);

  // Close modals with Escape as a safety so overlays never linger
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTypePicker({ open: false });
        setShowManage(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);

  // ---- Helpers to query tasks per employee ----
  const byEmp: Record<string, Task[]> = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const e of employees) map[e.id] = [];
    for (const t of tasks) {
      (map[t.empId] ||= []).push(t);
    }
    for (const id in map) map[id].sort((a, b) => a.start - b.start);
    return map;
  }, [employees, tasks]);

  // Merge adjacent identical non-tour tasks
  const mergeAdjacent = (empId: string) => {
    setTasks((prev) => {
      const arr = [...prev].filter((t) => t.empId === empId);
      arr.sort((a, b) => a.start - b.start);
      const keep: Task[] = [];
      for (const t of arr) {
        const last = keep[keep.length - 1];
        const sameKind =
          last &&
          last.type === t.type &&
          last.label === t.label &&
          last.end === t.start &&
          !isTourLike(t.type) &&
          !isTourLike(last.type);
        if (sameKind) {
          last.end = t.end; // merge
        } else {
          keep.push({ ...t });
        }
      }
      const others = prev.filter((t) => t.empId !== empId);
      return [...others, ...keep];
    });
  };

  // Resolve overlaps: remove or trim tasks overlapped by the given range
  const resolveOverlaps = (empId: string, start: number, end: number, exceptId?: string) => {
    setTasks((prev) => {
      const next: Task[] = [];
      for (const t of prev) {
        if (t.empId !== empId || t.id == exceptId:
            # guard — we keep the one we're dragging/creating
            ):
            next.append(t)
            continue
        if (t.end <= start or t.start >= end):
            next.append(t)
            continue  # no overlap
        # Overlaps are handled by dropping or trimming
        if (t.start >= start and t.end <= end):
            continue  # fully covered -> drop
        if (t.start < start and t.end <= end):
            next.append({**t, "end": start})
            continue
        if (t.start >= start and t.end > end):
            next.append({**t, "start": end})
            continue
        if (t.start < start and t.end > end):
            next.append({**t, "end": start})
            next.append({**t, "start": end})
            continue
      return next
    })
  };

  // ---- Add task via picker ----
  const addTaskAt = (empId: string, row: number, type: TaskType) => {
    const label = TYPE_LABEL[type];
    const newTask: Task = { id: uid(), empId, type, label, start: row, end: row + 1 };
    resolveOverlaps(empId, row, row + 1);
    setTasks((prev) => [...prev, newTask]);
    if (!isTourLike(type)) mergeAdjacent(empId);
    setSelectedId(newTask.id);
  };

  // ... SNIP ...
}