#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# CONFIGURACION REDES SERVIDOR
# ============================================================
# Red 1: Codelco / acceso HTTP al sistema + fuentes externas
CON_CODELCO="codelco"
IF_CODELCO="eno1"
CODELCO_IP="10.18.43.64/24"
CODELCO_NETWORK="10.18.43.0/24"
CODELCO_GW="10.18.43.1"
CODELCO_DNS="165.182.168.247,165.182.168.248"
CODELCO_SOURCE_IP="${CODELCO_IP%/*}"
CODELCO_ROUTE_TABLE="101"
CODELCO_RULE_PRIORITY="101"

# Red 2: Internet principal
CON_INTERNET="internet"
IF_INTERNET="eno2"

# Red 3: PLC aislado
CON_PLC="plc"
IF_PLC="eno3"
PLC_IP="192.168.1.100/24"
PLC_NETWORK="192.168.1.0/24"

# Red 4: Internet secundario / respaldo
CON_INTERNET_BKP="internet_bkp"
IF_INTERNET_BKP="eno4"

# Zonas firewalld
ZONE_CODELCO="codelco"
ZONE_INTERNET="public"
ZONE_PLC="block"

# Rutas especificas por Codelco para fuentes externas.
# Formato nmcli: "DESTINO/PREFIJO GATEWAY"
CODELCO_ROUTES=(
  "10.18.18.83/32 ${CODELCO_GW}"
)

# Policy routing para que todo trafico con origen en la IP Codelco
# responda por eno1, incluso si la salida general es por Internet.
CODELCO_POLICY_ROUTES=(
  "${CODELCO_NETWORK} src=${CODELCO_SOURCE_IP} table=${CODELCO_ROUTE_TABLE}"
  "0.0.0.0/1 ${CODELCO_GW} table=${CODELCO_ROUTE_TABLE}"
  "128.0.0.0/1 ${CODELCO_GW} table=${CODELCO_ROUTE_TABLE}"
)

CODELCO_VALIDATION_ROUTE="${CODELCO_ROUTES[0]}"
CODELCO_VALIDATION_DEST="${CODELCO_VALIDATION_ROUTE%% *}"
CODELCO_VALIDATION_IP="${CODELCO_VALIDATION_DEST%/*}"

# Puertos sistema HTTP expuestos por Docker/host
HTTP_PORTS=(
  "80/tcp"
  "443/tcp"
  "15173/tcp"
  "18000/tcp"
  "9000/tcp"
)

echo "============================================================"
echo " CONFIGURACION DE REDES"
echo "============================================================"
echo "eno1 = Codelco (HTTP + fuentes externas)"
echo "eno2 = Internet principal"
echo "eno3 = PLC aislado"
echo "eno4 = Internet respaldo"
echo "============================================================"

# ------------------------------------------------------------
# Limpieza previa de conexiones duplicadas por nombre
# ------------------------------------------------------------
echo "==> Eliminando conexiones anteriores controladas por este script"

for CON in "${CON_CODELCO}" "${CON_INTERNET}" "${CON_PLC}" "${CON_INTERNET_BKP}"; do
  while nmcli -t -f NAME con show | grep -qx "${CON}"; do
    sudo nmcli con delete "${CON}" 2>/dev/null || true
  done
done

echo "==> Eliminando perfiles anteriores en las interfaces objetivo"

while IFS=: read -r NAME DEVICE; do
  [[ -n "${NAME}" ]] || continue
  case "${DEVICE}" in
    "${IF_CODELCO}"|"${IF_INTERNET}"|"${IF_PLC}"|"${IF_INTERNET_BKP}")
      sudo nmcli con delete "${NAME}" 2>/dev/null || true
      ;;
  esac
done < <(nmcli -t -f NAME,DEVICE con show)

# ------------------------------------------------------------
# Limpieza de rutas temporales antiguas
# ------------------------------------------------------------
echo "==> Limpiando rutas temporales antiguas"

for ROUTE in "${CODELCO_ROUTES[@]}"; do
  DEST="$(echo "${ROUTE}" | awk '{print $1}')"
  DEST_IP="${DEST%/*}"
  sudo ip route del "${DEST}" 2>/dev/null || true
  sudo ip route del "${DEST_IP}" 2>/dev/null || true
done

while sudo ip rule show | grep -q "^${CODELCO_RULE_PRIORITY}:.*from ${CODELCO_SOURCE_IP}.*lookup ${CODELCO_ROUTE_TABLE}"; do
  sudo ip rule del priority "${CODELCO_RULE_PRIORITY}" 2>/dev/null || true
done

sudo ip route flush table "${CODELCO_ROUTE_TABLE}" 2>/dev/null || true
sudo ip route flush cache || true

# ------------------------------------------------------------
# Red Codelco - eno1
# ------------------------------------------------------------
echo "==> Configurando Red Codelco en ${IF_CODELCO}"

sudo nmcli con add type ethernet ifname "${IF_CODELCO}" con-name "${CON_CODELCO}" \
  ipv4.method manual \
  ipv4.addresses "${CODELCO_IP}" \
  ipv4.gateway "${CODELCO_GW}" \
  ipv4.dns "${CODELCO_DNS}"

# Codelco no sera default general.
# Se usa para:
# - acceso HTTP desde Codelco
# - fuentes externas ubicadas en Codelco
# - respuestas cuyo origen sea la IP Codelco
sudo nmcli con modify "${CON_CODELCO}" \
  ipv4.never-default yes \
  ipv4.ignore-auto-routes yes \
  ipv4.route-metric 50 \
  ipv4.routing-rules "priority ${CODELCO_RULE_PRIORITY} from ${CODELCO_SOURCE_IP}/32 table ${CODELCO_ROUTE_TABLE}" \
  connection.autoconnect yes \
  connection.zone "${ZONE_CODELCO}"

for ROUTE in "${CODELCO_ROUTES[@]}"; do
  sudo nmcli con modify "${CON_CODELCO}" +ipv4.routes "${ROUTE}"
done

for ROUTE in "${CODELCO_POLICY_ROUTES[@]}"; do
  sudo nmcli con modify "${CON_CODELCO}" +ipv4.routes "${ROUTE}"
done

# ------------------------------------------------------------
# Red Internet principal - eno2
# ------------------------------------------------------------
echo "==> Configurando Internet principal en ${IF_INTERNET}"

sudo nmcli con add type ethernet ifname "${IF_INTERNET}" con-name "${CON_INTERNET}" \
  ipv4.method auto

sudo nmcli con modify "${CON_INTERNET}" \
  ipv4.never-default no \
  ipv4.ignore-auto-routes no \
  ipv4.ignore-auto-dns no \
  ipv4.route-metric 100 \
  connection.autoconnect yes \
  connection.zone "${ZONE_INTERNET}"

# ------------------------------------------------------------
# Red PLC aislada - eno3
# ------------------------------------------------------------
echo "==> Configurando Red PLC aislada en ${IF_PLC}"

sudo nmcli con add type ethernet ifname "${IF_PLC}" con-name "${CON_PLC}" \
  ipv4.method manual \
  ipv4.addresses "${PLC_IP}"

# PLC sin gateway, sin DNS y sin default route.
sudo nmcli con modify "${CON_PLC}" \
  ipv4.gateway "" \
  ipv4.never-default yes \
  ipv4.ignore-auto-routes yes \
  ipv4.ignore-auto-dns yes \
  connection.autoconnect yes \
  connection.zone "${ZONE_PLC}"

# ------------------------------------------------------------
# Red Internet secundaria / respaldo - eno4
# ------------------------------------------------------------
echo "==> Configurando Internet respaldo en ${IF_INTERNET_BKP}"

sudo nmcli con add type ethernet ifname "${IF_INTERNET_BKP}" con-name "${CON_INTERNET_BKP}" \
  ipv4.method auto

sudo nmcli con modify "${CON_INTERNET_BKP}" \
  ipv4.never-default no \
  ipv4.ignore-auto-routes no \
  ipv4.ignore-auto-dns yes \
  ipv4.route-metric 300 \
  connection.autoconnect yes \
  connection.zone "${ZONE_INTERNET}"

# ------------------------------------------------------------
# Sysctl para host multihomed
# ------------------------------------------------------------
echo "==> Ajustando rp_filter para host multihomed"

sudo tee /etc/sysctl.d/90-sismico-multihomed.conf >/dev/null <<EOF
net.ipv4.conf.all.rp_filter = 2
net.ipv4.conf.default.rp_filter = 2
net.ipv4.conf.${IF_CODELCO}.rp_filter = 2
net.ipv4.conf.${IF_INTERNET}.rp_filter = 2
net.ipv4.conf.${IF_PLC}.rp_filter = 2
net.ipv4.conf.${IF_INTERNET_BKP}.rp_filter = 2
EOF

sudo sysctl --system >/dev/null || true

# ------------------------------------------------------------
# Firewall basico
# ------------------------------------------------------------
echo "==> Configurando firewall basico"

if command -v firewall-cmd >/dev/null 2>&1; then
  sudo systemctl enable --now firewalld >/dev/null 2>&1 || true
fi

if systemctl is-active --quiet firewalld; then
  if ! sudo firewall-cmd --permanent --get-zones | tr ' ' '\n' | grep -qx "${ZONE_CODELCO}"; then
    sudo firewall-cmd --permanent --new-zone="${ZONE_CODELCO}" || true
  fi

  for PORT in "${HTTP_PORTS[@]}"; do
    sudo firewall-cmd --permanent --zone="${ZONE_CODELCO}" --add-port="${PORT}" || true
    sudo firewall-cmd --permanent --zone="${ZONE_INTERNET}" --remove-port="${PORT}" 2>/dev/null || true
    sudo firewall-cmd --permanent --zone="${ZONE_PLC}" --remove-port="${PORT}" 2>/dev/null || true
    sudo firewall-cmd --permanent --zone=trusted --remove-port="${PORT}" 2>/dev/null || true
  done

  sudo firewall-cmd --permanent --zone=public --remove-interface="${IF_CODELCO}" 2>/dev/null || true
  sudo firewall-cmd --permanent --zone=trusted --remove-interface="${IF_PLC}" 2>/dev/null || true

  sudo firewall-cmd --permanent --zone="${ZONE_CODELCO}" --add-interface="${IF_CODELCO}" || true
  sudo firewall-cmd --permanent --zone="${ZONE_INTERNET}" --add-interface="${IF_INTERNET}" || true
  sudo firewall-cmd --permanent --zone="${ZONE_INTERNET}" --add-interface="${IF_INTERNET_BKP}" || true
  sudo firewall-cmd --permanent --zone="${ZONE_PLC}" --add-interface="${IF_PLC}" || true

  # Limpiar residuos VPN antiguos si existieran
  sudo firewall-cmd --permanent --zone=public --remove-interface=tun0 2>/dev/null || true
  sudo firewall-cmd --permanent --zone=public --remove-source=10.8.0.0/24 2>/dev/null || true
  sudo firewall-cmd --permanent --zone=public --remove-rich-rule='rule family="ipv4" source address="10.8.0.0/24" accept' 2>/dev/null || true

  sudo firewall-cmd --reload
else
  echo "firewalld no esta disponible o activo. Reejecute este script despues de instalar/activar firewalld."
fi

# ------------------------------------------------------------
# Aplicar red
# ------------------------------------------------------------
echo "==> Reiniciando NetworkManager"

sudo systemctl restart NetworkManager
sleep 10

echo "==> Levantando conexiones"

sudo nmcli con up "${CON_CODELCO}" || true
sudo nmcli con up "${CON_INTERNET}" || true
sudo nmcli con up "${CON_PLC}" || true
sudo nmcli con up "${CON_INTERNET_BKP}" || true

sleep 5

# ------------------------------------------------------------
# Validaciones
# ------------------------------------------------------------
echo "============================================================"
echo " ESTADO FINAL"
echo "============================================================"

nmcli device status
echo
ip addr show "${IF_CODELCO}" || true
ip addr show "${IF_INTERNET}" || true
ip addr show "${IF_PLC}" || true
ip addr show "${IF_INTERNET_BKP}" || true

echo
echo "============================================================"
echo " RUTAS"
echo "============================================================"
ip route

echo
echo "============================================================"
echo " REGLAS DE ENRUTAMIENTO"
echo "============================================================"
ip rule show

echo
echo "============================================================"
echo " TABLA ${CODELCO_ROUTE_TABLE} (RESPUESTA POR CODELCO)"
echo "============================================================"
ip route show table "${CODELCO_ROUTE_TABLE}" || true

echo
echo "============================================================"
echo " VALIDACIONES DE ENRUTAMIENTO"
echo "============================================================"

echo "Fuentes externas Codelco deben salir por ${IF_CODELCO}:"
ip route get "${CODELCO_VALIDATION_IP}" || true

echo
echo "PLC debe salir por ${IF_PLC}:"
ip route get 192.168.1.10 || true

echo
echo "Internet general debe salir por ${IF_INTERNET} o respaldo ${IF_INTERNET_BKP}:"
ip route get 8.8.8.8 || true

echo
echo "Toda respuesta con origen ${CODELCO_SOURCE_IP} debe salir por ${IF_CODELCO}:"
ip route get 1.1.1.1 from "${CODELCO_SOURCE_IP}" || true

echo
echo "Acceso HTTP local esperado en puertos Docker/host:"
ss -tulpen | grep -E ':80|:443|:15173|:18000|:9000' || true

echo
echo "============================================================"
echo " CONFIGURACION COMPLETADA"
echo "============================================================"
echo "Red 1 Codelco: ${IF_CODELCO} ${CODELCO_IP} (HTTP + fuentes externas)"
echo "Red 2 Internet principal: ${IF_INTERNET} DHCP metric 100"
echo "Red 3 PLC aislado: ${IF_PLC} ${PLC_IP}, sin gateway"
echo "Red 4 Internet respaldo: ${IF_INTERNET_BKP} DHCP metric 300"
echo "Rutas fuentes externas Codelco: ${CODELCO_ROUTES[*]}"
echo "Tabla policy routing Codelco: ${CODELCO_ROUTE_TABLE}, prioridad ${CODELCO_RULE_PRIORITY}"
echo "PLC aislado: ${PLC_NETWORK} por ${IF_PLC}"
echo "HTTP sistema expuesto solo por zona ${ZONE_CODELCO} segun puertos definidos"
