#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Instala Git, Docker Engine, Compose plugin y dependencias necesarias del sistema.
# ==============================================================================

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: ejecutar como root: sudo $0"
  exit 1
fi

APP_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"

# Detectar gestor de paquetes (dnf o yum)
if command -v dnf >/dev/null 2>&1; then
  PM=dnf
else
  PM=yum
fi
PKG_INSTALL="$PM install -y"
PKG_REMOVE="$PM remove -y"
PKG_MAKECACHE="$PM makecache -y"

# Verificar systemd y herramientas mínimas
if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: 'systemctl' no disponible. Este script requiere systemd." 
  exit 1
fi

echo "======================================================"
echo " Instalacion Docker + dependencias"
echo " Usuario detectado: ${APP_USER}"
echo "======================================================"

echo "[1/8] Cache de paquetes..."
${PKG_MAKECACHE} || true

echo "[2/8] Instalando herramientas base..."
${PKG_INSTALL} \
  dnf-plugins-core yum-utils \
  git curl wget ca-certificates gnupg2 openssl jq \
  nano vim unzip tar gzip bash-completion \
  chrony firewalld \
  iproute iputils bind-utils net-tools traceroute tcpdump nmap-ncat lsof procps-ng rsync cronie \
  policycoreutils-python-utils policycoreutils-python \
  python3 python3-pip \
  make gcc gcc-c++ \
  || true

echo "[3/8] Habilitando servicios base..."
systemctl enable --now chronyd || true
systemctl enable --now crond || true
systemctl enable --now firewalld || true

echo "[4/8] Eliminando Docker/Podman conflictivos..."
${PKG_REMOVE} \
  docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine \
  podman buildah runc \
  || true

echo "[5/8] Agregando repo oficial Docker CentOS..."
if command -v dnf >/dev/null 2>&1; then
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
elif command -v yum-config-manager >/dev/null 2>&1; then
  yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo || true
else
  curl -fsSL https://download.docker.com/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo || true
fi

echo "[6/8] Instalando Docker Engine + Compose plugin..."
${PKG_INSTALL} docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || true

echo "[7/8] Configurando Docker daemon..."
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  },
  "features": {
    "buildkit": true
  }
}
EOF

systemctl daemon-reload
systemctl enable --now docker

# Verificacion adicional
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker no se instaló correctamente o no está en PATH. Revise el output anterior." 
  exit 1
fi

echo "[8/8] Agregando usuario al grupo docker..."
usermod -aG docker "${APP_USER}" || true

echo "Verificacion:"
docker version
docker compose version
git --version
python3 --version || true

echo "OK: instalacion completa. Cierra sesion y vuelve a entrar para usar Docker sin sudo."
