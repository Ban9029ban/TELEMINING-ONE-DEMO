"""Build the seismic interface for NOCONE while retaining the remote operational API."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

project = Path(__file__).resolve().parents[1]
nocone = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else project.parents[1] / 'NOCONE'
if not (nocone / 'web_front/package.json').is_file():
    raise SystemExit('Indica la ruta del proyecto NOCONE')
env = {**os.environ, 'VITE_API_BASE_URL': '/sismico-source-api',
       'VITE_VISUAL_API_ROOT': '/api/sismico-ui', 'VITE_EMBED_NOCONE': 'true'}
npm = shutil.which('npm.cmd') or shutil.which('npm')
subprocess.run([npm, 'run', 'build', '--', '--base=/sismico-ui/'], cwd=project/'frontend', env=env, check=True)
shutil.copytree(project/'frontend/dist', nocone/'web_front/public/sismico-ui', dirs_exist_ok=True)
print('Interfaz sísmica integrada en', nocone/'web_front/public/sismico-ui')
