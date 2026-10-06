# Scripts CentOS

## 01_configurar_redes.sh

Configura:

- `eno1`: Codelco / acceso HTTP al sistema / fuentes externas Codelco.
- `eno2`: Internet principal / salida general.
- `eno3`: PLC solamente, sin gateway y aislado.
- `eno4`: Internet secundario / respaldo.

Validacion esperada:

```bash
ip route get 10.18.18.83                   # dev eno1
ip route get 8.8.8.8                       # dev eno2
ip route get 192.168.1.10                  # dev eno3
ip route get 1.1.1.1 from 10.18.43.64      # dev eno1
ip rule list
ip route show table 101
```

## 02_instalar_docker_sistema.sh

Instala:

- Git
- Docker Engine
- Docker Compose plugin
- Buildx
- Python 3 / pip
- herramientas de red y diagnostico
- firewalld
- chrony
- utilidades base

## 03_deploy_full_clean.sh

Ejecuta:

- docker compose down --rmi all --remove-orphans -v
- docker prune completo
- git fetch origin --prune
- sincronizacion de master, develop, staging
- checkout final a master
- docker compose build --no-cache
- docker compose up -d
- docker compose logs -f

Uso:

```bash
chmod +x *.sh
sudo ./01_configurar_redes.sh
sudo ./02_instalar_docker_sistema.sh
sudo ./01_configurar_redes.sh
PROJECT_DIR=/home/soporte/Sismico_new_code FINAL_BRANCH=master ./03_deploy_full_clean.sh
```
