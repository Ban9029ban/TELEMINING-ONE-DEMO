import sys
import argparse
import os
from collections import deque
from datetime import datetime

import requests
from PySide6.QtWidgets import (
    QApplication,
    QWidget,
    QTabWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
    QDialog,
    QFormLayout,
    QLineEdit,
    QSpinBox,
    QCheckBox,
    QComboBox,
    QPushButton,
    QDialogButtonBox,
    QMessageBox,
)
from PySide6.QtGui import QPixmap, QFont
from PySide6.QtCore import QTimer, Qt


# Máximo de lecturas BT que se muestran en la tabla de historial
MAX_BT_EVENTS = 100


def extract_portico_id(conn: dict) -> str:
    """
    Intenta obtener el ID del pórtico desde el JSON del /status.

    Prioridad:
      1) Campo directo: portico_id / portico / gateway_id
      2) Parsear desde una trama cruda: last_frame / last_bt_frame / last_payload
         Formato esperado:
           MAC:BT:TS:BACKBONE:EDGE:PORTICO:RSSI
    """
    # 1) Campo directo
    pid = (
        conn.get("portico_id")
        or conn.get("portico")
        or conn.get("gateway_id")
    )
    if pid:
        return str(pid)

    # 2) Intentar parsear desde la trama cruda
    frame = (
        conn.get("last_frame")
        or conn.get("last_bt_frame")
        or conn.get("last_payload")
    )
    if isinstance(frame, str):
        parts = frame.split(":")
        # MAC:BT:TS:BACKBONE:EDGE:PORTICO:RSSI  => índice 5
        if len(parts) >= 7:
            return parts[5]

    # 3) Fallback
    return "?"


class PorticoConfigDialog(QDialog):
    """
    Ventana de configuración de un pórtico:
    - Campos de selección (combo / checkbox).
    - Campos manuales (IP, puerto, SSID, etc.).
    """

    def __init__(self, portico_data: dict, listener_url: str, parent=None):
        super().__init__(parent)
        self.portico_data = portico_data
        self.listener_url = listener_url.rstrip("/")

        portico_id = portico_data.get("portico_id", "?")

        self.setWindowTitle(f"Configurar pórtico - {portico_id}")
        self.setModal(True)
        self.resize(480, 620)

        layout = QVBoxLayout(self)

        # ==================================================================
        # HEADER CON LOGO + TÍTULO
        # ==================================================================
        header_layout = QHBoxLayout()
        layout.addLayout(header_layout)

        logo_label = QLabel()
        # Cargamos el mismo logo.png que usa la GUI principal
        base_dir = os.path.dirname(os.path.abspath(__file__))
        logo_path = os.path.join(base_dir, "logo.png")
        if os.path.exists(logo_path):
            pix = QPixmap(logo_path)
            if not pix.isNull():
                pix = pix.scaledToHeight(32, Qt.SmoothTransformation)
                logo_label.setPixmap(pix)
        else:
            logo_label.setText("Telemining")
            f = logo_label.font()
            f.setPointSize(11)
            f.setBold(True)
            logo_label.setFont(f)

        header_layout.addWidget(logo_label, alignment=Qt.AlignLeft | Qt.AlignVCenter)

        title_label = QLabel(f"Pórtico TMOne – {portico_id}")
        tf = title_label.font()
        tf.setPointSize(11)
        tf.setBold(True)
        title_label.setFont(tf)
        header_layout.addWidget(title_label, alignment=Qt.AlignLeft | Qt.AlignVCenter)

        header_layout.addStretch(1)

        # ==================================================================
        # FORMULARIO PRINCIPAL
        # ==================================================================
        form = QFormLayout()
        layout.addLayout(form)

        # ------------------------------------------------------------------
        # Valores base desde el /status
        # ------------------------------------------------------------------
        remote_addr = portico_data.get("remote_addr", "")
        edge_ip = remote_addr.split(":")[0] if remote_addr else ""
        backbone_default = portico_data.get("backbone_code", "GW_BACKBONE_NORTE")

        # ---------------------- Identidad / red ----------------------------
        self.le_portico_id = QLineEdit(portico_id)
        form.addRow("ID Pórtico:", self.le_portico_id)

        self.le_edge_ip = QLineEdit(edge_ip)
        form.addRow("IP EDGE:", self.le_edge_ip)

        self.cbo_backbone = QComboBox()
        self.cbo_backbone.addItems(
            [
                "GW_BACKBONE_NORTE",
                "GW_BACKBONE_SUR",
                "GW_BACKBONE_PLANTA",
                "GW_BACKBONE_TEST",
            ]
        )
        idx_bb = self.cbo_backbone.findText(backbone_default)
        if idx_bb >= 0:
            self.cbo_backbone.setCurrentIndex(idx_bb)
        form.addRow("Backbone ID:", self.cbo_backbone)

        self.cbo_edge_kind = QComboBox()
        self.cbo_edge_kind.addItems(["EDGE_BASIC", "EDGE_PRO", "EDGE_DIAG"])
        form.addRow("Tipo EDGE:", self.cbo_edge_kind)

        # ---------------------- Listener ----------------------------------
        self.le_listener_host = QLineEdit("192.168.1.10")
        form.addRow("Host Listener:", self.le_listener_host)

        self.sp_listener_port = QSpinBox()
        self.sp_listener_port.setRange(1, 65535)
        self.sp_listener_port.setValue(9095)
        form.addRow("Puerto Listener:", self.sp_listener_port)

        # ---------------------- WiFi (listener / central) -----------------
        self.le_wifi_ssid_listener = QLineEdit("WiFi_Mesh_PROD")
        form.addRow("SSID Listener:", self.le_wifi_ssid_listener)

        self.le_wifi_pass_listener = QLineEdit("ClaveListener123")
        self.le_wifi_pass_listener.setEchoMode(QLineEdit.Password)
        btn_show_listener = QPushButton("👁")
        btn_show_listener.setCheckable(True)
        btn_show_listener.setFixedWidth(32)
        btn_show_listener.toggled.connect(
            lambda checked: self.le_wifi_pass_listener.setEchoMode(
                QLineEdit.Normal if checked else QLineEdit.Password
            )
        )
        w_pass_listener = QWidget()
        h_pass_listener = QHBoxLayout(w_pass_listener)
        h_pass_listener.setContentsMargins(0, 0, 0, 0)
        h_pass_listener.addWidget(self.le_wifi_pass_listener)
        h_pass_listener.addWidget(btn_show_listener)
        form.addRow("Pass Listener:", w_pass_listener)

        self.le_wifi_ssid_central = QLineEdit("CentralURT_PROD")
        form.addRow("SSID Central:", self.le_wifi_ssid_central)

        self.le_wifi_pass_central = QLineEdit("CentralPass")
        self.le_wifi_pass_central.setEchoMode(QLineEdit.Password)
        btn_show_central = QPushButton("👁")
        btn_show_central.setCheckable(True)
        btn_show_central.setFixedWidth(32)
        btn_show_central.toggled.connect(
            lambda checked: self.le_wifi_pass_central.setEchoMode(
                QLineEdit.Normal if checked else QLineEdit.Password
            )
        )
        w_pass_central = QWidget()
        h_pass_central = QHBoxLayout(w_pass_central)
        h_pass_central.setContentsMargins(0, 0, 0, 0)
        h_pass_central.addWidget(self.le_wifi_pass_central)
        h_pass_central.addWidget(btn_show_central)
        form.addRow("Pass Central:", w_pass_central)

        # ---------------------- NTP ---------------------------------------
        self.le_ntp_server = QLineEdit("ntp.empresa.local")
        form.addRow("Servidor NTP:", self.le_ntp_server)

        self.sp_gmt_offset = QSpinBox()
        self.sp_gmt_offset.setRange(-24 * 3600, 24 * 3600)
        self.sp_gmt_offset.setValue(-3 * 3600)  # Chile -03
        form.addRow("GMT offset (seg):", self.sp_gmt_offset)

        self.sp_dst_offset = QSpinBox()
        self.sp_dst_offset.setRange(-3600, 3600)
        self.sp_dst_offset.setValue(0)
        form.addRow("DST offset (seg):", self.sp_dst_offset)

        # ---------------------- Parámetros extra útiles -------------------
        self.sp_wifi_recheck = QSpinBox()
        self.sp_wifi_recheck.setRange(1000, 600000)
        self.sp_wifi_recheck.setSingleStep(1000)
        self.sp_wifi_recheck.setValue(30000)
        form.addRow("Recheck WiFi (ms):", self.sp_wifi_recheck)

        self.sp_ble_scan_sec = QSpinBox()
        self.sp_ble_scan_sec.setRange(1, 10)
        self.sp_ble_scan_sec.setValue(1)
        form.addRow("Duración scan BLE (s):", self.sp_ble_scan_sec)

        self.sp_ble_min_rssi = QSpinBox()
        self.sp_ble_min_rssi.setRange(-120, 0)
        self.sp_ble_min_rssi.setValue(-90)
        form.addRow("RSSI mínimo BLE:", self.sp_ble_min_rssi)

        # ---------------------- Flags de funcionalidad --------------------
        self.cb_enable_wifi = QCheckBox("WiFi habilitado")
        self.cb_enable_wifi.setChecked(True)
        form.addRow("", self.cb_enable_wifi)

        self.cb_enable_ble = QCheckBox("Escaneo BLE")
        self.cb_enable_ble.setChecked(True)
        form.addRow("", self.cb_enable_ble)

        self.cb_enable_lora = QCheckBox("LoRa")
        self.cb_enable_lora.setChecked(False)
        form.addRow("", self.cb_enable_lora)

        self.cb_enable_lowpower = QCheckBox("Modo ahorro energía")
        self.cb_enable_lowpower.setChecked(False)
        form.addRow("", self.cb_enable_lowpower)

        self.cb_enable_watchdog = QCheckBox("Watchdog")
        self.cb_enable_watchdog.setChecked(False)
        form.addRow("", self.cb_enable_watchdog)

        # ---------------------- Destino preferente ------------------------
        self.cbo_default_target = QComboBox()
        self.cbo_default_target.addItems(["LISTENER", "CENTRAL"])
        form.addRow("Destino preferente:", self.cbo_default_target)

        # ---------------------- Botones OK/Cancel -------------------------
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def get_config(self) -> dict:
        """Devuelve el dict completo con la configuración."""
        cfg = {
            "portico_id": self.le_portico_id.text().strip(),
            "edge_ip": self.le_edge_ip.text().strip(),
            "backbone_id": self.cbo_backbone.currentText(),
            "edge_kind": self.cbo_edge_kind.currentText(),
            "listener_host": self.le_listener_host.text().strip(),
            "listener_port": int(self.sp_listener_port.value()),
            "wifi_ssid_listener": self.le_wifi_ssid_listener.text().strip(),
            "wifi_pass_listener": self.le_wifi_pass_listener.text(),
            "wifi_ssid_central": self.le_wifi_ssid_central.text().strip(),
            "wifi_pass_central": self.le_wifi_pass_central.text(),
            "ntp_server": self.le_ntp_server.text().strip(),
            "gmt_offset_sec": int(self.sp_gmt_offset.value()),
            "dst_offset_sec": int(self.sp_dst_offset.value()),
            "wifi_recheck_ms": int(self.sp_wifi_recheck.value()),
            "ble_scan_duration_s": int(self.sp_ble_scan_sec.value()),
            "ble_min_rssi": int(self.sp_ble_min_rssi.value()),
            "enable_wifi": self.cb_enable_wifi.isChecked(),
            "enable_ble_scan": self.cb_enable_ble.isChecked(),
            "enable_lora": self.cb_enable_lora.isChecked(),
            "enable_low_power_mode": self.cb_enable_lowpower.isChecked(),
            "enable_watchdog": self.cb_enable_watchdog.isChecked(),
            "wifi_target_default": self.cbo_default_target.currentText(),
        }
        return cfg

    def _on_accept(self):
        cfg = self.get_config()

        if not cfg["edge_ip"]:
            QMessageBox.warning(
                self,
                "Validación",
                "La IP EDGE no puede estar vacía.",
            )
            return

        print("=== Configuración de pórtico a enviar ===")
        print(cfg)

        # Aquí después descomentas el POST al backend / pórtico si quieres
        # try:
        #     r = requests.post(
        #         f"{self.listener_url}/api/porticos/{cfg['portico_id']}/config",
        #         json=cfg,
        #         timeout=3,
        #     )
        #     r.raise_for_status()
        # except Exception as e:
        #     QMessageBox.critical(
        #         self,
        #         "Error",
        #         f"No se pudo enviar la configuración al listener:\n{e}",
        #     )
        #     return

        self.accept()


class ListenerGui(QWidget):
    def __init__(self, listener_url: str):
        super().__init__()
        self.listener_url = listener_url.rstrip("/")
        self.setWindowTitle("Telemining TMOne Listener")

        # ------------------------------------------------------------------
        # Estructuras de datos en memoria
        # ------------------------------------------------------------------
        self.bt_events = deque(maxlen=MAX_BT_EVENTS)
        self.porticos = {}  # key: portico_id o conn_id

        # ---- Estilo general ------------------------------------------------
        self.setStyleSheet(
            """
            QWidget {
                background-color: #FFFFFF;
                color: #222222;
                font-family: Segoe UI, Arial, sans-serif;
                font-size: 10pt;
            }
            QTabWidget::pane {
                border: 1px solid #CCCCCC;
                background: #FFFFFF;
            }
            QTabBar::tab {
                background: #EEEEEE;
                padding: 6px 12px;
                border: 1px solid #CCCCCC;
                margin-right: 2px;
            }
            QTabBar::tab:selected {
                background: #FFFFFF;
                border-bottom-color: #FFFFFF;
            }
            QTableWidget {
                gridline-color: #DDDDDD;
                selection-background-color: #0078D7;
                selection-color: #FFFFFF;
            }
            """
        )

        main_layout = QVBoxLayout(self)

        # -----------------------------------------------------------------
        # Encabezado con logo Telemining
        # -----------------------------------------------------------------
        header = QHBoxLayout()
        main_layout.addLayout(header)

        logo_label = QLabel()
        self._load_logo(logo_label)
        header.addWidget(logo_label, alignment=Qt.AlignLeft | Qt.AlignVCenter)

        title_label = QLabel("ZENIT Tag Listener")
        title_font = QFont()
        title_font.setPointSize(14)
        title_font.setBold(True)
        title_label.setFont(title_font)
        header.addWidget(title_label, alignment=Qt.AlignLeft | Qt.AlignVCenter)

        header.addStretch(1)

        # -----------------------------------------------------------------
        # Tabs
        # -----------------------------------------------------------------
        self.tabs = QTabWidget()
        main_layout.addWidget(self.tabs)

        # ================== TAB RESUMEN ==================
        self.tab_resumen = QWidget()
        resumen_layout = QVBoxLayout(self.tab_resumen)

        self.lbl_estado = QLabel("Estado: desconocido")
        self.lbl_listener_url = QLabel(f"Listener URL: {self.listener_url}")
        self.lbl_last_update = QLabel("Última actualización: -")
        self.lbl_conexiones = QLabel("Pórticos conectados (en vivo): 0")
        self.lbl_porticos_conocidos = QLabel("Pórticos conocidos (histórico): 0")
        self.lbl_total_frames = QLabel("Frames totales acumulados: 0")
        self.lbl_backbones = QLabel("Backbones activos: -")

        resumen_layout.addWidget(self.lbl_estado)
        resumen_layout.addWidget(self.lbl_listener_url)
        resumen_layout.addWidget(self.lbl_last_update)
        resumen_layout.addWidget(self.lbl_conexiones)
        resumen_layout.addWidget(self.lbl_porticos_conocidos)
        resumen_layout.addWidget(self.lbl_total_frames)
        resumen_layout.addWidget(self.lbl_backbones)
        resumen_layout.addStretch(1)

        self.tabs.addTab(self.tab_resumen, "Resumen")

        # ================== TAB LECTURAS BT ==================
        self.tab_bt = QWidget()
        bt_layout = QVBoxLayout(self.tab_bt)

        self.table_bt = QTableWidget(0, 7)
        self.table_bt.setHorizontalHeaderLabels(
            [
                "Fecha/Hora",
                "Pórtico",
                "Conn ID",
                "Host",
                "Backbone",
                "Último BT",
                "Frames",
            ]
        )
        header_view_bt = self.table_bt.horizontalHeader()
        header_view_bt.setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table_bt.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)

        bt_layout.addWidget(self.table_bt)
        self.tabs.addTab(self.tab_bt, "Lecturas BT")

        # ================== TAB PÓRTICOS ==================
        self.tab_porticos = QWidget()
        porticos_layout = QVBoxLayout(self.tab_porticos)

        # 8 columnas: agregamos "Acciones"
        self.table_porticos = QTableWidget(0, 8)
        self.table_porticos.setHorizontalHeaderLabels(
            [
                "Pórtico",
                "Conn ID",
                "Host",
                "Primera conexión",
                "Último envío",
                "Último BT",
                "Frames",
                "Acciones",
            ]
        )
        header_view_p = self.table_porticos.horizontalHeader()
        header_view_p.setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table_porticos.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)

        porticos_layout.addWidget(self.table_porticos)
        self.tabs.addTab(self.tab_porticos, "Pórticos")

        # Timer para refrescar /status
        self.timer = QTimer(self)
        self.timer.setInterval(1000)  # 1s
        self.timer.timeout.connect(self.refresh_status)
        self.timer.start()

    # ------------------------------------------------------------------
    # Carga del logo
    # ------------------------------------------------------------------
    def _load_logo(self, label: QLabel):
        """
        Carga logo.png desde la misma carpeta que gui.py
        """
        base_dir = os.path.dirname(os.path.abspath(__file__))
        logo_path = os.path.join(base_dir, "logo.png")

        if os.path.exists(logo_path):
            pix = QPixmap(logo_path)
            if not pix.isNull():
                pix = pix.scaledToHeight(40, Qt.SmoothTransformation)
                label.setPixmap(pix)
                return

        # fallback: texto si no está el logo
        label.setText("Telemining")
        f = label.font()
        f.setPointSize(12)
        f.setBold(True)
        label.setFont(f)

    # ------------------------------------------------------------------
    # Abrir ventana de edición de un pórtico
    # ------------------------------------------------------------------
    def open_portico_config(self, portico_dict: dict):
        dlg = PorticoConfigDialog(portico_dict, self.listener_url, parent=self)
        if dlg.exec() == QDialog.Accepted:
            cfg = dlg.get_config()
            QMessageBox.information(
                self,
                "Configuración guardada",
                "La configuración del pórtico se ha generado correctamente.\n"
                "Revisa la consola para ver el JSON que se enviaría.",
            )
            # Aquí en el futuro puedes forzar reload o actualizar /status.

    # ------------------------------------------------------------------
    # Lógica de refresco de estado
    # ------------------------------------------------------------------
    def refresh_status(self):
        try:
            resp = requests.get(f"{self.listener_url}/status", timeout=2)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            self.lbl_estado.setText(f"Estado: ERROR ({e})")
            self.lbl_conexiones.setText("Pórticos conectados (en vivo): ?")
            self.lbl_last_update.setText("Última actualización: error")
            return

        now = datetime.now()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S")

        self.lbl_estado.setText("Estado: operativo")
        self.lbl_last_update.setText(f"Última actualización: {now_str}")
        self.lbl_conexiones.setText(
            f"Pórticos conectados (en vivo): {data.get('total_connections', 0)}"
        )

        conns = data.get("connections", [])

        # ------------------------------------------------------------------
        # 1) Actualizar estructuras internas desde /status
        # ------------------------------------------------------------------
        for c in conns:
            conn_id = c.get("connection_id", "")
            remote_addr = c.get("remote_addr", "")
            backbone = c.get("backbone_code") or ""
            last_bt = c.get("last_bt_id") or ""
            frames = c.get("total_frames", 0)

            portico_id = extract_portico_id(c)

            bt_event = {
                "timestamp": now_str,
                "portico_id": portico_id,
                "connection_id": conn_id,
                "remote_addr": remote_addr,
                "backbone_code": backbone,
                "last_bt_id": last_bt,
                "total_frames": frames,
            }
            self.bt_events.append(bt_event)

            key = portico_id if portico_id != "?" else conn_id
            if key not in self.porticos:
                self.porticos[key] = {
                    "portico_id": portico_id,
                    "connection_id": conn_id,
                    "remote_addr": remote_addr,
                    "first_seen": now_str,
                    "last_seen": now_str,
                    "last_bt_id": last_bt,
                    "total_frames": frames,
                    "backbone_code": backbone,
                }
            else:
                p = self.porticos[key]
                p["portico_id"] = portico_id
                p["connection_id"] = conn_id
                p["remote_addr"] = remote_addr
                p["last_seen"] = now_str
                p["last_bt_id"] = last_bt
                p["total_frames"] = frames
                p["backbone_code"] = backbone

        # ------------------------------------------------------------------
        # 2) Volcar historial de BT a su tabla
        # ------------------------------------------------------------------
        self.table_bt.setRowCount(len(self.bt_events))
        for row, ev in enumerate(self.bt_events):
            self.table_bt.setItem(row, 0, QTableWidgetItem(ev["timestamp"]))
            self.table_bt.setItem(row, 1, QTableWidgetItem(ev["portico_id"]))
            self.table_bt.setItem(row, 2, QTableWidgetItem(ev["connection_id"]))
            self.table_bt.setItem(row, 3, QTableWidgetItem(ev["remote_addr"]))
            self.table_bt.setItem(row, 4, QTableWidgetItem(ev["backbone_code"]))
            self.table_bt.setItem(row, 5, QTableWidgetItem(ev["last_bt_id"]))
            self.table_bt.setItem(row, 6, QTableWidgetItem(str(ev["total_frames"])))

        # ------------------------------------------------------------------
        # 3) Volcar estado de pórticos a su tabla
        # ------------------------------------------------------------------
        port_list = list(self.porticos.values())
        self.table_porticos.setRowCount(len(port_list))

        for row, p in enumerate(port_list):
            self.table_porticos.setItem(row, 0, QTableWidgetItem(p["portico_id"]))
            self.table_porticos.setItem(row, 1, QTableWidgetItem(p["connection_id"]))
            self.table_porticos.setItem(row, 2, QTableWidgetItem(p["remote_addr"]))
            self.table_porticos.setItem(row, 3, QTableWidgetItem(p["first_seen"]))
            self.table_porticos.setItem(row, 4, QTableWidgetItem(p["last_seen"]))
            self.table_porticos.setItem(row, 5, QTableWidgetItem(p["last_bt_id"]))
            self.table_porticos.setItem(row, 6, QTableWidgetItem(str(p["total_frames"])))

            btn = QPushButton("Editar")
            portico_copy = dict(p)

            def make_handler(portico_dict=portico_copy):
                return lambda: self.open_portico_config(portico_dict)

            btn.clicked.connect(make_handler())
            self.table_porticos.setCellWidget(row, 7, btn)

        # ------------------------------------------------------------------
        # 4) Actualizar métricas agregadas del resumen
        # ------------------------------------------------------------------
        known_porticos = len(self.porticos)
        total_frames_sum = sum(p["total_frames"] for p in self.porticos.values())
        backbones = sorted(
            {p.get("backbone_code") for p in self.porticos.values() if p.get("backbone_code")}
        )

        self.lbl_porticos_conocidos.setText(
            f"Pórticos conocidos (histórico): {known_porticos}"
        )
        self.lbl_total_frames.setText(
            f"Frames totales acumulados: {total_frames_sum}"
        )
        if backbones:
            self.lbl_backbones.setText(
                f"Backbones activos: {len(backbones)} ({', '.join(backbones)})"
            )
        else:
            self.lbl_backbones.setText("Backbones activos: -")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--listener-url",
        default="http://localhost:8080",
        help="URL base del listener (ej: http://10.0.0.5:8080)",
    )
    args = parser.parse_args()

    app = QApplication(sys.argv)
    gui = ListenerGui(args.listener_url)
    gui.resize(1000, 600)
    gui.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
