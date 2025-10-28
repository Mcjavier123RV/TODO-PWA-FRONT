import { api } from "../api";
import {
  getOutbox,
  clearOutbox,
  setMapping,
  getMapping,
  putTaskLocal,
  removeTaskLocal,
} from "./db";

export async function syncNow() {
  if (!navigator.onLine) return;

  // 1. Obtener operaciones pendientes ordenadas por timestamp
  const ops = (await getOutbox()).sort((a, b) => a.ts - b.ts);
  if (!ops.length) return;

  for (const op of ops) {
    try {
      if (op.op === "create") {
        // Crear tarea en el servidor
        const res = await api.post("/tasks", op.data);
        const serverId = res.data._id;

        // Guardar mapeo (clienteId -> serverId)
        await setMapping(op.clienteId, serverId);

        // Actualizar en cache local con el ID del servidor
        await putTaskLocal({ ...op.data, _id: serverId });
      }

      else if (op.op === "update") {
        const serverId = op.serverId || (await getMapping(op.clienteId));
        if (serverId) {
          await api.put(`/tasks/${serverId}`, op.data);
          await putTaskLocal({ ...op.data, _id: serverId });
        }
      }

      else if (op.op === "delete") {
        const serverId = op.serverId || (await getMapping(op.clienteId));
        if (serverId) {
          await api.delete(`/tasks/${serverId}`);
        }
        await removeTaskLocal(op.clienteId || serverId);
      }

    } catch (err) {
      console.error("Error al sincronizar:", err);
    }
  }

  // 2. Limpiar la cola si todo fue exitoso
  await clearOutbox();
  console.log("✅ Sincronización completada");
}
