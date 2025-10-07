import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";

//modelo de una tarea alineado al backend
type Task = {
  _id: string;
  title: string;
  descrption?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
};

// Normaliza lo que venga del backend a nuestro shape
function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    descrption: x?.descrption ?? "",
    status:
    x?.status === "Completada" ||
    x?.status === "En Progreso" ||
    x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    try {
      const { data } = await api.get("/tasks");
      // Acepta varios formatos: [], {items: []}, {tasks: []}, {data: []}
      const raw = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setTasks(raw.map(normalizeTask));
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const { data } = await api.post("/tasks", { title: t });

    const created = normalizeTask(data?.task ?? data);
    setTasks((prev) => [created, ...prev]);
    setTitle("");
  }

  //togle status
  async function toggleTask(task: Task) {
    const newStatus = task.status === "Completada" ? "Pendiente" : "Completada";
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    
    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      // rollback
      setTasks((prev) => prev.map((x) => (x._id === task._id ? task : x)));
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;
    const before = tasks.find((t) => t._id === taskId);
    setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, title: newTitle } : t)));
    setEditingId(null);
    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle });
    } catch {
      if (before) setTasks((prev) => prev.map((t) => (t._id === taskId ? before : t)));
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup); // rollback
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/"; // Login
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((t) => (t.title || "").toLowerCase().includes(s));
    }
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  return (
    <div className="wrap">
      <header className="topbar">
        <h1>To-Do PWA</h1>
        <div className="spacer" />
        <div className="stats">
          <span>Total: {stats.total}</span>
          <span>Hechas: {stats.done}</span>
          <span>Pendientes: {stats.pending}</span>
        </div>
        <button className="btn danger" onClick={logout}>Salir</button>
      </header>

      <main>
        <form className="add" onSubmit={addTask}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nueva tarea…"
          />
          <button className="btn">Agregar</button>
        </form>

        <div className="toolbar">
          <input
            className="search"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="filters">
            <button
              className={filter === "all" ? "chip active" : "chip"}
              onClick={() => setFilter("all")}
              type="button"
            >
              Todas
            </button>
            <button
              className={filter === "active" ? "chip active" : "chip"}
              onClick={() => setFilter("active")}
              type="button"
            >
              Activas
            </button>
            <button
              className={filter === "completed" ? "chip active" : "chip"}
              onClick={() => setFilter("completed")}
              type="button"
            >
              Hechas
            </button>
          </div>
        </div>

        {loading ? (
          <p>Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">Sin tareas</p>
        ) : (
          <ul className="list">
            {filtered.map((t, idx) => (
              <li
                key={`${t._id || t.title}-${idx}`}  // key robusta
                className={t.status === "Completada" ? "item done" : "item"}
              >
                <label className="check">
                  <input
                    type="checkbox"
                    checked={t.status === "Completada"}
                    onChange={() => toggleTask(t)}
                  />
                </label>

                {editingId === t._id ? (
                  <input
                    className="edit"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(t._id)}
                    onBlur={() => saveEdit(t._id)}
                    autoFocus
                  />
                ) : (
                  <span className="title" onDoubleClick={() => startEdit(t)}>
                    {t.title || "(sin título)"}
                  </span>
                )}

                <div className="actions">
                  {editingId !== t._id && (
                    <button className="icon" title="Editar" onClick={() => startEdit(t)}>
                      Editar
                    </button>
                  )}
                  <button className="icon danger" title="Eliminar" onClick={() => removeTask(t._id)}>
                    Borrar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}