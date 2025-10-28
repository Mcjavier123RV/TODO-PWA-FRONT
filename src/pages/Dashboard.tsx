import { useEffect, useMemo, useState } from "react";
import { useNavigate } from 'react-router-dom';
import { api, setAuth } from "../api";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  getOutbox,
  clearOutbox,
  setMapping,
  getMapping,
} from "../offline/db";


type Task = {
  _id: string;
  title: string;
  descrption?: string;
  status: "Pendiente" | "En Progreso" | "Completada";
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
};

// === Normaliza datos del backend ===
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

  const isOnline = useOnlineStatus();
  const navigate = useNavigate();


  // === Carga inicial ===
  useEffect(() => {
    setAuth(localStorage.getItem("token"));
    loadTasks();

    // Sincroniza automáticamente al volver online
    window.addEventListener("online", syncNow);
    return () => window.removeEventListener("online", syncNow);
  }, []);

  // === Cargar tareas (online / offline) ===
  async function loadTasks() {
    setLoading(true);
    try {
      if (navigator.onLine) {
        const { data } = await api.get("/tasks");
        const raw = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(data)
          ? data
          : [];
        const list = raw.map(normalizeTask);
        setTasks(list);
        await cacheTasks(list); // guarda en IndexedDB
      } else {
        // modo offline
        const cached = await getAllTasksLocal();
        setTasks(cached);
      }
    } finally {
      setLoading(false);
    }
  }

  // === Sincronización offline → online ===
  async function syncNow() {
    const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts);
    if (!ops.length) return;

    for (const op of ops) {
      try {
        if (op.op === "create") {
          const { data } = await api.post("/tasks", op.data);
          const serverTask = normalizeTask(data?.task ?? data);
          await setMapping(op.clienteId, serverTask._id);
          await putTaskLocal(serverTask);
        } else if (op.op === "update") {
          const id = (await getMapping(op.clienteId)) ?? op.serverId;
          if (id) {
            await api.put(`/tasks/${id}`, op.data);
            await putTaskLocal({ ...op.data, _id: id });
          }
        } else if (op.op === "delete") {
          const id = (await getMapping(op.clienteId)) ?? op.serverId;
          if (id) {
            await api.delete(`/tasks/${id}`);
            await removeTaskLocal(id);
          }
        }
      } catch (err) {
        console.warn("Error al sincronizar:", err);
      }
    }

    await clearOutbox();
    await loadTasks();
  }

  // === Agregar tarea ===
  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const newTask: Task = {
      _id: clienteId,
      title: t,
      status: "Pendiente",
      clienteId,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [newTask, ...prev]);
    await putTaskLocal(newTask);
    setTitle("");

    if (navigator.onLine) {
      try {
        const { data } = await api.post("/tasks", { title: t });
        const serverTask = normalizeTask(data?.task ?? data);
        await setMapping(clienteId, serverTask._id);
        await putTaskLocal(serverTask);
      } catch {
        await queue({
          id: crypto.randomUUID(),
          op: "create",
          clienteId,
          data: newTask,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        id: crypto.randomUUID(),
        op: "create",
        clienteId,
        data: newTask,
        ts: Date.now(),
      });
    }
  }

  // === Cambiar estado ===
  async function toggleTask(task: Task) {
    const newStatus = task.status === "Completada" ? "Pendiente" : "Completada";
    const updated = { ...task, status: newStatus };
    setTasks((prev) =>
    prev.map((x) => (x._id === task._id ? (updated as Task) : x))
  );
    await putTaskLocal(updated);

    const opData = { status: newStatus };

    if (navigator.onLine) {
      try {
        const id = (await getMapping(task.clienteId ?? "")) ?? task._id;
        await api.put(`/tasks/${id}`, opData);
      } catch {
        await queue({
          id: crypto.randomUUID(),
          op: "update",
          clienteId: task.clienteId ?? "",
          data: updated,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        id: crypto.randomUUID(),
        op: "update",
        clienteId: task.clienteId ?? "",
        data: updated,
        ts: Date.now(),
      });
    }
  }

  // === Editar tarea ===
  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    if (!newTitle) return;

    const before = tasks.find((t) => t._id === taskId);
    const updated = { ...before!, title: newTitle };

    setTasks((prev) => prev.map((t) => (t._id === taskId ? updated : t)));
    setEditingId(null);
    await putTaskLocal(updated);

    if (navigator.onLine) {
      try {
        const id = (await getMapping(updated.clienteId ?? "")) ?? updated._id;
        await api.put(`/tasks/${id}`, { title: newTitle });
      } catch {
        await queue({
          id: crypto.randomUUID(),
          op: "update",
          clienteId: updated.clienteId ?? "",
          data: updated,
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        id: crypto.randomUUID(),
        op: "update",
        clienteId: updated.clienteId ?? "",
        data: updated,
        ts: Date.now(),
      });
    }
  }

  // === Eliminar tarea ===
  async function removeTask(taskId: string) {
    const task = tasks.find((t) => t._id === taskId);
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    if (navigator.onLine) {
      try {
        const id = (await getMapping(task?.clienteId ?? "")) ?? taskId;
        await api.delete(`/tasks/${id}`);
      } catch {
        await queue({
          id: crypto.randomUUID(),
          op: "delete",
          clienteId: task?.clienteId ?? "",
          ts: Date.now(),
        });
      }
    } else {
      await queue({
        id: crypto.randomUUID(),
        op: "delete",
        clienteId: task?.clienteId ?? "",
        ts: Date.now(),
      });
    }
  }

  // === Logout ===
  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    navigate("/login", { replace: true });
  }

  // === Filtros y estadísticas ===
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

  // === UI ===
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
        
        {/* 👇 Indicador de conexión */}
        <div className={`estado-conexion ${isOnline ? "online" : "offline"}`}>
          {isOnline ? "🟢 Online" : "🔴 Offline"}
        </div>
        
        <button className="btn danger" onClick={logout}>
          Salir
        </button>
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
                key={`${t._id || t.title}-${idx}`}
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
