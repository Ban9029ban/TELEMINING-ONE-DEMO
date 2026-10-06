
#!/bin/sh
set -eu

check() {
  name="$1"
  url="$2"
  echo "==> $name -> $url"
  wget -qO- "$url" >/tmp/out.txt
  cat /tmp/out.txt | head -c 400
  echo
  echo "----"
}

check "config public" "http://backend:8000/api/config/public"
check "config users" "http://backend:8000/api/config/users"
check "config companies" "http://backend:8000/api/config/companies"
check "config system" "http://backend:8000/api/config/system"
check "config screens" "http://backend:8000/api/config/screens"
check "polygon sites" "http://backend:8000/api/config/polygon-sites"
check "screens emergency" "http://backend:8000/api/screens/emergency"
check "semaforo emulator" "http://semaforo_emulator_api:8000/api/emulator/semaforo/state"
echo "Smoke tests OK"
