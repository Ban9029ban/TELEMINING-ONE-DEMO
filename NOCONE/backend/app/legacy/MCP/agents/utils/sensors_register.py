
def filter_isolated_spikes(logs, delta=5):
    """
    Elimina lecturas que son valores críticos aislados (sin confirmación en lecturas cercanas).
    :param logs: Lista de DataLog ordenada por timestamp
    :param delta: Umbral para considerar una diferencia brusca
    """
    #print(f"[DEBUG] Filtrando spikes: total registros = {len(logs)}, delta = {delta}")

    if len(logs) < 3:
        #print("[DEBUG] No se filtran spikes: menos de 3 registros")
        return logs

    filtered = []

    for i in range(1, len(logs) - 1):
        prev = logs[i - 1].value
        curr = logs[i].value
        next_ = logs[i + 1].value
        ts = logs[i].timestamp

        if abs(curr - prev) > delta and abs(curr - next_) > delta:
            continue
        filtered.append(logs[i])

    if len(logs) >= 2:
        if abs(logs[0].value - logs[1].value) <= delta:
            filtered.insert(0, logs[0])

        if abs(logs[-1].value - logs[-2].value) <= delta:
            filtered.append(logs[-1])

    #print(f"[DEBUG] Total después del filtro: {len(filtered)}\n")
    return filtered
