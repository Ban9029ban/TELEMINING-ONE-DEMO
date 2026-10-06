import React, { useEffect, useState } from "react";
import { Button, Table, Tag } from "antd";
import { getPorticos } from "../../services/api/porticos";
import PorticoEditModal from "../../components/PorticoEditModal";

export default function PorticosList() {
  const [porticos, setPorticos] = useState([]);
  const [editingPortico, setEditingPortico] = useState(null);

  const load = async () => {
    const data = await getPorticos();
    setPorticos(data);
  };

  useEffect(() => {
    load();
  }, []);

  const columns = [
  { title: "ID", dataIndex: "id", width: 60 },
  { title: "Nombre", dataIndex: "name" },
  { title: "Site", dataIndex: "site" },
  { title: "Nivel", dataIndex: "nivel", width: 80 },
  { title: "Zona", dataIndex: "zone", width: 110 },
  {
    title: "Tipo",
    dataIndex: "portico_type",
    render: (_, row) =>
    row.has_climate ?
    <Tag color="green">Pórtico con control ambientales</Tag> :

    <Tag color="blue">Pórtico estáándar</Tag>

  },
  {
    title: "Activo",
    dataIndex: "active",
    width: 90,
    render: (val) =>
    val  <Tag color="green">Sí</Tag> : <Tag color="red">No</Tag>
  },
  {
    title: "Acciones",
    key: "actions",
    width: 160,
    render: (_, row) =>
    <>
          <Button
        size="small"
        type="primary"
        style={{ marginRight: 8 }}
        onClick={() => setEditingPortico(row)}>
        
            Editar
          </Button>
          {/* aquí mantienes tu botón Eliminar actual si lo tenías */}
        </>

  }];


  return (
    <>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={porticos}
        pagination={false} />
      

      {editingPortico &&
      <PorticoEditModal
        portico={editingPortico}
        onClose={() => setEditingPortico(null)}
        onSaved={() => {
          setEditingPortico(null);
          load();
        }} />

      }
    </>);

}