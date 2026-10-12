export interface FixtureTodo {
  id: number;
  title: string;
  list: "home" | "shopping" | "garden";
  due: string | null;
  done: boolean;
}

export const FIXTURES: FixtureTodo[] = [
  { id: 1, title: "Buy dish soap", list: "shopping", due: "2026-03-02", done: false },
  { id: 2, title: "Oat milk", list: "shopping", due: null, done: false },
  { id: 3, title: "Fix the gate latch", list: "garden", due: "2026-03-04", done: false },
  { id: 4, title: "Prune the apple tree", list: "garden", due: null, done: false },
  { id: 5, title: "Descale the kettle", list: "home", due: "2026-03-01", done: false },
  { id: 6, title: "Replace hallway bulb", list: "home", due: null, done: true },
  { id: 7, title: "Book chimney sweep", list: "home", due: "2026-03-10", done: false },
  { id: 8, title: "Coffee beans", list: "shopping", due: null, done: true },
];
