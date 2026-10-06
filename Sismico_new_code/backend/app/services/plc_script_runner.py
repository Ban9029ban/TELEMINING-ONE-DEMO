import os
import shlex
import socket
import subprocess
import time
from typing import Iterable

from app.core.settings import settings


class PlcScriptRunner:
    def __init__(self):
        self.python_bin = getattr(settings, 'plc_python_bin', None) or getattr(settings, 'PLC_PYTHON_BIN', None) or 'python3'
        self.script_path = getattr(settings, 'plc_script_path', None) or getattr(settings, 'PLC_SCRIPT_PATH', None) or '/app/tools/plcctl.py'
        self.default_type = getattr(settings, 'plc_default_type', None) or getattr(settings, 'PLC_DEFAULT_TYPE', None) or 'delta'
        self.timeout = int(getattr(settings, 'plc_default_timeout_seconds', getattr(settings, 'PLC_DEFAULT_TIMEOUT_SECONDS', 20)) or 20)
        self.probe_timeout = float(getattr(settings, 'plc_connect_probe_timeout_seconds', getattr(settings, 'PLC_CONNECT_PROBE_TIMEOUT_SECONDS', 1.5)) or 1.5)
        self.post_write_delay_ms = int(getattr(settings, 'plc_post_write_delay_ms', getattr(settings, 'PLC_POST_WRITE_DELAY_MS', 250)) or 250)

    def _build_single_command(self, *, ip: str, plc_type: str, write_expression: str, port: int | None, unit_id: int | None) -> list[str]:
        command = [
            self.python_bin,
            self.script_path,
            '--ip', str(ip),
            '--type', str(plc_type or self.default_type),
            '--write', str(write_expression),
            '--timeout', str(self.timeout),
        ]
        if port:
            command.extend(['--port', str(port)])
        if unit_id:
            command.extend(['--unit-id', str(unit_id)])
        return command

    def _command_text(self, command: Iterable[str]) -> str:
        return ' '.join(shlex.quote(str(part)) for part in command)

    def _probe(self, ip: str, port: int) -> tuple[bool, str]:
        try:
            with socket.create_connection((ip, int(port)), timeout=self.probe_timeout):
                return True, 'ok'
        except socket.timeout:
            return False, f'PLC {ip} no responde dentro de {self.probe_timeout:.1f}s.'
        except ConnectionRefusedError:
            return False, f'PLC {ip} rechazó la conexión o no está alcanzable.'
        except OSError as exc:
            return False, f'PLC {ip} no está alcanzable: {exc}'

    def _run_single(self, *, ip: str, plc_type: str, write_expression: str, port: int | None, unit_id: int | None) -> dict:
        command = self._build_single_command(ip=ip, plc_type=plc_type, write_expression=write_expression, port=port, unit_id=unit_id)
        command_text = self._command_text(command)
        plc_enabled = getattr(settings, 'plc_enabled', getattr(settings, 'PLC_ENABLED', True))
        plc_dry_run = getattr(settings, 'plc_dry_run', getattr(settings, 'PLC_DRY_RUN', True))

        if not plc_enabled:
            return {'ok': False, 'mode': 'disabled', 'command': command_text, 'stdout': '', 'stderr': 'PLC deshabilitado en configuración.', 'error_kind': 'disabled'}
        if plc_dry_run:
            return {'ok': True, 'mode': 'dry-run', 'command': command_text, 'stdout': 'PLC dry-run enabled; command not executed.', 'stderr': '', 'error_kind': None}
        if not os.path.exists(self.script_path):
            return {'ok': False, 'mode': 'error', 'command': command_text, 'stdout': '', 'stderr': f'PLC script no encontrado: {self.script_path}', 'error_kind': 'script_not_found'}

        ok_probe, probe_msg = self._probe(ip, int(port or 502))
        if not ok_probe:
            return {'ok': False, 'mode': 'error', 'command': command_text, 'stdout': '', 'stderr': probe_msg, 'error_kind': 'unreachable'}

        try:
            proc = subprocess.run(command, capture_output=True, text=True, timeout=self.timeout, env=dict(os.environ))
            stdout = (proc.stdout or '').strip()
            stderr = (proc.stderr or '').strip()
            result = {
                'ok': proc.returncode == 0,
                'mode': 'live',
                'command': command_text,
                'stdout': stdout,
                'stderr': stderr,
                'returncode': proc.returncode,
                'error_kind': None if proc.returncode == 0 else 'command_error',
            }
            if proc.returncode == 0 and self.post_write_delay_ms > 0:
                time.sleep(max(self.post_write_delay_ms, 0) / 1000.0)
            return result
        except subprocess.TimeoutExpired:
            return {'ok': False, 'mode': 'error', 'command': command_text, 'stdout': '', 'stderr': f'PLC {ip} no respondió dentro de {self.timeout}s.', 'error_kind': 'timeout'}
        except Exception as exc:
            return {'ok': False, 'mode': 'error', 'command': command_text, 'stdout': '', 'stderr': str(exc), 'error_kind': 'runner_exception'}

    def run_write(self, *, ip: str, plc_type: str, write_expression: str, port: int | None = None, unit_id: int | None = None) -> dict:
        writes = [chunk.strip() for chunk in str(write_expression or '').split(',') if chunk.strip()]
        if not writes:
            return {'ok': False, 'mode': 'error', 'command': '', 'stdout': '', 'stderr': 'No se recibió ninguna escritura PLC.', 'error_kind': 'empty_expression', 'results': []}

        results = [self._run_single(ip=ip, plc_type=plc_type, write_expression=expr, port=port, unit_id=unit_id) for expr in writes]
        return {
            'ok': all(item.get('ok', False) for item in results),
            'mode': 'live' if any(item.get('mode') == 'live' for item in results) else (results[0].get('mode') if results else 'error'),
            'command': ' && '.join(item.get('command', '') for item in results if item.get('command')),
            'stdout': '\n'.join(item.get('stdout', '') for item in results if item.get('stdout')),
            'stderr': '\n'.join(item.get('stderr', '') for item in results if item.get('stderr')),
            'error_kind': next((item.get('error_kind') for item in results if item.get('error_kind')), None),
            'results': results,
        }
